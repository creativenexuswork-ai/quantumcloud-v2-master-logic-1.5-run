import { describe, it, expect } from 'vitest';
import { parseOhlcvCsv } from '../research/backtest/csv';
import { returnCorrelation, runBacktest, runWalkForward } from '../research/backtest/engine';
import { buildSyntheticFixture } from '../research/backtest/fixtures';
import type { BacktestConfig, OhlcvBar } from '../research/backtest/types';

const baseConfig: BacktestConfig = {
  symbol: 'BTCUSD',
  mode: 'trend',
  openingCapital: 10000,
  perTradeRiskPct: 1,
  maxConcurrentPositions: 1,
  costModel: { takerFeeBps: 5, slippageBps: 2, spreadBps: 4 },
};

describe('CSV validation', () => {
  it('parses valid OHLCV CSV', () => {
    const csv = 'timestamp,open,high,low,close,volume\n2026-01-01T00:00:00Z,100,105,98,103,10\n2026-01-01T01:00:00Z,103,106,101,104,12';
    const r = parseOhlcvCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bars).toHaveLength(2);
  });
  it('rejects non-monotonic timestamps and invalid OHLC invariants', () => {
    const bad = 'timestamp,open,high,low,close,volume\n1700000100,100,99,98,100,5\n1700000000,100,105,95,102,-1';
    const r = parseOhlcvCsv(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('backtest engine guarantees', () => {
  const fixture = buildSyntheticFixture(120, 50000, 0);

  it('is strictly deterministic across identical runs', () => {
    const a = runBacktest(fixture, baseConfig);
    const b = runBacktest(fixture, baseConfig);
    expect(a.trades).toEqual(b.trades);
    expect(a.metrics).toEqual(b.metrics);
  });

  it('enforces no-lookahead and executes no earlier than next bar open', () => {
    let maxSeenLength = 0;
    const res = runBacktest(fixture, baseConfig, (history) => {
      // Each call must see strictly increasing prefix length (never future bars)
      expect(history.length).toBeGreaterThan(maxSeenLength);
      maxSeenLength = history.length;
      return history.length === 5 ? { side: 'long', stopPct: 1, tpMultiplier: 2, reason: 'test' } : null;
    });
    expect(res.trades.length).toBeGreaterThanOrEqual(1);
    for (const t of res.trades) {
      expect(t.entryBarIndex).toBeGreaterThanOrEqual(t.signalBarIndex + 1);
    }
  });

  it('commission, slippage, and spread strictly reduce net return', () => {
    const zeroCost = runBacktest(fixture, { ...baseConfig, costModel: { takerFeeBps: 0, slippageBps: 0, spreadBps: 0 } });
    const withCost = runBacktest(fixture, { ...baseConfig, costModel: { takerFeeBps: 10, slippageBps: 5, spreadBps: 10 } });
    expect(withCost.metrics.totalFees).toBeGreaterThan(0);
    expect(withCost.metrics.endingEquity).toBeLessThan(zeroCost.metrics.endingEquity);
  });

  it('compounds equity into subsequent position sizing', () => {
    // Crafted rising bars: trade 1 wins at TP, trade 2 opens with larger balance -> larger size
    const bars: OhlcvBar[] = [
      { ts: 1000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { ts: 2000, open: 100, high: 105, low: 99.5, close: 104, volume: 10 }, // trade 1 enters 100, hits TP 102
      { ts: 3000, open: 100, high: 101, low: 99, close: 100, volume: 10 },   // signal 2
      { ts: 4000, open: 100, high: 105, low: 99.5, close: 104, volume: 10 }, // trade 2 enters 100 with higher balance
    ];
    const res = runBacktest(bars, { ...baseConfig, costModel: { takerFeeBps: 0, slippageBps: 0, spreadBps: 0 } }, (h) => {
      if (h.length === 1 || h.length === 3) return { side: 'long', stopPct: 1, tpMultiplier: 2, reason: 'compound_test' };
      return null;
    });
    expect(res.trades).toHaveLength(2);
    expect(res.trades[1].size).toBeGreaterThan(res.trades[0].size);
  });

  it('isolates modes and reports per-mode metrics', () => {
    const burst = runBacktest(fixture, { ...baseConfig, mode: 'burst' });
    const scalper = runBacktest(fixture, { ...baseConfig, mode: 'scalper' });
    const trend = runBacktest(fixture, { ...baseConfig, mode: 'trend' });
    expect(burst.trades.every(t => t.mode === 'burst')).toBe(true);
    expect(scalper.trades.every(t => t.mode === 'scalper')).toBe(true);
    expect(trend.trades.every(t => t.mode === 'trend')).toBe(true);
    if (trend.trades.length > 0) expect(trend.metrics.byMode.trend.trades).toBe(trend.trades.length);
  });

  it('walk-forward splits are strictly chronological with zero train/test overlap', () => {
    const splits = runWalkForward(fixture, baseConfig, 3, 0.7);
    expect(splits).toHaveLength(3);
    for (let i = 0; i < splits.length; i++) {
      expect(splits[i].trainRange[1]).toBeLessThan(splits[i].testRange[0]);
      if (i > 0) expect(splits[i - 1].testRange[1]).toBeLessThan(splits[i].trainRange[0]);
    }
  });

  it('computes cross-asset return correlation accurately', () => {
    const a = buildSyntheticFixture(60, 50000, 0);
    const same = returnCorrelation(a, a);
    expect(same).toBeCloseTo(1, 8);
    const shifted = buildSyntheticFixture(60, 3000, 10);
    const corr = returnCorrelation(a, shifted);
    expect(corr).not.toBeNull();
    expect(corr!).toBeGreaterThanOrEqual(-1);
    expect(corr!).toBeLessThanOrEqual(1);
  });
});