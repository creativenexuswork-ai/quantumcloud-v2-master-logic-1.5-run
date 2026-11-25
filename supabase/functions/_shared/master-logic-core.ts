// ============= MASTER LOGIC v1.5 — PURE DECISION CORE =============
// Shared between paper-tick and the offline research faithful adapter so
// regime classification, mode profiles, and candidate scoring cannot diverge.

import { decideDirection, type ModeKey, type Side } from './paper-core.ts';

export type TrendBias = 'bull' | 'bear' | 'neutral';
export type MarketStructure = 'trend' | 'range';
export type VolatilityLevel = 'low' | 'normal' | 'high';

export interface MasterRegimeSnapshot {
  symbol: string;
  trendBias: TrendBias;
  structure: MarketStructure;
  volatility: VolatilityLevel;
  trendStrength: number;
  volatilityRatio: number;
  confidence: number;
  smaAlignment: 'bullish' | 'bearish' | 'mixed';
}

export interface MasterModeProfile {
  key: ModeKey;
  maxConcurrentTradesPerSymbol: number;
  maxConcurrentTradesTotal: number;
  maxEntriesPerTick: number;
  basePositionSizeFactor: number;
  entryScoreThreshold: number;
  edgeConfidenceMin: number;
  defaultStopPercent: number;
  defaultTPMultiplier: number;
  maxHoldMinutes: number;
  preferredStructures: MarketStructure[];
  preferredVolatility: VolatilityLevel[];
  allowedInAnyRegime: boolean;
  trailingStopActivation: number;
  trailingStopDistance: number;
  cutLoserThreshold: number;
}

export const MASTER_MODE_PROFILES: Record<ModeKey, MasterModeProfile> = {
  burst: {
    key: 'burst', maxConcurrentTradesPerSymbol: 5, maxConcurrentTradesTotal: 15, maxEntriesPerTick: 3,
    basePositionSizeFactor: 0.5, entryScoreThreshold: 25, edgeConfidenceMin: 0.3, defaultStopPercent: 0.4,
    defaultTPMultiplier: 1.5, maxHoldMinutes: 15, preferredStructures: ['trend', 'range'],
    preferredVolatility: ['high', 'normal'], allowedInAnyRegime: true, trailingStopActivation: 0.5,
    trailingStopDistance: 0.25, cutLoserThreshold: -0.3,
  },
  scalper: {
    key: 'scalper', maxConcurrentTradesPerSymbol: 3, maxConcurrentTradesTotal: 8, maxEntriesPerTick: 2,
    basePositionSizeFactor: 0.6, entryScoreThreshold: 35, edgeConfidenceMin: 0.4, defaultStopPercent: 0.25,
    defaultTPMultiplier: 1.5, maxHoldMinutes: 10, preferredStructures: ['range', 'trend'],
    preferredVolatility: ['normal', 'high'], allowedInAnyRegime: true, trailingStopActivation: 0.4,
    trailingStopDistance: 0.2, cutLoserThreshold: -0.2,
  },
  trend: {
    key: 'trend', maxConcurrentTradesPerSymbol: 2, maxConcurrentTradesTotal: 5, maxEntriesPerTick: 1,
    basePositionSizeFactor: 1.0, entryScoreThreshold: 50, edgeConfidenceMin: 0.5, defaultStopPercent: 1.0,
    defaultTPMultiplier: 2.5, maxHoldMinutes: 120, preferredStructures: ['trend'],
    preferredVolatility: ['normal', 'high'], allowedInAnyRegime: false, trailingStopActivation: 1.0,
    trailingStopDistance: 0.5, cutLoserThreshold: -0.8,
  },
  adaptive: {
    key: 'adaptive', maxConcurrentTradesPerSymbol: 3, maxConcurrentTradesTotal: 10, maxEntriesPerTick: 2,
    basePositionSizeFactor: 0.7, entryScoreThreshold: 35, edgeConfidenceMin: 0.4, defaultStopPercent: 0.5,
    defaultTPMultiplier: 2.0, maxHoldMinutes: 60, preferredStructures: ['trend', 'range'],
    preferredVolatility: ['high', 'normal', 'low'], allowedInAnyRegime: true, trailingStopActivation: 0.6,
    trailingStopDistance: 0.3, cutLoserThreshold: -0.5,
  },
};

function sma(prices: readonly number[], period: number): number {
  if (prices.length < period) return prices.length > 0 ? prices[prices.length - 1] : 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** Exact Master Logic v1.5 regime classifier on the last <= 50 price points. */
export function classifyRegimeFromPrices(symbol: string, rawPrices: readonly number[]): MasterRegimeSnapshot {
  const prices = rawPrices.length > 50 ? rawPrices.slice(-50) : rawPrices;
  if (prices.length < 10) {
    return {
      symbol, trendBias: 'neutral', structure: 'range', volatility: 'normal',
      trendStrength: 40, volatilityRatio: 1, confidence: 0.4, smaAlignment: 'mixed',
    };
  }
  const sma5 = sma(prices, 5);
  const sma20 = sma(prices, Math.min(20, prices.length));
  const currentPrice = prices[prices.length - 1];

  let bullishCount = 0;
  if (currentPrice > sma5) bullishCount++;
  if (sma5 > sma20) bullishCount++;
  if (currentPrice > sma20) bullishCount++;
  const smaAlignment: 'bullish' | 'bearish' | 'mixed' =
    bullishCount >= 2 ? 'bullish' : bullishCount <= 1 ? 'bearish' : 'mixed';

  let ups = 0, downs = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) ups++;
    else if (prices[i] < prices[i - 1]) downs++;
  }
  const directionalStrength = Math.abs(ups - downs) / Math.max(1, ups + downs);
  const trendStrength = Math.min(100, directionalStrength * 50 + (smaAlignment !== 'mixed' ? 25 : 0));
  const trendBias: TrendBias = ups > downs && trendStrength > 35 ? 'bull'
    : downs > ups && trendStrength > 35 ? 'bear' : 'neutral';

  let atrSum = 0;
  for (let i = 1; i < prices.length; i++) atrSum += Math.abs(prices[i] - prices[i - 1]);
  const atr = atrSum / (prices.length - 1);
  const recentDiffs = prices.slice(-20).map((p, i, arr) => (i > 0 ? Math.abs(p - arr[i - 1]) : 0)).slice(1);
  const baselineAtr = sma(recentDiffs, 19) || atr;
  const volatilityRatio = prices.length > 20 && baselineAtr > 0 ? atr / baselineAtr : 1;
  const volatility: VolatilityLevel = volatilityRatio > 1.3 ? 'high' : volatilityRatio < 0.7 ? 'low' : 'normal';
  const structure: MarketStructure = trendStrength > 45 ? 'trend' : 'range';

  let confidence = 0.5;
  if (prices.length >= 30) confidence += 0.2;
  if (smaAlignment !== 'mixed') confidence += 0.15;
  confidence = Math.min(0.9, confidence);

  return { symbol, trendBias, structure, volatility, trendStrength, volatilityRatio, confidence, smaAlignment };
}

export function sessionQualityFromUtcHour(hour: number): number {
  if (hour >= 13 && hour < 17) return 0.95; // London/NY overlap
  if (hour >= 8 && hour < 13) return 0.85;  // London
  if (hour >= 17 && hour < 21) return 0.8;  // NY
  if (hour >= 0 && hour < 8) return 0.65;   // Asia
  return 0.5;
}

export interface ScoredMasterDecision {
  passed: boolean;
  side: Side | null;
  qualityScore: number;
  confidence: number;
  threshold: number;
  reasons: string[];
}

/** Exact Master Logic v1.5 candidate scorer + filter. */
export function scoreMasterCandidate(
  profile: MasterModeProfile,
  regime: MasterRegimeSnapshot,
  sessionQuality: number,
  thermostatAggression: number,
  thermostatRegimeTag: 'CALM' | 'NORMAL' | 'HOT' | 'DANGER',
  existingCount: number,
): ScoredMasterDecision {
  if (existingCount >= profile.maxConcurrentTradesPerSymbol) {
    return { passed: false, side: null, qualityScore: 0, confidence: 0, threshold: profile.entryScoreThreshold, reasons: ['max_per_symbol'] };
  }
  const reasons: string[] = [];
  let score = 40;
  if (profile.preferredStructures.includes(regime.structure)) { score += 25; reasons.push(regime.structure); }
  else if (profile.allowedInAnyRegime) score += 10;
  else score -= 15;

  if (profile.preferredVolatility.includes(regime.volatility)) { score += 20; reasons.push(`${regime.volatility} vol`); }
  if (regime.trendBias !== 'neutral') { score += 10; reasons.push(regime.trendBias); }
  if (profile.preferredStructures.includes('trend')) score += (regime.trendStrength / 100) * 20;
  score += regime.confidence * 10;
  if (sessionQuality >= 0.7) { score += 5; reasons.push('good session'); }
  score *= (0.7 + thermostatAggression * 0.3);
  if (existingCount > 0) score -= existingCount * 10;

  const side = decideDirection(regime.trendBias, regime.confidence);
  if (!side) return { passed: false, side: null, qualityScore: 0, confidence: 0, threshold: profile.entryScoreThreshold, reasons: ['no_evidence'] };

  const qualityScore = Math.max(0, Math.min(100, score));
  const confidence = Math.max(0.3, Math.min(0.95, 0.5 + (score - 50) / 100));
  const threshold = profile.entryScoreThreshold
    - (thermostatAggression > 0.7 ? 5 : 0)
    + (thermostatRegimeTag === 'DANGER' ? 15 : 0);
  const passed = qualityScore >= threshold && confidence >= profile.edgeConfidenceMin;
  return { passed, side, qualityScore, confidence, threshold, reasons };
}