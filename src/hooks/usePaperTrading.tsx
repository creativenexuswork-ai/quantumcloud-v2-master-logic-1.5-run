import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from './use-toast';
import { useSession, SessionStatus } from '@/lib/state/session';


const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const TICK_INTERVAL_MS = 2000;
const STATS_REFRESH_MS = 600; // P&L refresh every 600ms for faster updates

export interface PaperStats {
  equity: number;
  todayPnl: number;
  todayPnlPercent: number;
  winRate: number;
  avgRR: number;
  tradesToday: number;
  maxDrawdown: number;
  openPositionsCount: number;
  burstPnlToday: number;
  burstsToday: number;
  burstStatus: 'idle' | 'running' | 'locked';
}

interface PaperPosition {
  id: string;
  user_id: string;
  symbol: string;
  mode: string;
  side: string;
  size: number;
  entry_price: number;
  sl?: number;
  tp?: number;
  opened_at: string;
  unrealized_pnl: number;
  batch_id?: string;
}

interface PaperTrade {
  id: string;
  user_id: string;
  symbol: string;
  mode: string;
  side: string;
  size: number;
  entry_price: number;
  exit_price: number;
  realized_pnl: number;
  reason?: string;
  opened_at: string;
  closed_at: string;
  session_date: string;
}

interface PaperConfig {
  risk_config: {
    maxDailyLossPercent: number;
    maxConcurrentRiskPercent: number;
  };
  burst_config: {
    size: number;
    dailyProfitTargetPercent: number;
  };
  mode_config: {
    enabledModes: string[];
    modeSettings: Record<string, unknown>;
  };
  market_config: {
    selectedSymbols: string[];
    typeFilters: Record<string, boolean>;
  };
  burst_requested: boolean;
  use_ai_reasoning: boolean;
  show_advanced_explanations: boolean;
  is_running?: boolean;
  session_status?: SessionStatus;
}

export function usePaperStats() {
  const { session } = useAuth();

  return useQuery({
    queryKey: ['paper-stats'],
    queryFn: async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) throw new Error('Not authenticated');

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-stats`, {
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Paper stats fetch failed:', response.status, response.statusText);
        throw new Error('Failed to fetch stats');
      }
      return response.json() as Promise<{
        stats: PaperStats;
        positions: PaperPosition[];
        trades: PaperTrade[];
        historicalStats: Array<{
          trade_date: string;
          equity_end: number;
          pnl: number;
          win_rate: number;
        }>;
        symbols: Array<{
          id: string;
          symbol: string;
          name: string;
          type: string;
          is_active: boolean;
        }>;
        logs: Array<{
          id: string;
          level: string;
          source: string;
          message: string;
          created_at: string;
        }>;
        config: PaperConfig;
        halted: boolean;
        sessionStatus: SessionStatus;
      }>;
    },
    enabled: !!session,
    refetchInterval: STATS_REFRESH_MS, // Fast 1s P&L refresh
    retry: 2,
    staleTime: 500, // Consider data stale after 500ms for faster updates
  });
}

export function usePaperTick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options?: {
      burstRequested?: boolean;
      globalClose?: boolean;
      takeBurstProfit?: boolean;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options || {}),
      });

      if (!response.ok) throw new Error('Failed to run tick');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
    },
  });
}

export function useTradingSession() {
  const { session } = useAuth();
  const { status, setStatus } = useSession();
  const isRunning = status === 'running';
  const isHolding = status === 'holding';
  const [tickInFlight, setTickInFlight] = useState(false);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const statusRef = useRef<SessionStatus>('idle');
  const tickInFlightRef = useRef(false);
  const queryClient = useQueryClient();

  // Sync status ref with state
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    tickInFlightRef.current = tickInFlight;
  }, [tickInFlight]);

  const runTickInternal = useCallback(async (): Promise<{ sessionStatus: SessionStatus } | null> => {
    if (tickInFlightRef.current) return null;
    
    tickInFlightRef.current = true;
    setTickInFlight(true);
    
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) {
        return null;
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        console.error('Tick failed:', response.status);
        return null;
      }
      
      const data = await response.json();
      
      // Sync UI status with backend session_status
      if (data.sessionStatus && data.sessionStatus !== statusRef.current) {
        setStatus(data.sessionStatus);
      }
      
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });

      return { sessionStatus: data.sessionStatus || 'idle' };
    } catch (error) {
      console.error('Tick error:', error);
      return null;
    } finally {
      tickInFlightRef.current = false;
      setTickInFlight(false);
    }
  }, [queryClient, setStatus]);

  const clearTickInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTickInterval = useCallback(() => {
    clearTickInterval();
    intervalRef.current = setInterval(async () => {
      // Only tick if running or holding (holding still needs to manage positions)
      if (statusRef.current !== 'running' && statusRef.current !== 'holding') return;
      
      await runTickInternal();
    }, TICK_INTERVAL_MS);
  }, [runTickInternal, clearTickInterval]);

  // Start session - begin trading
  const startSession = useCallback(async () => {
    if (status === 'running') return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Update database with running status
      await supabase.from('paper_config').update({ 
        is_running: true, 
        session_status: 'running',
        session_started_at: new Date().toISOString() 
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id, 
        level: 'info', 
        source: 'execution',
        message: 'SESSION: Started - trading engine active',
      });

      setStatus('running');
      
      // Run immediate tick
      await runTickInternal();
      
      startTickInterval();
      toast({ title: 'Session Started', description: 'Trading engine running' });
    } catch (error) {
      console.error('Start session error:', error);
      toast({ title: 'Error', description: 'Failed to start session', variant: 'destructive' });
    }
  }, [status, runTickInternal, startTickInterval, setStatus]);

  // Hold session - stop new trades but manage existing positions
  const holdSession = useCallback(async () => {
    if (status !== 'running') return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Update database with holding status - is_running stays true for position management
      await supabase.from('paper_config').update({ 
        session_status: 'holding'
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id, 
        level: 'info', 
        source: 'execution',
        message: 'SESSION: Holding - no new trades; managing existing positions only',
      });

      setStatus('holding');
      // Keep the interval running for position management
      toast({ title: 'Session On Hold', description: 'Managing existing positions only' });
    } catch (error) {
      console.error('Hold session error:', error);
      toast({ title: 'Error', description: 'Failed to hold session', variant: 'destructive' });
    }
  }, [status, setStatus]);

  // Resume session - continue trading from holding state
  const resumeSession = useCallback(async () => {
    if (status !== 'holding') return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Update database with running status
      await supabase.from('paper_config').update({ 
        session_status: 'running'
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id, 
        level: 'info', 
        source: 'execution',
        message: 'SESSION: Resumed - trading engine active',
      });

      setStatus('running');
      toast({ title: 'Session Resumed', description: 'Trading engine active' });
    } catch (error) {
      console.error('Resume session error:', error);
      toast({ title: 'Error', description: 'Failed to resume session', variant: 'destructive' });
    }
  }, [status, setStatus]);

  // Stop session - stop engine completely (no global close)
  const stopSession = useCallback(async () => {
    clearTickInterval();
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('paper_config').update({ 
        is_running: false, 
        session_status: 'idle' 
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id, 
        level: 'info', 
        source: 'execution',
        message: 'SESSION: Stopped - engine idle',
      });

      setStatus('idle');
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      toast({ title: 'Session Stopped' });
    } catch (error) {
      console.error('Stop session error:', error);
    }
  }, [clearTickInterval, queryClient, setStatus]);

  // Trigger burst mode
  const triggerBurst = useCallback(async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${currentSession.access_token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ burstRequested: true }),
      });
      
      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      }
    } catch (error) {
      console.error('Burst trigger error:', error);
      toast({ title: 'Error', description: 'Failed to trigger burst', variant: 'destructive' });
    }
  }, [queryClient]);

  // Take burst profit
  const takeBurstProfit = useCallback(async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${currentSession.access_token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ takeBurstProfit: true }),
      });
      
      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      }
      
      toast({ title: 'Burst Profit Taken' });
    } catch (error) {
      console.error('Take burst profit error:', error);
      toast({ title: 'Error', description: 'Failed to take burst profit', variant: 'destructive' });
    }
  }, [queryClient]);

  // Global close - close all positions and stop session
  const globalClose = useCallback(async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${currentSession.access_token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ globalClose: true }),
      });
      
      if (response.ok) {
        // Stop the session after global close
        clearTickInterval();
        
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('paper_config').update({ 
            is_running: false, 
            session_status: 'idle' 
          } as any).eq('user_id', user.id);
        }
        
        setStatus('idle');
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      }
      
      toast({ title: 'Global Close', description: 'All positions closed, session stopped' });
    } catch (error) {
      console.error('Global close error:', error);
      toast({ title: 'Error', description: 'Failed to close positions', variant: 'destructive' });
    }
  }, [queryClient, clearTickInterval, setStatus]);

  // Initialize session state on mount
  useEffect(() => {
    let mounted = true;
    
    async function checkSessionState() {
      if (!session) return;
      
      try {
        const { data: config } = await supabase
          .from('paper_config')
          .select('is_running, session_status')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (!mounted) return;

        if (config) {
          // Restore session status from backend
          const backendStatus = (config as any).session_status as SessionStatus || 'idle';
          setStatus(backendStatus);
          
          // Start tick interval if running or holding
          if (backendStatus === 'running' || backendStatus === 'holding') {
            await runTickInternal();
            
            if (!mounted) return;
            
            startTickInterval();
          }
        }
      } catch (error) {
        console.error('Check session state error:', error);
      }
    }
    
    checkSessionState();
    
    return () => {
      mounted = false;
      clearTickInterval();
    };
  }, [session?.user?.id, setStatus, runTickInternal, startTickInterval, clearTickInterval]);

  return {
    isActive: isRunning, 
    isHolding,
    tickInFlight,
    startSession, 
    holdSession,
    resumeSession,
    stopSession, 
    triggerBurst, 
    takeBurstProfit, 
    globalClose,
  };
}

export function usePaperConfig() {
  const queryClient = useQueryClient();

  const updateConfig = useMutation({
    mutationFn: async (updates: Partial<{
      risk_config: Record<string, unknown>;
      burst_config: Record<string, unknown>;
      mode_config: Record<string, unknown>;
      market_config: Record<string, unknown>;
      use_ai_reasoning: boolean;
      show_advanced_explanations: boolean;
    }>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('paper_config').update({
        ...updates,
        updated_at: new Date().toISOString(),
      } as any).eq('user_id', user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      toast({ title: 'Settings saved' });
    },
    onError: (error) => {
      console.error('Config update error:', error);
      toast({ title: 'Error', description: 'Failed to save settings', variant: 'destructive' });
    },
  });

  return { updateConfig };
}

export function useSymbols() {
  const { session } = useAuth();

  return useQuery({
    queryKey: ['symbols'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('symbols')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      return data;
    },
    enabled: !!session,
  });
}
