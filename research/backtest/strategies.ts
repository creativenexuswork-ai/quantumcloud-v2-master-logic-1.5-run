import {
  MASTER_MODE_PROFILES,
  classifyRegimeFromPrices,
  scoreMasterCandidate,
  sessionQualityFromUtcHour,
} from '../../supabase/functions/_shared/master-logic-core';
import type { BacktestMode, OhlcvBar, StrategyAdapter, StrategySignal } from './types';

function sma(bars: readonly OhlcvBar[], period: number): number {
  const slice = bars.slice(-period);
  return slice.reduce((s, b) => s + b.close, 0) / slice.length;
}

/** PROTOTYPE ONLY (not QuantumCloud Master Logic): simple fast/slow SMA crossover. */
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

/** PROTOTYPE ONLY (not QuantumCloud Master Logic): simple SMA band mean-reversion. */
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

/** PROTOTYPE ONLY (not QuantumCloud Master Logic): simple N-bar range breakout. */
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

export const PROTOTYPE_ADAPTERS: Record<BacktestMode, StrategyAdapter> = {
  burst: burstAdapter,
  scalper: scalperAdapter,
  trend: trendAdapter,
};

/**
 * FAITHFUL MASTER LOGIC v1.5 ADAPTERS — shares pure decision core with paper-tick.
 *
 * Transparent proxy / exclusion boundaries for historical OHLCV replay:
 *  - Price history: bar close series proxies the live 1s tick mid-price stream (window <= 50).
 *  - Session quality: derived from bar UTC hour (exact match to getSessionInfo).
 *  - Thermostat: defaults to neutral (aggression=0.5, tag='NORMAL') unless overridden via params.
 *  - Live bid/ask orderbook & live flow: unavailable in OHLCV -> proxied by BacktestCostModel.
 */
function buildFaithfulAdapter(mode: BacktestMode): StrategyAdapter {
  return (history, params): StrategySignal | null => {
    if (history.length < 10) return null;
    const profile = MASTER_MODE_PROFILES[mode];
    const prices = history.slice(-50).map(b => b.close);
    const lastBar = history[history.length - 1];
    const regime = classifyRegimeFromPrices('RESEARCH', prices);
    const sessionQuality = sessionQualityFromUtcHour(new Date(lastBar.ts).getUTCHours());
    const aggression = params?.thermostatAggression ?? 0.5;
    const decision = scoreMasterCandidate(profile, regime, sessionQuality, aggression, 'NORMAL', 0);
    if (!decision.passed || !decision.side) return null;
    return {
      side: decision.side,
      stopPct: params?.stopPct ?? profile.defaultStopPercent,
      tpMultiplier: params?.tpMultiplier ?? profile.defaultTPMultiplier,
      reason: `master_v15_${mode}:${decision.reasons.join(',')}`,
    };
  };
}

export const FAITHFUL_MASTER_LOGIC_ADAPTERS: Record<BacktestMode, StrategyAdapter> = {
  burst: buildFaithfulAdapter('burst'),
  scalper: buildFaithfulAdapter('scalper'),
  trend: buildFaithfulAdapter('trend'),
};

/** Default adapters point to the faithful Master Logic v1.5 implementation. */
export const STRATEGY_ADAPTERS: Record<BacktestMode, StrategyAdapter> = FAITHFUL_MASTER_LOGIC_ADAPTERS;