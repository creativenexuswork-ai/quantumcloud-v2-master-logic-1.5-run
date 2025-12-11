// Core Trading Types - designed for extensibility to real brokers

export type SymbolType = 'crypto' | 'forex' | 'index' | 'metal';
export type MarketRegime = 'trend' | 'range' | 'high_vol' | 'low_vol';
export type TradingMode = 'sniper' | 'burst' | 'trend' | 'swing' | 'memory' | 'stealth' | 'news' | 'hybrid';
export type Side = 'long' | 'short';

export interface PriceTick {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  timestamp: string;
  volatility?: number;
  regime?: MarketRegime;
}

export interface SymbolInfo {
  id: string;
  symbol: string;
  name: string;
  type: SymbolType;
  isActive: boolean;
  spreadEstimate: number;
}

export interface Position {
  id: string;
  userId: string;
  symbol: string;
  mode: TradingMode;
  side: Side;
  size: number;
  entryPrice: number;
  sl?: number;
  tp?: number;
  openedAt: string;
  unrealizedPnl: number;
  batchId?: string;
}

export interface ClosedTrade {
  id: string;
  userId: string;
  symbol: string;
  mode: TradingMode;
  side: Side;
  size: number;
  entryPrice: number;
  exitPrice: number;
  sl?: number;
  tp?: number;
  openedAt: string;
  closedAt: string;
  realizedPnl: number;
  reason?: string;
  sessionDate: string;
  batchId?: string;
}

export interface RiskConfig {
  maxDailyLossPercent: number;
  maxConcurrentRiskPercent: number;
  maxOpenTrades?: number;
  maxPerSymbolExposure?: number;
}

export interface BurstConfig {
  size: number;
  dailyProfitTargetPercent: number;
  riskPerBurstPercent?: number;
}

export interface ModeConfig {
  enabledModes: TradingMode[];
  modeSettings: Record<TradingMode, {
    riskPerTrade?: number;
    frequency?: 'low' | 'medium' | 'high';
    intensity?: 'safe' | 'balanced' | 'aggressive';
  }>;
}

export interface MarketConfig {
  selectedSymbols: string[];
  typeFilters: Record<SymbolType, boolean>;
}

export interface PaperConfig {
  userId: string;
  riskConfig: RiskConfig;
  burstConfig: BurstConfig;
  modeConfig: ModeConfig;
  marketConfig: MarketConfig;
  tradingHaltedForDay: boolean;
  burstRequested: boolean;
  useAiReasoning: boolean;
  showAdvancedExplanations: boolean;
  brokerApiUrl?: string;
}

export interface PaperSessionStats {
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

export interface ProposedOrder {
  symbol: string;
  side: Side;
  size: number;
  entryPrice: number;
  sl?: number;
  tp?: number;
  mode: TradingMode;
  reason?: string;
  confidence?: number;
  batchId?: string;
}

export interface EngineContext {
  userId: string;
  config: PaperConfig;
  ticks: Record<string, PriceTick>;
  positions: Position[];
  recentTrades: ClosedTrade[];
  stats: PaperSessionStats;
  equity: number;
}

export interface EngineState {
  positions: Position[];
  trades: ClosedTrade[];
  stats: PaperSessionStats;
  logs: SystemLog[];
  halted: boolean;
}

export interface SystemLog {
  level: 'info' | 'warning' | 'error';
  source: string;
  message: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

// Risk check result
export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  maxAllowedOrders?: number;
}
