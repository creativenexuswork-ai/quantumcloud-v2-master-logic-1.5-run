import { useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from './use-toast';
import { useSessionStore, TradingMode, getButtonStates } from '@/lib/state/sessionMachine';
import { useQueryClient } from '@tanstack/react-query';
import { useTradingState } from './useSessionState';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const TICK_INTERVAL_MS = 2000; // Trading tick interval - strategy execution
const PNL_REFRESH_MS = 300; // P&L refresh interval - fast UI updates

// Map UI mode to backend mode
const MODE_TO_BACKEND: Record<TradingMode, string> = {
  burst: 'burst',
  scalper: 'sniper',
  trend: 'trend',
};

export function useSessionActions() {
  const { session: authSession } = useAuth();
  const queryClient = useQueryClient();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const pnlRefreshRef = useRef<NodeJS.Timeout | null>(null);
  const tickInFlightRef = useRef(false);
  const autoTpCheckRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get state and dispatch from store
  const sessionState = useSessionStore();
  const { dispatch } = sessionState;
  const buttonStates = getButtonStates(sessionState);
  
  // Get risk settings for auto TP
  const { riskSettings } = useTradingState();

  // Clear tick interval
  const clearTickInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Clear P&L refresh interval
  const clearPnlRefresh = useCallback(() => {
    if (pnlRefreshRef.current) {
      clearInterval(pnlRefreshRef.current);
      pnlRefreshRef.current = null;
    }
  }, []);

  // Clear auto TP check
  const clearAutoTpCheck = useCallback(() => {
    if (autoTpCheckRef.current) {
      clearInterval(autoTpCheckRef.current);
      autoTpCheckRef.current = null;
    }
  }, []);

  // Fast P&L refresh - just fetches stats, no trade execution
  const refreshPnl = useCallback(async () => {
    const pendingAction = useSessionStore.getState().pendingAction;
    if (pendingAction) return; // Skip during pending actions
    
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;

      const { data: stats } = await supabase.functions.invoke('paper-stats');
      if (stats?.stats) {
        dispatch({
          type: 'SYNC_PNL',
          pnlToday: stats.stats.todayPnl || 0,
          tradesToday: stats.stats.tradesToday || 0,
          winRate: stats.stats.winRate || 0,
          equity: stats.stats.equity || 10000,
        });
        dispatch({
          type: 'SYNC_POSITIONS',
          hasPositions: (stats.stats.openPositionsCount || 0) > 0,
          openCount: stats.stats.openPositionsCount || 0,
        });
      }
    } catch (error) {
      // Silent fail for P&L refresh - non-critical
    }
  }, [dispatch]);

  // Run a single tick - strategy execution only
  // CRITICAL: Respects runActive flag to prevent new trades after run ends
  const runTick = useCallback(async (options?: { globalClose?: boolean; takeBurstProfit?: boolean; takeProfit?: boolean }) => {
    const isCloseAction = options?.globalClose || options?.takeProfit;
    
    // CRITICAL: Manual close actions (TP/CloseAll) ALWAYS execute - never block them
    // Regular ticks are blocked if another tick is in-flight
    if (!isCloseAction && tickInFlightRef.current) {
      return null;
    }
    
    const state = useSessionStore.getState();
    
    // Regular ticks only run when session is 'running'
    if (!isCloseAction && !options?.takeBurstProfit) {
      if (state.status !== 'running') {
        return null;
      }
      
      // CRITICAL: Block new trades if run is not active (Auto-TP fired or manual stop)
      if (!state.runActive) {
        console.log('[TICK] Blocked - runActive is false (run ended, no new trades)');
        return null;
      }
    }
    
    // Only set in-flight for regular ticks (manual actions run regardless)
    if (!isCloseAction) {
      tickInFlightRef.current = true;
    }
    
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return null;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options || {}),
      });

      if (!response.ok) {
        console.error('Tick failed:', response.status);
        return null;
      }
      
      const data = await response.json();
      
      // Sync halted state
      if (data.halted !== undefined) {
        dispatch({ type: 'SET_HALTED', halted: data.halted });
      }
      
      // Sync session status from backend
      if (data.sessionStatus) {
        dispatch({ type: 'SYNC_STATUS', status: data.sessionStatus });
      }
      
      // Sync positions and P&L immediately from response
      if (data.stats) {
        dispatch({ 
          type: 'SYNC_POSITIONS', 
          hasPositions: (data.stats.openPositionsCount || 0) > 0,
          openCount: data.stats.openPositionsCount || 0
        });
        dispatch({
          type: 'SYNC_PNL',
          pnlToday: data.stats.todayPnl || 0,
          tradesToday: data.stats.tradesToday || 0,
          winRate: data.stats.winRate || 0,
          equity: data.stats.equity || 10000,
        });
      }
      
      // Invalidate queries for any other listeners
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      return data;
    } catch (error) {
      console.error('Tick error:', error);
      return null;
    } finally {
      // Only reset in-flight flag for regular ticks (manual actions didn't set it)
      if (!options?.globalClose && !options?.takeProfit) {
        tickInFlightRef.current = false;
      }
    }
  }, [queryClient, dispatch]);

  // Start tick interval - only runs when session is RUNNING AND runActive is true
  const startTickInterval = useCallback(() => {
    clearTickInterval();
    intervalRef.current = setInterval(async () => {
      const state = useSessionStore.getState();
      
      // CRITICAL: Do NOT tick if any action is pending
      if (state.pendingAction) return;
      
      // Only tick if explicitly running
      if (state.status !== 'running') return;
      
      // CRITICAL: Do NOT open new trades if run is not active
      // This prevents re-entry after Auto-TP fires or after manual stop
      if (!state.runActive) {
        console.log('[TICK] Skipped - runActive is false (run ended)');
        return;
      }
      
      const result = await runTick();
      if (result?.halted) {
        toast({
          title: 'Trading Halted',
          description: 'Daily loss limit reached.',
          variant: 'destructive',
        });
        clearTickInterval();
        clearPnlRefresh();
        clearAutoTpCheck();
        dispatch({ type: 'SET_HALTED', halted: true });
        dispatch({ type: 'END_RUN', reason: 'manual_stop' });
      }
    }, TICK_INTERVAL_MS);
  }, [runTick, clearTickInterval, clearPnlRefresh, clearAutoTpCheck, dispatch]);

  // Start fast P&L refresh - runs independently from trading ticks
  const startPnlRefresh = useCallback(() => {
    clearPnlRefresh();
    pnlRefreshRef.current = setInterval(async () => {
      const currentStatus = useSessionStore.getState().status;
      const pendingAction = useSessionStore.getState().pendingAction;
      
      // Only refresh P&L during active sessions, skip during pending actions
      if (currentStatus !== 'running' && currentStatus !== 'holding') return;
      if (pendingAction) return;
      
      await refreshPnl();
    }, PNL_REFRESH_MS);
  }, [clearPnlRefresh, refreshPnl]);

  // Auto TP check - runs while engine is active (ONE-SHOT per run)
  // Supports percent or cash mode, and infinite looping if stopAfterHit is false
  const startAutoTpCheck = useCallback(() => {
    clearAutoTpCheck();
    
    autoTpCheckRef.current = setInterval(async () => {
      const state = useSessionStore.getState();
      
      // CRITICAL: Only check auto TP when:
      // 1. Session is running
      // 2. No pending action
      // 3. Run is active (runActive === true)
      // 4. Auto-TP has NOT already fired this run (autoTpFired === false)
      // 5. Auto-TP mode is NOT 'off'
      if (state.status !== 'running' || state.pendingAction) return;
      if (!state.runActive) return; // Run ended, no checks
      if (state.autoTpFired) return; // Already fired this run
      if (state.autoTpMode === 'off') return; // Auto-TP disabled
      
      // Check if Auto-TP target is set
      if (state.autoTpTargetEquity === null) return;
      
      // Get current equity
      const { data: stats } = await supabase.functions.invoke('paper-stats');
      if (!stats?.stats) return;
      
      const currentEquity = stats.stats.equity || 10000;
      const targetEquity = state.autoTpTargetEquity;
      
      // Small buffer to prevent flicker (0.1% of target)
      const buffer = targetEquity * 0.001;
      
      // Check if we hit the TP target
      if (currentEquity >= targetEquity + buffer && stats.stats.openPositionsCount > 0) {
        const tpValue = state.autoTpValue;
        const tpMode = state.autoTpMode;
        // Use autoTpStopAfterHit to determine behavior
        const stopAfterHit = state.autoTpStopAfterHit;
        
        console.log(`[AUTO-TP] Target hit: equity ${currentEquity.toFixed(2)} >= target ${targetEquity.toFixed(2)}. Mode: ${tpMode}, StopAfterHit: ${stopAfterHit}`);
        
        // STEP 1: Mark Auto-TP as fired BEFORE closing (one-shot per run)
        dispatch({ type: 'SET_AUTO_TP_FIRED' });
        
        // STEP 2: Close all positions
        dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'takeProfit' });
        await runTick({ takeProfit: true });
        dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
        
        // STEP 3: Log the auto TP event
        const { data: { user } } = await supabase.auth.getUser();
        const tpLabel = tpMode === 'percent' ? `${tpValue}%` : `$${tpValue}`;
        
        if (user) {
          await supabase.from('system_logs').insert({
            user_id: user.id,
            level: 'info',
            source: 'execution',
            message: `Auto TP hit – run banked. Target ${tpLabel} reached.`,
          });
        }
        
        // STEP 4: Handle stop vs infinite mode
        if (stopAfterHit) {
          // Stop mode: End the run, no new trades until manual restart
          dispatch({ type: 'END_RUN', reason: 'auto_tp' });
          
          toast({ 
            title: 'Auto Take Profit', 
            description: `Target ${tpLabel} reached. Run banked – stopped.` 
          });
        } else {
          // Continuous mode: Start a new run with fresh baseline
          const newEquity = currentEquity; // Use current equity as new baseline
          const runId = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          // Calculate new target based on current mode and value
          let newTargetEquity: number | null = null;
          if (tpMode === 'percent' && tpValue && tpValue > 0) {
            newTargetEquity = newEquity * (1 + tpValue / 100);
          } else if (tpMode === 'cash' && tpValue && tpValue > 0) {
            newTargetEquity = newEquity + tpValue;
          }
          
          console.log(`[AUTO-TP CONTINUOUS] Starting new run: id=${runId}, baseline=${newEquity.toFixed(2)}, target=${newTargetEquity?.toFixed(2) || 'none'}`);
          
          // Start new run
          dispatch({ 
            type: 'START_RUN', 
            runId, 
            baselineEquity: newEquity, 
            targetEquity: newTargetEquity 
          });
          
          if (user) {
            await supabase.from('system_logs').insert({
              user_id: user.id,
              level: 'info',
              source: 'execution',
              message: `Auto TP infinite mode: New run started. Baseline $${newEquity.toFixed(2)}, Target $${newTargetEquity?.toFixed(2) || 'none'}`,
            });
          }
          
          toast({ 
            title: 'Auto Take Profit', 
            description: `Target ${tpLabel} reached. New run started automatically.` 
          });
        }
        
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      }
    }, TICK_INTERVAL_MS * 2);
  }, [runTick, queryClient, clearAutoTpCheck, dispatch]);

  // ACTIVATE - Start trading session OR Resume from holding
  // Creates a new run with Auto-TP parameters
  const activate = useCallback(async () => {
    const state = useSessionStore.getState();
    
    if (state.halted) {
      toast({ title: 'Trading Halted', description: 'Daily loss limit reached', variant: 'destructive' });
      return;
    }
    
    // Can activate from idle, stopped, or holding
    if (state.status !== 'idle' && state.status !== 'stopped' && state.status !== 'holding') {
      return;
    }
    
    const wasHolding = state.status === 'holding';
    
    // Set pending action for spinner
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'activate' });
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        dispatch({ type: 'ERROR', error: 'Not authenticated' });
        dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
        return;
      }

      // Transition to running
      dispatch({ type: 'ACTIVATE' });

      // Update backend
      const backendMode = MODE_TO_BACKEND[state.mode];
      await supabase.from('paper_config').update({
        is_running: true,
        session_status: 'running',
        session_started_at: wasHolding ? undefined : new Date().toISOString(),
        mode_config: {
          enabledModes: [backendMode],
          modeSettings: {},
        },
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id,
        level: 'info',
        source: 'execution',
        message: wasHolding 
          ? `SESSION: Resumed - ${state.mode.toUpperCase()} mode active`
          : `SESSION: Started - ${state.mode.toUpperCase()} mode active`,
      });
      
      // ============== START NEW RUN ==============
      // Get current equity for Auto-TP baseline
      const { data: stats } = await supabase.functions.invoke('paper-stats');
      const currentEquity = stats?.stats?.equity || 10000;
      
      // Generate new run ID
      const runId = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Get Auto-TP configuration from session state
      const { autoTpMode, autoTpValue } = useSessionStore.getState();
      
      // Calculate Auto-TP target based on mode
      let targetEquity: number | null = null;
      if (autoTpMode === 'percent' && autoTpValue && autoTpValue > 0) {
        targetEquity = currentEquity * (1 + autoTpValue / 100);
      } else if (autoTpMode === 'cash' && autoTpValue && autoTpValue > 0) {
        targetEquity = currentEquity + autoTpValue;
      }
      // If mode is 'off' or value is invalid, targetEquity stays null (no Auto-TP)
      
      // Dispatch START_RUN action
      dispatch({ 
        type: 'START_RUN', 
        runId, 
        baselineEquity: currentEquity, 
        targetEquity 
      });
      
      console.log(`[RUN] Started: id=${runId}, baseline=${currentEquity.toFixed(2)}, target=${targetEquity?.toFixed(2) || 'none'}, mode=${autoTpMode}`);

      // Run immediate tick
      const result = await runTick();
      
      if (result?.halted) {
        toast({
          title: 'Trading Halted',
          description: 'Daily loss limit reached.',
          variant: 'destructive',
        });
        await supabase.from('paper_config').update({
          is_running: false,
          session_status: 'idle',
        } as any).eq('user_id', user.id);
        dispatch({ type: 'SET_HALTED', halted: true });
        dispatch({ type: 'END_RUN', reason: 'manual_stop' });
        dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
        return;
      }
      
      startTickInterval();
      startPnlRefresh();
      startAutoTpCheck();
      
      toast({ 
        title: wasHolding ? 'Session Resumed' : 'Session Activated', 
        description: `${state.mode.toUpperCase()} mode running` 
      });
    } catch (error) {
      console.error('Activate error:', error);
      dispatch({ type: 'ERROR', error: 'Failed to start session' });
      toast({ title: 'Error', description: 'Failed to activate session', variant: 'destructive' });
    } finally {
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
  }, [dispatch, runTick, startTickInterval, startPnlRefresh, startAutoTpCheck]);

  // HOLD - Stop opening new trades, but manage existing positions
  const holdToggle = useCallback(async () => {
    const state = useSessionStore.getState();
    
    // Only allow hold from running state
    if (state.status !== 'running') {
      return;
    }
    
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'hold' });
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
        return;
      }

      await supabase.from('paper_config').update({
        session_status: 'holding',
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id,
        level: 'info',
        source: 'execution',
        message: 'SESSION: Holding - no new trades; managing existing positions',
      });

      dispatch({ type: 'HOLD' });
      
      // Keep tick interval running for position management, but stop auto TP cycling
      clearAutoTpCheck();
      
      toast({ 
        title: 'Session On Hold',
        description: 'Managing existing positions only. Click ACTIVATE to resume.'
      });
    } catch (error) {
      console.error('Hold error:', error);
      toast({ title: 'Error', description: 'Failed to hold session', variant: 'destructive' });
    } finally {
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
  }, [dispatch, clearAutoTpCheck]);

  // ================================================================
  // TAKE PROFIT - Single atomic action with optimistic UI update
  // ================================================================
  const takeProfit = useCallback(async () => {
    const state = useSessionStore.getState();
    
    if (state.status !== 'running' && state.status !== 'holding') {
      return;
    }
    
    // Already processing? Don't allow another click
    if (state.pendingAction !== null) {
      return;
    }
    
    // STEP 1: Set pending action and OPTIMISTIC UI update
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'takeProfit' });
    dispatch({ type: 'SYNC_POSITIONS', hasPositions: false, openCount: 0 }); // Optimistic
    
    // STEP 2: Stop tick interval to prevent race conditions
    clearTickInterval();
    clearAutoTpCheck();
    tickInFlightRef.current = false;
    
    try {
      // STEP 3: Call backend ONCE (non-blocking pattern)
      const result = await runTick({ takeProfit: true });
      
      // STEP 4: Sync final stats from backend
      if (result?.stats) {
        dispatch({
          type: 'SYNC_PNL',
          pnlToday: result.stats.todayPnl || 0,
          tradesToday: result.stats.tradesToday || 0,
          winRate: result.stats.winRate || 0,
          equity: result.stats.equity || 10000,
        });
      }
      
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      toast({ 
        title: 'Profit Taken', 
        description: `${result?.closedCount || 0} positions closed.` 
      });
      
      // Resume tick interval if session continues
      const currentStatus = useSessionStore.getState().status;
      if (currentStatus === 'running') {
        startTickInterval();
        startAutoTpCheck();
      }
      
    } catch (error) {
      console.error('Take profit error:', error);
      toast({ title: 'Error', description: 'Failed to take profit', variant: 'destructive' });
    } finally {
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
    
  }, [dispatch, runTick, queryClient, clearTickInterval, clearAutoTpCheck, startTickInterval, startAutoTpCheck]);

  // ================================================================
  // CLOSE ALL - Single atomic action with optimistic UI update
  // Ends the current run - no new trades allowed until next ACTIVATE
  // ================================================================
  const closeAll = useCallback(async () => {
    const state = useSessionStore.getState();
    
    // Already processing? Don't allow another click
    if (state.pendingAction !== null) {
      return;
    }
    
    // STEP 1: Set pending action and OPTIMISTIC UI update
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'closeAll' });
    dispatch({ type: 'SYNC_POSITIONS', hasPositions: false, openCount: 0 }); // Optimistic
    dispatch({ type: 'SYNC_STATUS', status: 'idle' }); // Optimistic
    
    // STEP 2: End the run IMMEDIATELY (prevents re-entry)
    dispatch({ type: 'END_RUN', reason: 'close_all' });
    
    // STEP 3: Stop ALL intervals
    clearTickInterval();
    clearPnlRefresh();
    clearAutoTpCheck();
    tickInFlightRef.current = false;
    
    try {
      // STEP 4: Update database FIRST to prevent tick race condition
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('paper_config').update({
          is_running: false,
          session_status: 'idle',
          burst_requested: false,
        } as any).eq('user_id', user.id);
        
        await supabase.from('system_logs').insert({
          user_id: user.id,
          level: 'info',
          source: 'execution',
          message: 'SESSION: Closed - run ended, no new trades until next activation',
        });
      }
      
      // STEP 5: Call backend ONCE to close positions
      const result = await runTick({ globalClose: true });
      
      // STEP 6: Sync final stats from backend
      if (result?.stats) {
        dispatch({
          type: 'SYNC_PNL',
          pnlToday: result.stats.todayPnl || 0,
          tradesToday: result.stats.tradesToday || 0,
          winRate: result.stats.winRate || 0,
          equity: result.stats.equity || 10000,
        });
      }
      
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      toast({ 
        title: 'Session Closed', 
        description: `${result?.closedCount || 0} positions closed. Run ended.` 
      });
      
    } catch (error) {
      console.error('Close all error:', error);
      toast({ title: 'Error', description: 'Failed to close positions', variant: 'destructive' });
    } finally {
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
    
  }, [dispatch, runTick, queryClient, clearTickInterval, clearPnlRefresh, clearAutoTpCheck]);

  // ================================================================
  // MODE PRESETS - Applied when selecting a mode
  // ================================================================
  const MODE_PRESETS: Record<TradingMode, {
    autoTpMode: 'off' | 'percent' | 'cash';
    autoTpValue: number;
    autoTpStopAfterHit: boolean;
    description: string;
  }> = {
    burst: {
      autoTpMode: 'percent',
      autoTpValue: 1.5,
      autoTpStopAfterHit: false, // Continuous mode for burst
      description: 'Ultra-aggressive: continuous TP cycles at 1.5%',
    },
    scalper: {
      autoTpMode: 'percent',
      autoTpValue: 1,
      autoTpStopAfterHit: true, // One-shot for scalper
      description: 'Medium: one-shot TP at 1%',
    },
    trend: {
      autoTpMode: 'percent',
      autoTpValue: 2,
      autoTpStopAfterHit: true, // One-shot for trend
      description: 'Conservative: one-shot TP at 2%',
    },
  };

  // Change mode (only when idle or stopped) - APPLIES PRESETS
  const changeMode = useCallback(async (newMode: TradingMode) => {
    const state = useSessionStore.getState();
    
    if (state.status !== 'idle' && state.status !== 'stopped') {
      toast({ 
        title: 'Cannot Change Mode', 
        description: 'Stop or close all positions first.',
        variant: 'destructive'
      });
      return;
    }
    
    dispatch({ type: 'SET_MODE', mode: newMode });
    
    // Apply mode preset for Auto-TP settings
    const preset = MODE_PRESETS[newMode];
    if (preset) {
      dispatch({ type: 'SET_AUTO_TP_MODE', mode: preset.autoTpMode });
      dispatch({ type: 'SET_AUTO_TP_VALUE', value: preset.autoTpValue });
      dispatch({ type: 'SET_AUTO_TP_STOP_AFTER_HIT', stopAfterHit: preset.autoTpStopAfterHit });
      console.log(`[MODE PRESET] Applied ${newMode}: ${preset.description}`);
    }
    
    // Persist to backend
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const backendMode = MODE_TO_BACKEND[newMode];
      const isBurstMode = newMode === 'burst';
      
      await supabase.from('paper_config').update({
        mode_config: {
          enabledModes: [backendMode],
          modeSettings: {},
        },
        // CRITICAL: Set burst_requested flag when burst mode is selected
        burst_requested: isBurstMode,
      } as any).eq('user_id', user.id);
      
      console.log(`[MODE] Changed to ${newMode}, burst_requested=${isBurstMode}`);
    }
    
    toast({ 
      title: 'Mode Changed', 
      description: `${newMode.toUpperCase()}: ${preset?.description || 'Active'}` 
    });
  }, [dispatch]);

  // Reset session (clear halted state, reset to idle)
  const resetSession = useCallback(async () => {
    clearTickInterval();
    clearPnlRefresh();
    clearAutoTpCheck();
    
    dispatch({ type: 'RESET' });
    
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('paper_config').update({
        is_running: false,
        session_status: 'idle',
        trading_halted_for_day: false,
        burst_requested: false,
      } as any).eq('user_id', user.id);
    }
    
    toast({ title: 'Session Reset', description: 'Ready to trade again' });
  }, [dispatch, clearTickInterval, clearPnlRefresh, clearAutoTpCheck]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTickInterval();
      clearPnlRefresh();
      clearAutoTpCheck();
    };
  }, [clearTickInterval, clearPnlRefresh, clearAutoTpCheck]);

  return {
    buttonStates,
    activate,
    holdToggle,
    takeProfit,
    closeAll,
    changeMode,
    resetSession,
    refreshPnl,
  };
}
