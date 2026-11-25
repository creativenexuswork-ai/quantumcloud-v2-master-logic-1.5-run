import type { OhlcvBar } from './types';

/**
 * SYNTHETIC_TEST_FIXTURE_ONLY — Deterministic synthetic OHLCV series for harness
 * verification. NOT historical market data and MUST NOT be used to judge live edge.
 *
 * Data acquisition path for real research:
 *   Export historical OHLCV CSV (timestamp,open,high,low,close,volume) from a venue
 *   (e.g. Binance Vision / Coinbase / Kraken historical klines) and pass via:
 *   `bun run research/backtest/run.ts --csv ./path/to/BTCUSD_1h.csv --symbol BTCUSD`
 */
export function buildSyntheticFixture(count = 120, startPrice = 50000, phaseOffset = 0): OhlcvBar[] {
  const bars: OhlcvBar[] = [];
  const baseTs = Date.UTC(2026, 0, 1, 0, 0, 0);
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const wave = Math.sin((i + phaseOffset) / 8) * 0.006 + Math.cos((i + phaseOffset) / 21) * 0.004;
    const open = price;
    const close = Number((open * (1 + wave)).toFixed(2));
    const high = Number((Math.max(open, close) * 1.003).toFixed(2));
    const low = Number((Math.min(open, close) * 0.997).toFixed(2));
    bars.push({ ts: baseTs + i * 3600_000, open, high, low, close, volume: 100 + (i % 25) * 10 });
    price = close;
  }
  return bars;
}