import { netClosePnl, sizeFromRisk, type Side } from '../../supabase/functions/_shared/paper-core';
import { STRATEGY_ADAPTERS } from './strategies';
import type {
  BacktestConfig, BacktestCostModel, BacktestMetrics, BacktestResult, BacktestTrade,
  EquityPoint, ModeBreakdown, OhlcvBar, StrategyAdapter, StrategySignal, WalkForwardSplit,
} from './types';

interface OpenPos {
  id: number;
  side: Side;
  signalBarIndex: number;
  entryBarIndex: number;
  entryTs: number;
  entryPrice: number;
  size: number;
  sl: number;
  tp: number;
  slInProfit: boolean;
}

function fillPrice(side: Side, action: 'entry' | 'exit', refPrice: number, cost: BacktestCostModel): number {
  const halfSpread = (cost.spreadBps / 2) / 10000;
  const slip = cost.slippageBps / 10000;
  const adverse = halfSpread + slip;
  const isBuy = (side === 'long' && action === 'entry') || (side === 'short' && action === 'exit');
  return isBuy ? refPrice * (1 + adverse) : refPrice * (1 - adverse);
}

/**
 * Deterministic offline backtest replay.
 * - Strict no-lookahead: strategy adapter at bar i ONLY receives bars.slice(0, i + 1).
 * - Conservative execution: signal on bar i executes at bar i+1 open (with spread + slippage).
 * - Conservative intra-bar stops: if both SL and TP are touched in the same bar, SL hits first.
 */
export function runBacktest(
  bars: readonly OhlcvBar[],
  config: BacktestConfig,
  adapterOverride?: StrategyAdapter,
): BacktestResult {
  const adapter = adapterOverride ?? STRATEGY_ADAPTERS[config.mode];
  const intrabarAssumption = config.intrabarAssumption ?? 'conservative_sl_first';
  const latencyBars = config.latencyBars ?? 1;
  if (!Number.isInteger(latencyBars) || latencyBars < 1) throw new Error('latencyBars must be an integer >= 1');
  let balance = config.openingCapital;
  let nextTradeId = 1;
  let openPositions: OpenPos[] = [];
  const pendingQueue: Array<{ signal: StrategySignal; signalBarIndex: number; executeAtBar: number }> = [];
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let totalNotionalTraded = 0;

  const closePos = (pos: OpenPos, barIndex: number, bar: OhlcvBar, rawExit: number, reason: BacktestTrade['exitReason']) => {
    const exitPrice = fillPrice(pos.side, 'exit', rawExit, config.costModel);
    const { gross, fees, net } = netClosePnl(pos.side, pos.entryPrice, exitPrice, pos.size, config.costModel.takerFeeBps);
    balance += net;
    totalNotionalTraded += exitPrice * pos.size;
    trades.push({
      id: pos.id, symbol: config.symbol, mode: config.mode, side: pos.side,
      signalBarIndex: pos.signalBarIndex, entryBarIndex: pos.entryBarIndex, exitBarIndex: barIndex,
      entryTs: pos.entryTs, exitTs: bar.ts, entryPrice: pos.entryPrice, exitPrice,
      size: pos.size, grossPnl: gross, fees, netPnl: net, exitReason: reason,
    });
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    // 1) Execute pending signals scheduled for bar i open (never earlier than bar i + latencyBars)
    while (pendingQueue.length > 0 && pendingQueue[0].executeAtBar <= i) {
      const { signal, signalBarIndex } = pendingQueue.shift()!;
      if (openPositions.length < config.maxConcurrentPositions && balance > 0) {
        const entryPrice = fillPrice(signal.side, 'entry', bar.open, config.costModel);
        const stopDist = entryPrice * (signal.stopPct / 100);
        const sl = signal.side === 'long' ? entryPrice - stopDist : entryPrice + stopDist;
        const tp = signal.side === 'long'
          ? entryPrice + stopDist * signal.tpMultiplier
          : entryPrice - stopDist * signal.tpMultiplier;
        const size = sizeFromRisk(balance, config.perTradeRiskPct, entryPrice, sl);
        if (size > 0) {
          totalNotionalTraded += entryPrice * size;
          openPositions.push({
            id: nextTradeId++, side: signal.side, signalBarIndex, entryBarIndex: i,
            entryTs: bar.ts, entryPrice, size, sl, tp, slInProfit: false,
          });
        }
      }
    }

    // 2) Manage open positions on bar i (handles gap-through stops + configurable intrabar SL/TP order)
    const remaining: OpenPos[] = [];
    for (const pos of openPositions) {
      const long = pos.side === 'long';
      const slHit = long ? bar.low <= pos.sl : bar.high >= pos.sl;
      const tpHit = long ? bar.high >= pos.tp : bar.low <= pos.tp;
      const slFillRef = long ? Math.min(pos.sl, bar.open) : Math.max(pos.sl, bar.open);
      const tpFillRef = long ? Math.max(pos.tp, bar.open) : Math.min(pos.tp, bar.open);
      const slFirst = intrabarAssumption === 'conservative_sl_first';
      if (slHit && tpHit) {
        if (slFirst) closePos(pos, i, bar, slFillRef, pos.slInProfit ? 'trailing_stop' : 'sl');
        else closePos(pos, i, bar, tpFillRef, 'tp');
        continue;
      }
      if (slHit) {
        closePos(pos, i, bar, slFillRef, pos.slInProfit ? 'trailing_stop' : 'sl');
        continue;
      }
      if (tpHit) {
        closePos(pos, i, bar, tpFillRef, 'tp');
        continue;
      }
      if (config.maxHoldBars && (i - pos.entryBarIndex) >= config.maxHoldBars) {
        closePos(pos, i, bar, bar.close, 'max_hold');
        continue;
      }
      // Trailing stop ratchet (arms on favorable close)
      if (config.trailingActivationPct && config.trailingDistancePct) {
        const gainPct = ((long ? bar.close - pos.entryPrice : pos.entryPrice - bar.close) / pos.entryPrice) * 100;
        if (gainPct >= config.trailingActivationPct) {
          const d = config.trailingDistancePct / 100;
          const cand = long ? bar.close * (1 - d) : bar.close * (1 + d);
          if (long ? cand > pos.sl : cand < pos.sl) {
            pos.sl = cand;
            pos.slInProfit = long ? pos.sl > pos.entryPrice : pos.sl < pos.entryPrice;
          }
        }
      }
      remaining.push(pos);
    }
    openPositions = remaining;

    // 3) Mark-to-market equity point
    let unrealized = 0;
    let openNotional = 0;
    for (const pos of openPositions) {
      const markExit = fillPrice(pos.side, 'exit', bar.close, config.costModel);
      unrealized += netClosePnl(pos.side, pos.entryPrice, markExit, pos.size, config.costModel.takerFeeBps).net;
      openNotional += bar.close * pos.size;
    }
    const equity = balance + unrealized;
    const exposurePct = equity > 0 ? (openNotional / equity) * 100 : 0;
    equityCurve.push({ ts: bar.ts, balance, equity, exposurePct });

    // 4) Generate next-bar signal using ONLY bars[0..i]
    if (i + latencyBars < bars.length && openPositions.length + pendingQueue.length < config.maxConcurrentPositions) {
      const sig = adapter(bars.slice(0, i + 1), config.strategyParams);
      if (sig) pendingQueue.push({ signal: sig, signalBarIndex: i, executeAtBar: i + latencyBars });
    }
  }

  // Close any remaining positions at last bar close
  if (bars.length > 0 && openPositions.length > 0) {
    const lastIdx = bars.length - 1;
    const lastBar = bars[lastIdx];
    for (const pos of openPositions) closePos(pos, lastIdx, lastBar, lastBar.close, 'end_of_data');
    equityCurve[equityCurve.length - 1] = { ts: lastBar.ts, balance, equity: balance, exposurePct: 0 };
  }

  return { config, trades, equityCurve, metrics: computeMetrics(config.openingCapital, trades, equityCurve, totalNotionalTraded) };
}

export function computeMetrics(
  openingCapital: number,
  trades: readonly BacktestTrade[],
  equityCurve: readonly EquityPoint[],
  totalNotionalTraded: number,
): BacktestMetrics {
  const endingEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : openingCapital;
  const netReturnPct = openingCapital > 0 ? ((endingEquity - openingCapital) / openingCapital) * 100 : 0;
  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const totalNet = trades.reduce((s, t) => s + t.netPnl, 0);
  const totalFees = trades.reduce((s, t) => s + t.fees, 0);
  const winRatePct = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const expectancy = trades.length > 0 ? totalNet / trades.length : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0);

  let peak = openingCapital;
  let maxDrawdownPct = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    if (peak > 0) {
      const dd = ((peak - pt.equity) / peak) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) returns.push((equityCurve[i].equity - prev) / prev);
  }
  let sharpe: number | null = null;
  if (returns.length >= 2) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    sharpe = std > 0 ? (mean / std) * Math.sqrt(returns.length) : null;
  }

  const avgExposurePct = equityCurve.length > 0
    ? equityCurve.reduce((s, p) => s + p.exposurePct, 0) / equityCurve.length
    : 0;
  const avgEq = equityCurve.length > 0
    ? equityCurve.reduce((s, p) => s + p.equity, 0) / equityCurve.length
    : openingCapital;
  const turnover = avgEq > 0 ? totalNotionalTraded / avgEq : 0;

  const byMode: Record<string, ModeBreakdown> = {};
  for (const t of trades) {
    const bucket = byMode[t.mode] ?? { trades: 0, winRatePct: 0, netPnl: 0, expectancy: 0, profitFactor: null };
    bucket.trades += 1;
    bucket.netPnl += t.netPnl;
    byMode[t.mode] = bucket;
  }
  for (const mode of Object.keys(byMode)) {
    const mt = trades.filter(t => t.mode === mode);
    const mw = mt.filter(t => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
    const ml = Math.abs(mt.filter(t => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0));
    byMode[mode].winRatePct = (mt.filter(t => t.netPnl > 0).length / mt.length) * 100;
    byMode[mode].expectancy = byMode[mode].netPnl / mt.length;
    byMode[mode].profitFactor = ml > 0 ? mw / ml : (mw > 0 ? null : 0);
  }

  return {
    openingCapital, endingEquity, netReturnPct, totalTrades: trades.length,
    winRatePct, expectancy, profitFactor, maxDrawdownPct, sharpe,
    sharpeCaveat: 'Per-bar Sharpe scaled by sqrt(N); non-annualized and sensitive to bar frequency and small sample sizes.',
    avgExposurePct, turnover, totalFees, byMode,
  };
}

/** Pearson correlation of bar-to-bar close returns between two aligned series. */
export function returnCorrelation(a: readonly OhlcvBar[], b: readonly OhlcvBar[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < n; i++) {
    ra.push((a[i].close - a[i - 1].close) / a[i - 1].close);
    rb.push((b[i].close - b[i - 1].close) / b[i - 1].close);
  }
  const ma = ra.reduce((s, v) => s + v, 0) / ra.length;
  const mb = rb.reduce((s, v) => s + v, 0) / rb.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    const xa = ra[i] - ma;
    const xb = rb[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const denom = Math.sqrt(da * db);
  return denom > 0 ? num / denom : null;
}

/** Walk-forward out-of-sample split runner (strictly chronological, zero overlap). */
export function runWalkForward(
  bars: readonly OhlcvBar[],
  baseConfig: BacktestConfig,
  folds = 3,
  trainRatio = 0.7,
): WalkForwardSplit[] {
  const chunkSize = Math.floor(bars.length / folds);
  if (chunkSize < 10) return [];
  const splits: WalkForwardSplit[] = [];
  for (let f = 0; f < folds; f++) {
    const start = f * chunkSize;
    const end = f === folds - 1 ? bars.length : (f + 1) * chunkSize;
    const splitIdx = start + Math.floor((end - start) * trainRatio);
    const trainBars = bars.slice(start, splitIdx);
    const testBars = bars.slice(splitIdx, end);
    const trainRes = runBacktest(trainBars, baseConfig);
    const testRes = runBacktest(testBars, baseConfig);
    splits.push({
      fold: f + 1,
      trainRange: [start, splitIdx - 1],
      testRange: [splitIdx, end - 1],
      trainReturnPct: trainRes.metrics.netReturnPct,
      testReturnPct: testRes.metrics.netReturnPct,
      testTrades: testRes.metrics.totalTrades,
      testMaxDrawdownPct: testRes.metrics.maxDrawdownPct,
    });
  }
  return splits;
}