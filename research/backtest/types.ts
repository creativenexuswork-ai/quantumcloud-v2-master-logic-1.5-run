import type { Side } from '../../supabase/functions/_shared/paper-core';

export type BacktestMode = 'burst' | 'scalper' | 'trend';

export interface OhlcvBar {
  ts: number;       // Unix ms (strictly increasing)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestCostModel {
  takerFeeBps: number;   // per side on notional
  slippageBps: number;   // adverse slippage per fill
  spreadBps: number;     // full bid-ask spread (half-spread applied per side)
}

export interface BacktestConfig {
  symbol: string;
  mode: BacktestMode;
  openingCapital: number;
  perTradeRiskPct: number;
  maxConcurrentPositions: number;
  costModel: BacktestCostModel;
  trailingActivationPct?: number;
  trailingDistancePct?: number;
  maxHoldBars?: number;
  strategyParams?: Record<string, number>;
  /** Intrabar stop/TP ordering when both SL and TP fall inside [low, high]. Default: conservative_sl_first. */
  intrabarAssumption?: 'conservative_sl_first' | 'optimistic_tp_first';
  /** Execution latency in bars after signal bar close (default 1 = next bar open; 2 = +1 bar delay). */
  latencyBars?: number;
}

export interface StrategySignal {
  side: Side;
  stopPct: number;       // e.g. 0.5 = 0.5%
  tpMultiplier: number;  // e.g. 1.5 = 1.5R
  reason: string;
}

export type StrategyAdapter = (history: readonly OhlcvBar[], params?: Record<string, number>) => StrategySignal | null;

export interface BacktestTrade {
  id: number;
  symbol: string;
  mode: BacktestMode;
  side: Side;
  signalBarIndex: number;
  entryBarIndex: number;
  exitBarIndex: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  size: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  exitReason: 'sl' | 'tp' | 'trailing_stop' | 'max_hold' | 'end_of_data';
}

export interface EquityPoint {
  ts: number;
  balance: number;
  equity: number;
  exposurePct: number;
}

export interface ModeBreakdown {
  trades: number;
  winRatePct: number;
  netPnl: number;
  expectancy: number;
  profitFactor: number | null;
}

export interface BacktestMetrics {
  openingCapital: number;
  endingEquity: number;
  netReturnPct: number;
  totalTrades: number;
  winRatePct: number;
  expectancy: number;
  profitFactor: number | null;
  maxDrawdownPct: number;
  sharpe: number | null;
  sharpeCaveat: string;
  avgExposurePct: number;
  turnover: number;
  totalFees: number;
  byMode: Record<string, ModeBreakdown>;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
}

export interface WalkForwardSplit {
  fold: number;
  trainRange: [number, number];
  testRange: [number, number];
  trainReturnPct: number;
  testReturnPct: number;
  testTrades: number;
  testMaxDrawdownPct: number;
}