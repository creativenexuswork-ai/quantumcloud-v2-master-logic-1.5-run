// ============= RESEARCH EXPERIMENTS: SPLITS, SENSITIVITY & PORTFOLIO =============
import { runBacktest } from './engine';
import type { BacktestConfig, BacktestResult, OhlcvBar, StrategyAdapter } from './types';

export interface TrainValTestSplit {
  train: OhlcvBar[];
  validation: OhlcvBar[];
  test: OhlcvBar[];
}

/** Strict chronological 3-way split (default 60% train / 20% validation / 20% test). */
export function splitTrainValTest(bars: readonly OhlcvBar[], trainFrac = 0.6, valFrac = 0.2): TrainValTestSplit {
  const n = bars.length;
  const trainEnd = Math.floor(n * trainFrac);
  const valEnd = Math.floor(n * (trainFrac + valFrac));
  return {
    train: bars.slice(0, trainEnd),
    validation: bars.slice(trainEnd, valEnd),
    test: bars.slice(valEnd),
  };
}

export interface GridExperimentReport {
  trialsEvaluated: number;
  multipleTestingNote: string;
  selectedParams: Record<string, number>;
  trainNetReturnPct: number;
  validationNetReturnPct: number;
  testNetReturnPct: number;
  testMaxDrawdownPct: number;
  testTrades: number;
}

/**
 * Evaluates a parameter grid on TRAIN/VALIDATION only, selects top candidate by VALIDATION,
 * and reports untouched TEST performance with multiple-testing accounting.
 */
export function runGuardedGridExperiment(
  bars: readonly OhlcvBar[],
  baseConfig: BacktestConfig,
  adapter: StrategyAdapter,
  paramGrid: Array<Record<string, number>>,
): GridExperimentReport {
  if (paramGrid.length === 0) throw new Error('paramGrid must be non-empty');
  const { train, validation, test } = splitTrainValTest(bars);
  let bestParams = paramGrid[0];
  let bestValScore = -Infinity;
  let bestTrainRet = 0;

  for (const params of paramGrid) {
    const trainRes = runBacktest(train, { ...baseConfig, strategyParams: params }, adapter);
    const valRes = runBacktest(validation, { ...baseConfig, strategyParams: params }, adapter);
    if (valRes.metrics.netReturnPct > bestValScore) {
      bestValScore = valRes.metrics.netReturnPct;
      bestParams = params;
      bestTrainRet = trainRes.metrics.netReturnPct;
    }
  }

  const testRes = runBacktest(test, { ...baseConfig, strategyParams: bestParams }, adapter);
  return {
    trialsEvaluated: paramGrid.length,
    multipleTestingNote: `Evaluated ${paramGrid.length} parameter sets on train/validation; test set untouched until final evaluation (Bonferroni alpha=${(0.05 / paramGrid.length).toFixed(4)}).`,
    selectedParams: bestParams,
    trainNetReturnPct: bestTrainRet,
    validationNetReturnPct: bestValScore,
    testNetReturnPct: testRes.metrics.netReturnPct,
    testMaxDrawdownPct: testRes.metrics.maxDrawdownPct,
    testTrades: testRes.metrics.totalTrades,
  };
}

export interface SensitivityScenario {
  label: string;
  netReturnPct: number;
  maxDrawdownPct: number;
  totalTrades: number;
  profitFactor: number | null;
}

/** Robustness sensitivity across fees, slippage, spread, latency, and stop-fill ambiguity. */
export function runRobustnessSensitivity(
  bars: readonly OhlcvBar[],
  baseConfig: BacktestConfig,
  adapter: StrategyAdapter,
): SensitivityScenario[] {
  const scenarios: Array<{ label: string; patch: Partial<BacktestConfig> }> = [
    { label: 'baseline', patch: {} },
    { label: '2x_fees', patch: { costModel: { ...baseConfig.costModel, takerFeeBps: baseConfig.costModel.takerFeeBps * 2 } } },
    { label: '2x_slippage', patch: { costModel: { ...baseConfig.costModel, slippageBps: baseConfig.costModel.slippageBps * 2 } } },
    { label: '2x_spread', patch: { costModel: { ...baseConfig.costModel, spreadBps: baseConfig.costModel.spreadBps * 2 } } },
    { label: 'latency_2bars', patch: { latencyBars: 2 } },
    { label: 'optimistic_tp_first', patch: { intrabarAssumption: 'optimistic_tp_first' } },
  ];
  return scenarios.map(s => {
    const res = runBacktest(bars, { ...baseConfig, ...s.patch }, adapter);
    return {
      label: s.label,
      netReturnPct: res.metrics.netReturnPct,
      maxDrawdownPct: res.metrics.maxDrawdownPct,
      totalTrades: res.metrics.totalTrades,
      profitFactor: res.metrics.profitFactor,
    };
  });
}

function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const denom = Math.sqrt(da * db);
  return denom > 0 ? num / denom : null;
}

export interface PortfolioAnalysis {
  combinedNetReturnPct: number;
  combinedMaxDrawdownPct: number;
  returnCorrelationMatrix: Record<string, Record<string, number | null>>;
}

/** Combines equal-weight equity curves from multiple runs (modes or assets) and computes return correlations. */
export function analyzeCombinedPortfolio(runs: Record<string, BacktestResult>): PortfolioAnalysis {
  const keys = Object.keys(runs);
  const minLen = Math.min(...keys.map(k => runs[k].equityCurve.length));
  const returnsByKey: Record<string, number[]> = {};
  for (const k of keys) {
    const eq = runs[k].equityCurve.slice(0, minLen).map(p => p.equity);
    returnsByKey[k] = eq.slice(1).map((v, i) => (eq[i] > 0 ? (v - eq[i]) / eq[i] : 0));
  }
  const matrix: Record<string, Record<string, number | null>> = {};
  for (const a of keys) {
    matrix[a] = {};
    for (const b of keys) {
      matrix[a][b] = a === b ? 1 : pearson(returnsByKey[a], returnsByKey[b]);
    }
  }
  let combinedEq = 1;
  let peak = 1;
  let maxDd = 0;
  const steps = Math.max(0, minLen - 1);
  for (let i = 0; i < steps; i++) {
    const avgRet = keys.reduce((s, k) => s + (returnsByKey[k][i] ?? 0), 0) / Math.max(1, keys.length);
    combinedEq *= 1 + avgRet;
    if (combinedEq > peak) peak = combinedEq;
    const dd = peak > 0 ? ((peak - combinedEq) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return {
    combinedNetReturnPct: (combinedEq - 1) * 100,
    combinedMaxDrawdownPct: maxDd,
    returnCorrelationMatrix: matrix,
  };
}