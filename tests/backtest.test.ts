import { describe, it, expect } from 'vitest';
import { parseOhlcvCsv } from '../research/backtest/csv';
import { returnCorrelation, runBacktest, runWalkForward } from '../research/backtest/engine';
import {
  analyzeCombinedPortfolio,
  runGuardedGridExperiment,
  runRobustnessSensitivity,
  splitTrainValTest,
} from '../research/backtest/experiments';
import { buildSyntheticFixture } from '../research/backtest/fixtures';
import { FAITHFUL_MASTER_LOGIC_ADAPTERS, PROTOTYPE_ADAPTERS } from '../research/backtest/strategies';
import type { BacktestConfig, OhlcvBar, StrategyAdapter } from '../research/backtest/types';

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

  it('parses official Binance Vision Spot 12-col headerless CSV (milliseconds AND 2025+ microseconds)', () => {
    const msCsv = [
      '1733011200000,96400.00,96800.00,96200.00,96700.00,120.5,1733014799999,11600000,1500,60,5800000,0',
      '1733014800000,96700.00,97000.00,96500.00,96900.00,98.2,1733018399999,9500000,1200,50,4800000,0',
    ].join('\n');
    const msParsed = parseOhlcvCsv(msCsv);
    expect(msParsed.ok).toBe(true);
    if (msParsed.ok) {
      expect(msParsed.provenance.format).toBe('binance_spot_12col_headerless');
      expect(msParsed.provenance.timestampUnit).toBe('milliseconds');
      expect(msParsed.bars[0].ts).toBe(1733011200000);
    }

    const usCsv = [
      '1735689600000000,93576.00,94509.42,93489.03,94401.14,755.99,1735693199999999,71112000,12000,400,37600000,0',
      '1735693200000000,94401.14,94600.00,94100.00,94250.00,512.10,1735696799999999,48300000,9000,250,23500000,0',
    ].join('\n');
    const usParsed = parseOhlcvCsv(usCsv);
    expect(usParsed.ok).toBe(true);
    if (usParsed.ok) {
      expect(usParsed.provenance.format).toBe('binance_spot_12col_headerless');
      expect(usParsed.provenance.timestampUnit).toBe('microseconds');
      expect(usParsed.bars[0].ts).toBe(1735689600000);
    }
  });

  it('parses official Binance Vision USD-M Futures 12-col CSV with headers', () => {
    const futCsv = [
      'open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore',
      '1735689600000,93576.0,94500.0,93400.0,94400.0,1500.5,1735693199999,141000000,25000,800,75000000,0',
      '1735693200000,94400.0,94700.0,94100.0,94300.0,1200.0,1735696799999,113000000,20000,600,56500000,0',
    ].join('\n');
    const parsed = parseOhlcvCsv(futCsv);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.provenance.format).toBe('binance_futures_12col_header');
      expect(parsed.bars).toHaveLength(2);
    }
  });

  it('respects intrabar SL/TP ordering and latencyBars', () => {
    const bars: OhlcvBar[] = [
      { ts: 1000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { ts: 2000, open: 100, high: 105, low: 95, close: 100, volume: 10 },
      { ts: 3000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
    ];
    const oneShot: StrategyAdapter = (h) => (h.length === 1 ? { side: 'long', stopPct: 1, tpMultiplier: 2, reason: 'test' } : null);
    const conservative = runBacktest(bars, { ...baseConfig, costModel: { spreadBps: 0, slippageBps: 0, takerFeeBps: 0 }, intrabarAssumption: 'conservative_sl_first' }, oneShot);
    const optimistic = runBacktest(bars, { ...baseConfig, costModel: { spreadBps: 0, slippageBps: 0, takerFeeBps: 0 }, intrabarAssumption: 'optimistic_tp_first' }, oneShot);
    expect(conservative.trades[0].exitReason).toBe('sl');
    expect(optimistic.trades[0].exitReason).toBe('tp');

    const delayed = runBacktest(bars, { ...baseConfig, costModel: { spreadBps: 0, slippageBps: 0, takerFeeBps: 0 }, latencyBars: 2 }, oneShot);
    expect(delayed.trades[0].entryBarIndex).toBe(2);
  });

  it('runs faithful Master Logic v1.5 adapter, guarded train/val/test grid, sensitivity & combined portfolio', () => {
    const bars = buildSyntheticFixture(120, 100);
    const split = splitTrainValTest(bars);
    expect(split.train.length + split.validation.length + split.test.length).toBe(120);
    expect(split.train[split.train.length - 1].ts).toBeLessThan(split.validation[0].ts);
    expect(split.validation[split.validation.length - 1].ts).toBeLessThan(split.test[0].ts);

    const faithfulRes = runBacktest(bars, { ...baseConfig, mode: 'trend' }, FAITHFUL_MASTER_LOGIC_ADAPTERS.trend);
    const protoRes = runBacktest(bars, { ...baseConfig, mode: 'trend' }, PROTOTYPE_ADAPTERS.trend);
    expect(faithfulRes.equityCurve).toHaveLength(120);
    expect(protoRes.equityCurve).toHaveLength(120);

    const grid = runGuardedGridExperiment(
      bars,
      { ...baseConfig, mode: 'trend' },
      FAITHFUL_MASTER_LOGIC_ADAPTERS.trend,
      [{ stopPct: 0.8, tpMultiplier: 2.0 }, { stopPct: 1.0, tpMultiplier: 2.5 }],
    );
    expect(grid.trialsEvaluated).toBe(2);
    expect(grid.multipleTestingNote).toContain('Bonferroni');

    const sens = runRobustnessSensitivity(bars, { ...baseConfig, mode: 'trend' }, FAITHFUL_MASTER_LOGIC_ADAPTERS.trend);
    expect(sens.map(s => s.label)).toEqual(['baseline', '2x_fees', '2x_slippage', '2x_spread', 'latency_2bars', 'optimistic_tp_first']);

    const portfolio = analyzeCombinedPortfolio({ faithful: faithfulRes, prototype: protoRes });
    expect(portfolio.returnCorrelationMatrix.faithful.faithful).toBe(1);
  });
});