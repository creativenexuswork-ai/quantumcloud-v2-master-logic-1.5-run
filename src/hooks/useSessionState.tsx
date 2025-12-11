import { create } from 'zustand';
import { useSession, AccountType, SessionStatus } from '@/lib/state/session';
import { usePaperStats, usePaperConfig } from './usePaperTrading';
import { useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Extended Session State Hook
 * 
 * Combines the base session state with trading-specific state like:
 * - Mode selection and configuration
 * - Risk settings
 * - Session performance metrics
 * 
 * IMPORTANT: All state changes are persisted to paper_config in the database
 * so the backend tick engine uses the same values as the UI.
 */

export type TradingMode = 
  | 'burst' 
  | 'scalper' 
  | 'trend' 
  | 'swing' 
  | 'memory' 
  | 'sniper' 
  | 'risk-off' 
  | 'ai-assist';

// Map UI mode names to backend mode keys
const UI_TO_BACKEND_MODE: Record<TradingMode, string> = {
  'burst': 'burst',
  'scalper': 'sniper', // scalper uses sniper logic
  'trend': 'trend',
  'swing': 'swing',
  'memory': 'memory',
  'sniper': 'sniper',
  'risk-off': 'news', // risk-off uses news mode (conservative)
  'ai-assist': 'hybrid',
};

// Re-export SessionStatus from session.ts for convenience
export type { SessionStatus } from '@/lib/state/session';

export interface RiskSettings {
  maxDailyDrawdown: number;
  maxPerTradeRisk: number;
  positionSizingMode: 'fixed' | 'percent' | 'volatility';
  dailyProfitTarget: number;
}

export interface ModeConfig {
  // Burst/Scalper specific
  burstTradesPerRun: number;
  maxConcurrentPositions: number;
  burstDuration: 'short' | 'medium' | 'long';
  burstTpStyle: 'fast' | 'scaled';
  
  // Trend/Swing specific
  trendTimeframe: 'intraday' | 'daily' | 'weekly';
  signalSensitivity: 'low' | 'medium' | 'high';
  
  // Memory/AI specific
  lookbackWindow: number;
  confidenceThreshold: number;
}

interface TradingState {
  // Mode state
  selectedMode: TradingMode;
  enabledModes: TradingMode[];
  
  // Risk settings
  riskSettings: RiskSettings;
  
  // Mode configuration
  modeConfig: ModeConfig;
  
  // Initialization flag
  initialized: boolean;
  
  // Actions
  setSelectedMode: (mode: TradingMode) => void;
  toggleMode: (mode: TradingMode) => void;
  updateRiskSettings: (settings: Partial<RiskSettings>) => void;
  updateModeConfig: (config: Partial<ModeConfig>) => void;
  initFromBackend: (config: any) => void;
}

export const useTradingState = create<TradingState>((set, get) => ({
  selectedMode: 'burst',
  enabledModes: ['burst', 'trend'],
  initialized: false,
  
  riskSettings: {
    maxDailyDrawdown: 5,
    maxPerTradeRisk: 1,
    positionSizingMode: 'percent',
    dailyProfitTarget: 1, // Default 1% auto TP target (range 0.25% - 20%)
  },
  
  modeConfig: {
    burstTradesPerRun: 20,
    maxConcurrentPositions: 20,
    burstDuration: 'short',
    burstTpStyle: 'fast',
    trendTimeframe: 'intraday',
    signalSensitivity: 'medium',
    lookbackWindow: 50,
    confidenceThreshold: 0.7,
  },
  
  setSelectedMode: (mode) => set({ selectedMode: mode }),
  
  toggleMode: (mode) => set((state) => ({
    enabledModes: state.enabledModes.includes(mode)
      ? state.enabledModes.filter(m => m !== mode)
      : [...state.enabledModes, mode]
  })),
  
  updateRiskSettings: (settings) => set((state) => ({
    riskSettings: { ...state.riskSettings, ...settings }
  })),
  
  updateModeConfig: (config) => set((state) => ({
    modeConfig: { ...state.modeConfig, ...config }
  })),
  
  initFromBackend: (config) => {
    if (!config) return;
    
    const riskConfig = config.risk_config || {};
    const burstConfig = config.burst_config || {};
    const modeConfig = config.mode_config || {};
    
    set({
      initialized: true,
      riskSettings: {
        maxDailyDrawdown: riskConfig.maxDailyLossPercent || 5,
        maxPerTradeRisk: riskConfig.maxPerTradeRiskPercent || 1,
        positionSizingMode: 'percent',
        dailyProfitTarget: burstConfig.dailyProfitTargetPercent || 1, // Default 1%
      },
      modeConfig: {
        burstTradesPerRun: burstConfig.size || 20,
        maxConcurrentPositions: riskConfig.maxOpenTrades || 20,
        burstDuration: 'short',
        burstTpStyle: 'fast',
        trendTimeframe: 'intraday',
        signalSensitivity: 'medium',
        lookbackWindow: 50,
        confidenceThreshold: 0.7,
      },
    });
  },
}));

// Debounce helper
function debounce<T extends (...args: any[]) => any>(fn: T, ms: number) {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}

// Combined hook for full session state with database sync
export function useFullSessionState() {
  const { accountType, status, selectedSymbol, setAccountType, setStatus, setSymbol } = useSession();
  const tradingState = useTradingState();
  const { data: paperData } = usePaperStats();
  const { updateConfig } = usePaperConfig();
  
  // Initialize state from backend config
  useEffect(() => {
    if (paperData?.config && !tradingState.initialized) {
      tradingState.initFromBackend(paperData.config);
    }
  }, [paperData?.config, tradingState.initialized]);
  
  // Derive isRunning from status for backward compatibility
  const isRunning = status === 'running';
  
  // Get performance from paper stats
  const todayPnl = paperData?.stats?.todayPnl || 0;
  const todayPnlPercent = paperData?.stats?.todayPnlPercent || 0;
  const tradesToday = paperData?.stats?.tradesToday || 0;
  const winRate = paperData?.stats?.winRate || 0;
  const equity = paperData?.stats?.equity || 10000;
  
  // Helper to set running state (backward compatible)
  const setRunning = (val: boolean) => setStatus(val ? 'running' : 'idle');
  
  // Persist mode selection to backend
  const setSelectedMode = useCallback((mode: TradingMode) => {
    tradingState.setSelectedMode(mode);
    
    // Map UI mode to backend mode and update enabled modes
    const backendMode = UI_TO_BACKEND_MODE[mode];
    const enabledModes = [backendMode, 'trend', 'burst', 'news', 'memory']; // Include common modes
    
    console.log(`[SESSION] selectedMode set to=${mode} (backend=${backendMode})`);
    
    // Persist to database
    updateConfig.mutate({
      mode_config: {
        enabledModes,
        modeSettings: {},
      },
    });
  }, [updateConfig]);
  
  // Persist risk settings to backend (debounced)
  const persistRiskSettings = useCallback(
    debounce(async (settings: RiskSettings) => {
      console.log(`[RISK] config updated: perTradeRisk=${settings.maxPerTradeRisk}% maxDD=${settings.maxDailyDrawdown}%`);
      
      updateConfig.mutate({
        risk_config: {
          maxDailyLossPercent: settings.maxDailyDrawdown,
          maxConcurrentRiskPercent: 10, // Fixed for paper trading
          maxOpenTrades: 20,
          maxPerSymbolExposure: 30,
          maxPerTradeRiskPercent: settings.maxPerTradeRisk,
        },
        burst_config: {
          size: tradingState.modeConfig.burstTradesPerRun,
          dailyProfitTargetPercent: settings.dailyProfitTarget,
          riskPerBurstPercent: 2,
        },
      });
    }, 500),
    [updateConfig, tradingState.modeConfig.burstTradesPerRun]
  );
  
  const updateRiskSettings = useCallback((settings: Partial<RiskSettings>) => {
    tradingState.updateRiskSettings(settings);
    const newSettings = { ...tradingState.riskSettings, ...settings };
    persistRiskSettings(newSettings);
  }, [persistRiskSettings, tradingState.riskSettings]);
  
  // Persist mode config to backend (debounced)
  const persistModeConfig = useCallback(
    debounce(async (config: ModeConfig, riskSettings: RiskSettings) => {
      console.log(`[SESSION] modeConfig updated: burstSize=${config.burstTradesPerRun} maxConcurrent=${config.maxConcurrentPositions}`);
      
      updateConfig.mutate({
        burst_config: {
          size: config.burstTradesPerRun,
          dailyProfitTargetPercent: riskSettings.dailyProfitTarget,
          riskPerBurstPercent: 2,
        },
        risk_config: {
          maxDailyLossPercent: riskSettings.maxDailyDrawdown,
          maxConcurrentRiskPercent: 10,
          maxOpenTrades: config.maxConcurrentPositions,
          maxPerSymbolExposure: 50,
        },
      });
    }, 500),
    [updateConfig]
  );
  
  const updateModeConfig = useCallback((config: Partial<ModeConfig>) => {
    tradingState.updateModeConfig(config);
    const newConfig = { ...tradingState.modeConfig, ...config };
    persistModeConfig(newConfig, tradingState.riskSettings);
  }, [persistModeConfig, tradingState.modeConfig, tradingState.riskSettings]);
  
  return {
    // Account state
    accountType,
    setAccountType,
    
    // Session state
    isRunning,
    setRunning,
    setStatus,
    status,
    
    // Symbol state
    selectedSymbol,
    setSymbol,
    
    // Mode state
    selectedMode: tradingState.selectedMode,
    enabledModes: tradingState.enabledModes,
    setSelectedMode,
    toggleMode: tradingState.toggleMode,
    
    // Risk settings
    riskSettings: tradingState.riskSettings,
    updateRiskSettings,
    
    // Mode config
    modeConfig: tradingState.modeConfig,
    updateModeConfig,
    
    // Performance metrics
    equity,
    todayPnl,
    todayPnlPercent,
    tradesToday,
    winRate,
  };
}

// Mode descriptions
export const MODE_INFO: Record<TradingMode, { name: string; description: string }> = {
  burst: {
    name: 'Burst Mode',
    description: 'Execute rapid clusters of micro-trades targeting quick profits. Best for high-volatility periods.',
  },
  scalper: {
    name: 'Scalper Mode', 
    description: 'Capture small price movements with tight stops. Requires fast execution and low spreads.',
  },
  trend: {
    name: 'Trend Mode',
    description: 'Follow established market trends with dynamic position sizing. Rides momentum for larger gains.',
  },
  swing: {
    name: 'Swing Mode',
    description: 'Capture multi-day price swings using higher timeframes. Lower frequency, larger targets.',
  },
  memory: {
    name: 'Memory Mode',
    description: 'Adapts risk and sizing based on recent performance. Increases exposure after wins, reduces after losses.',
  },
  sniper: {
    name: 'Sniper Mode',
    description: 'Waits for high-confidence setups only. Low frequency but high precision entries.',
  },
  'risk-off': {
    name: 'Risk-Off Mode',
    description: 'Reduces all risk parameters significantly. Use during uncertain market conditions.',
  },
  'ai-assist': {
    name: 'AI-Assist Mode',
    description: 'Leverages AI analysis for trade decisions. Combines multiple signals for enhanced accuracy.',
  },
};
