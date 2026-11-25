import { readFileSync } from 'fs';
import { parseOhlcvCsv } from './csv';
import { returnCorrelation, runBacktest, runWalkForward } from './engine';
import { buildSyntheticFixture } from './fixtures';
import type { BacktestMode } from './types';

const args = process.argv.slice(2);
const csvIdx = args.indexOf('--csv');
const symIdx = args.indexOf('--symbol');
const symbol = symIdx >= 0 && args[symIdx + 1] ? args[symIdx + 1] : 'BTCUSD';

let bars = buildSyntheticFixture(120, 50000, 0);
let datasetLabel = 'SYNTHETIC_TEST_FIXTURE_ONLY (not historical market data)';

if (csvIdx >= 0 && args[csvIdx + 1]) {
  const raw = readFileSync(args[csvIdx + 1], 'utf8');
  const parsed = parseOhlcvCsv(raw);
  if (!parsed.ok) {
    console.error('CSV validation failed:', parsed.errors);
    process.exit(1);
  }
  bars = parsed.bars;
  datasetLabel = args[csvIdx + 1];
}

const modes: BacktestMode[] = ['burst', 'scalper', 'trend'];
const report: Record<string, unknown> = { dataset: datasetLabel, symbol, bars: bars.length, modes: {} };

for (const mode of modes) {
  const cfg = {
    symbol, mode, openingCapital: 10000, perTradeRiskPct: 1, maxConcurrentPositions: 3,
    costModel: { takerFeeBps: 5, slippageBps: 2, spreadBps: 4 },
    trailingActivationPct: 0.6, trailingDistancePct: 0.3, maxHoldBars: 24,
  };
  const res = runBacktest(bars, cfg);
  const wf = runWalkForward(bars, cfg, 3, 0.7);
  (report.modes as Record<string, unknown>)[mode] = { metrics: res.metrics, walkForward: wf };
}

if (csvIdx < 0) {
  const ethFixture = buildSyntheticFixture(120, 3000, 1);
  report.syntheticCrossAssetCorrelation = returnCorrelation(bars, ethFixture);
}

console.log(JSON.stringify(report, null, 2));