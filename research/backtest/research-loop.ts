/**
 * Reproducible Offline Research Runner (Research Only — No Promotion / No Live Execution).
 * Loads verified Binance Vision CSVs from manifest.json, validates continuity (gaps/duplicates),
 * compares Faithful Master Logic v1.5 vs Prototype adapters, runs walk-forward OOS,
 * sensitivity sweeps, regime attribution, strategy-return correlations, and guarded variants,
 * and writes research/results/baseline-report.json + research/results/baseline-report.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseOhlcvCsv } from './csv';
import { runBacktest, runWalkForward } from './engine';
import {
  analyzeByRegime,
  analyzeCombinedPortfolio,
  runGuardedGridExperiment,
  runRobustnessSensitivity,
} from './experiments';
import { FAITHFUL_MASTER_LOGIC_ADAPTERS, PROTOTYPE_ADAPTERS } from './strategies';
import type { BacktestConfig, BacktestMode, OhlcvBar } from './types';

interface ManifestEntry {
  sourceUrl: string;
  market: string;
  symbol: string;
  interval: string;
  month: string;
  sha256: string;
  checksumVerified: boolean;
  csvPath: string;
  provenance: { format: string; timestampUnit: string; rowCount: number; firstTs: number; lastTs: number };
}

function checkSeriesIntegrity(bars: readonly OhlcvBar[], expectedStepMs: number) {
  let gaps = 0;
  let duplicates = 0;
  for (let i = 1; i < bars.length; i++) {
    const diff = bars[i].ts - bars[i - 1].ts;
    if (diff <= 0) duplicates++;
    else if (diff > expectedStepMs) gaps++;
  }
  return {
    bars: bars.length,
    firstIso: bars.length ? new Date(bars[0].ts).toISOString() : null,
    lastIso: bars.length ? new Date(bars[bars.length - 1].ts).toISOString() : null,
    gaps,
    duplicates,
  };
}

function fmt(n: number | null, digits = 2): string {
  return n === null || !Number.isFinite(n) ? 'n/a' : n.toFixed(digits);
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const dataDir = getArg('--data-dir', '/tmp/research-data/binance');
  const outDir = getArg('--out-dir', 'research/results');
  const interval = getArg('--interval', '1h');
  const expectedStepMs = interval === '15m' ? 15 * 60_000 : 60 * 60_000;

  const manifestRaw = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as {
    generatedAt: string;
    entries: ManifestEntry[];
  };
  const filtered = manifestRaw.entries.filter(e => e.interval === interval);
  const grouped = new Map<string, ManifestEntry[]>();
  for (const e of filtered) {
    const key = `${e.market}:${e.symbol}:${e.interval}`;
    const arr = grouped.get(key) ?? [];
    arr.push(e);
    grouped.set(key, arr);
  }

  const baseCost = { spreadBps: 2, slippageBps: 3, takerFeeBps: 10 };
  const baseCfg = {
    openingCapital: 10_000,
    perTradeRiskPct: 0.5,
    maxConcurrentPositions: 3,
    costModel: baseCost,
  };

  const datasetSummaries: Record<string, unknown> = {};
  const seriesMap: Record<string, OhlcvBar[]> = {};
  for (const [key, entries] of grouped.entries()) {
    entries.sort((a, b) => a.month.localeCompare(b.month));
    const allBars: OhlcvBar[] = [];
    const units = new Set<string>();
    for (const e of entries) {
      const parsed = parseOhlcvCsv(readFileSync(e.csvPath, 'utf8'));
      if (!parsed.ok) throw new Error(`Failed parsing ${e.csvPath}: ${parsed.errors.join('; ')}`);
      units.add(parsed.provenance.timestampUnit);
      allBars.push(...parsed.bars);
    }
    seriesMap[key] = allBars;
    datasetSummaries[key] = {
      archives: entries.length,
      allChecksumsVerified: entries.every(e => e.checksumVerified),
      timestampUnits: Array.from(units),
      sampleChecksums: [entries[0]?.sha256, entries[entries.length - 1]?.sha256].filter(Boolean),
      ...checkSeriesIntegrity(allBars, expectedStepMs),
    };
  }

  const modes: BacktestMode[] = ['burst', 'scalper', 'trend'];
  const rows: Array<Record<string, unknown>> = [];
  const faithfulRunsForPortfolio: Record<string, ReturnType<typeof runBacktest>> = {};

  for (const [seriesKey, bars] of Object.entries(seriesMap)) {
    const [market, symbol] = seriesKey.split(':');
    for (const mode of modes) {
      const cfg: BacktestConfig = { ...baseCfg, symbol, mode };
      const fRes = runBacktest(bars, cfg, FAITHFUL_MASTER_LOGIC_ADAPTERS[mode]);
      const pRes = runBacktest(bars, cfg, PROTOTYPE_ADAPTERS[mode]);
      const wf = runWalkForward(bars, cfg, 5, 0.7);
      const oosAvg = wf.length ? wf.reduce((s, x) => s + x.testReturnPct, 0) / wf.length : 0;
      if (market === 'spot') faithfulRunsForPortfolio[`${symbol}_${mode}`] = fRes;
      rows.push({
        series: seriesKey, adapter: 'faithful_master_v15', mode,
        trades: fRes.metrics.totalTrades, netReturnPct: fRes.metrics.netReturnPct,
        expectancy: fRes.metrics.expectancy, profitFactor: fRes.metrics.profitFactor,
        maxDrawdownPct: fRes.metrics.maxDrawdownPct, avgExposurePct: fRes.metrics.avgExposurePct,
        turnover: fRes.metrics.turnover, totalFees: fRes.metrics.totalFees,
        walkForwardOosAvgPct: oosAvg, regimeBreakdown: analyzeByRegime(bars, fRes),
      });
      rows.push({
        series: seriesKey, adapter: 'prototype_sma_range', mode,
        trades: pRes.metrics.totalTrades, netReturnPct: pRes.metrics.netReturnPct,
        expectancy: pRes.metrics.expectancy, profitFactor: pRes.metrics.profitFactor,
        maxDrawdownPct: pRes.metrics.maxDrawdownPct, avgExposurePct: pRes.metrics.avgExposurePct,
        turnover: pRes.metrics.turnover, totalFees: pRes.metrics.totalFees,
        walkForwardOosAvgPct: null, regimeBreakdown: null,
      });
    }
  }

  const primaryKey = Object.keys(seriesMap).find(k => k.startsWith('spot:BTCUSDT:')) ?? Object.keys(seriesMap)[0];
  const primaryBars = seriesMap[primaryKey];
  const primaryCfg: BacktestConfig = { ...baseCfg, symbol: 'BTCUSDT', mode: 'trend' };
  const sensitivity = runRobustnessSensitivity(primaryBars, primaryCfg, FAITHFUL_MASTER_LOGIC_ADAPTERS.trend);
  const portfolio = analyzeCombinedPortfolio(faithfulRunsForPortfolio);

  // Controlled single-dimension hypothesis variants + guarded train/val/test grid (20% untouched holdout)
  const guardedGrid = runGuardedGridExperiment(
    primaryBars,
    primaryCfg,
    FAITHFUL_MASTER_LOGIC_ADAPTERS.trend,
    [
      { stopPct: 1.0, tpMultiplier: 2.5 }, // Master Logic v1.5 baseline
      { stopPct: 1.5, tpMultiplier: 2.5 }, // Hypothesis 1: wider 1h stop
      { stopPct: 2.0, tpMultiplier: 3.0 }, // Hypothesis 2: 1h swing stop + 3R target
      { stopPct: 2.5, tpMultiplier: 3.0 }, // Hypothesis 3: wide volatility-tolerant 1h stop
    ],
  );

  const report = {
    generatedAt: new Date().toISOString(),
    researchOnlyDisclaimer: 'Offline historical research only. No automated promotion, no live execution. Past results do not guarantee future performance.',
    assumptions: {
      costModel: baseCost,
      execution: 'Next bar open (latencyBars=1), conservative_sl_first intrabar, gap-through stops.',
      unavailableLiveInputs: [
        '1-second tick mid-price stream -> proxied by OHLCV bar close series (window <= 50)',
        'Live orderbook / bid-ask quotes -> proxied by BacktestCostModel (spreadBps + slippageBps)',
        'Live thermostat streak memory -> fixed neutral (aggression=0.5, tag=NORMAL) in baseline',
      ],
    },
    datasets: datasetSummaries,
    results: rows,
    primaryTrendSensitivity: { series: primaryKey, scenarios: sensitivity },
    spotFaithfulPortfolio: portfolio,
    guardedVariantExperiment: { series: primaryKey, ...guardedGrid },
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'baseline-report.json'), JSON.stringify(report, null, 2));

  const md: string[] = [
    '# QuantumCloud Offline Research Baseline Report',
    '',
    `Generated: ${report.generatedAt} | **Research Only — No Live Execution / No Auto-Promotion**`,
    '',
    '## 1. Verified Dataset Coverage & Integrity',
    '| Series | Archives | Checksums OK | Units | Bars | First UTC | Last UTC | Gaps | Dupes |',
    '|---|---:|---|---|---:|---|---|---:|---:|',
  ];
  for (const [k, v] of Object.entries(datasetSummaries) as Array<[string, Record<string, unknown>]>) {
    md.push(`| ${k} | ${v.archives} | ${v.allChecksumsVerified} | ${(v.timestampUnits as string[]).join(',')} | ${v.bars} | ${v.firstIso} | ${v.lastIso} | ${v.gaps} | ${v.duplicates} |`);
  }
  md.push('', '## 2. Faithful Master Logic v1.5 vs Prototype Adapters',
    '| Series | Adapter | Mode | Trades | Net % | Exp $ | PF | MaxDD % | Exp% | Turn | Fees $ | WF OOS Avg % |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    md.push(`| ${r.series} | ${r.adapter} | ${r.mode} | ${r.trades} | ${fmt(r.netReturnPct as number)} | ${fmt(r.expectancy as number)} | ${fmt(r.profitFactor as number | null)} | ${fmt(r.maxDrawdownPct as number)} | ${fmt(r.avgExposurePct as number)} | ${fmt(r.turnover as number)} | ${fmt(r.totalFees as number)} | ${fmt(r.walkForwardOosAvgPct as number | null)} |`);
  }
  md.push('', `## 3. Robustness Sensitivity (${primaryKey} — Faithful Trend)`,
    '| Scenario | Net % | MaxDD % | Trades | PF |',
    '|---|---:|---:|---:|---:|');
  for (const s of sensitivity) {
    md.push(`| ${s.label} | ${fmt(s.netReturnPct)} | ${fmt(s.maxDrawdownPct)} | ${s.totalTrades} | ${fmt(s.profitFactor)} |`);
  }
  md.push('', `## 4. Guarded Variant Experiment (${primaryKey} — 60/20/20 Train/Val/Test)`,
    `- Selected params (by validation only): \`${JSON.stringify(guardedGrid.selectedParams)}\``,
    `- Train: ${fmt(guardedGrid.trainNetReturnPct)}% | Validation: ${fmt(guardedGrid.validationNetReturnPct)}% | **Untouched Test**: ${fmt(guardedGrid.testNetReturnPct)}% (maxDD ${fmt(guardedGrid.testMaxDrawdownPct)}%, ${guardedGrid.testTrades} trades)`,
    `- Multiple testing: ${guardedGrid.multipleTestingNote}`,
    '', '## 5. Combined Equal-Weight Spot Faithful Portfolio',
    `- Combined Net Return: ${fmt(portfolio.combinedNetReturnPct)}% | Combined MaxDD: ${fmt(portfolio.combinedMaxDrawdownPct)}%`);
  writeFileSync(join(outDir, 'baseline-report.md'), md.join('\n') + '\n');
  console.log(`Wrote ${join(outDir, 'baseline-report.json')} and ${join(outDir, 'baseline-report.md')}`);
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}