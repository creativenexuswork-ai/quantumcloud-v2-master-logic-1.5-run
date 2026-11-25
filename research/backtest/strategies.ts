import type { BacktestMode, OhlcvBar, StrategyAdapter, StrategySignal } from './types';

function sma(bars: readonly OhlcvBar[], period: number): number {
  const slice = bars.slice(-period);
  return slice.reduce((s, b) => s + b.close, 0) / slice.length;
}

/** Trend adapter: fast/slow SMA crossover + momentum confirmation. Sees ONLY history[0..i]. */
export const trendAdapter: StrategyAdapter = (history, params): StrategySignal | null => {
  const fast = Math.max(2, Math.round(params?.fastPeriod ?? 5));
  const slow = Math.max(fast + 1, Math.round(params?.slowPeriod ?? 15));
  if (history.length < slow) return null;
  const f = sma(history, fast);
  const s = sma(history, slow);
  const diffPct = ((f - s) / s) * 100;
  const minDiff = params?.minDiffPct ?? 0.15;
  if (diffPct >= minDiff) return { side: 'long', stopPct: params?.stopPct ?? 0.8, tpMultiplier: params?.tpMultiplier ?? 2.0, reason: 'trend_sma_bull' };
  if (diffPct <= -minDiff) return { side: 'short', stopPct: params?.stopPct ?? 0.8, tpMultiplier: params?.tpMultiplier ?? 2.0, reason: 'trend_sma_bear' };
  return null;
};

/** Scalper adapter: short-term mean-reversion off local SMA band. Sees ONLY history[0..i]. */
export const scalperAdapter: StrategyAdapter = (history, params): StrategySignal | null => {
  const period = Math.max(3, Math.round(params?.period ?? 10));
  if (history.length < period) return null;
  const mean = sma(history, period);
  const last = history[history.length - 1].close;
  const devPct = ((last - mean) / mean) * 100;
  const band = params?.bandPct ?? 0.4;
  if (devPct <= -band) return { side: 'long', stopPct: params?.stopPct ?? 0.4, tpMultiplier: params?.tpMultiplier ?? 1.5, reason: 'scalper_oversold' };
  if (devPct >= band) return { side: 'short', stopPct: params?.stopPct ?? 0.4, tpMultiplier: params?.tpMultiplier ?? 1.5, reason: 'scalper_overbought' };
  return null;
};

/** Burst adapter: breakout above/below N-bar range. Sees ONLY history[0..i]. */
export const burstAdapter: StrategyAdapter = (history, params): StrategySignal | null => {
  const lookback = Math.max(3, Math.round(params?.lookback ?? 8));
  if (history.length < lookback + 1) return null;
  const prev = history.slice(-(lookback + 1), -1);
  const last = history[history.length - 1];
  const hi = Math.max(...prev.map(b => b.high));
  const lo = Math.min(...prev.map(b => b.low));
  if (last.close > hi) return { side: 'long', stopPct: params?.stopPct ?? 0.5, tpMultiplier: params?.tpMultiplier ?? 1.6, reason: 'burst_breakout_high' };
  if (last.close < lo) return { side: 'short', stopPct: params?.stopPct ?? 0.5, tpMultiplier: params?.tpMultiplier ?? 1.6, reason: 'burst_breakout_low' };
  return null;
};

export const STRATEGY_ADAPTERS: Record<BacktestMode, StrategyAdapter> = {
  burst: burstAdapter,
  scalper: scalperAdapter,
  trend: trendAdapter,
};