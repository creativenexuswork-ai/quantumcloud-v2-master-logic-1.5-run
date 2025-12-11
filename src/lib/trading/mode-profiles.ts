// ============= MODE PROFILES v1.5 =============
// Comprehensive mode configurations with all trading parameters

import type { RegimeSnapshot } from './regime';

export type TradingModeKey = 'burst' | 'scalper' | 'trend' | 'adaptive';

export interface ModeProfile {
  key: TradingModeKey;
  name: string;
  description: string;
  
  // Position limits
  maxConcurrentTradesPerSymbol: number;
  maxConcurrentTradesTotal: number;
  maxEntriesPerTick: number;
  
  // Sizing
  basePositionSizeFactor: number;  // Multiplier on risk panel setting
  minSizeFactor: number;           // Minimum size even in bad conditions
  maxSizeFactor: number;           // Maximum size even in good conditions
  
  // Entry sensitivity (lower = more trades)
  entryScoreThreshold: number;     // 0-100, minimum score to enter
  edgeConfidenceMin: number;       // 0-1, minimum edge confidence
  regimeScoreMin: number;          // 0-100, minimum regime suitability
  
  // Risk/Reward
  targetRRMin: number;
  targetRRMax: number;
  defaultStopPercent: number;      // % of price for SL
  defaultTPMultiplier: number;     // TP = SL * this
  
  // Time management
  maxHoldMinutes: number;
  cooldownAfterStopMinutes: number;
  cooldownAfterTPMinutes: number;
  
  // Regime preferences (which regimes this mode likes)
  preferredStructures: ('trend' | 'range')[];
  preferredVolatility: ('high' | 'normal' | 'low')[];
  allowedInAnyRegime: boolean;     // If true, trades in any regime (just sizes differently)
  
  // Trade management
  trailingStopActivation: number;  // % profit to activate trailing
  trailingStopDistance: number;    // % distance for trailing
  cutLoserThreshold: number;       // % loss to cut early
  
  // Session preferences
  preferredSessions: string[];     // Session names this mode prefers
  sessionQualityMin: number;       // 0-1, minimum session quality
}

/**
 * BURST MODE - High activity, aggressive, fast profit-taking
 * Philosophy: "Many small bites, capture momentum"
 */
export const BURST_PROFILE: ModeProfile = {
  key: 'burst',
  name: 'Burst',
  description: 'High-frequency cluster trading with tight targets',
  
  maxConcurrentTradesPerSymbol: 5,
  maxConcurrentTradesTotal: 15,
  maxEntriesPerTick: 3,
  
  basePositionSizeFactor: 0.5,
  minSizeFactor: 0.2,
  maxSizeFactor: 1.0,
  
  entryScoreThreshold: 25,        // Very permissive
  edgeConfidenceMin: 0.3,
  regimeScoreMin: 25,
  
  targetRRMin: 0.5,
  targetRRMax: 1.5,
  defaultStopPercent: 0.4,
  defaultTPMultiplier: 1.5,
  
  maxHoldMinutes: 15,
  cooldownAfterStopMinutes: 1,
  cooldownAfterTPMinutes: 0,
  
  preferredStructures: ['trend', 'range'],
  preferredVolatility: ['high', 'normal'],
  allowedInAnyRegime: true,       // Burst trades in any regime
  
  trailingStopActivation: 0.5,
  trailingStopDistance: 0.25,
  cutLoserThreshold: -0.3,
  
  preferredSessions: ['London/NY Overlap', 'London Session', 'NY Session', 'London Open'],
  sessionQualityMin: 0.3
};

/**
 * SCALPER MODE - Fast in/out around short-term edges
 * Philosophy: "Quick precision strikes, tight risk"
 */
export const SCALPER_PROFILE: ModeProfile = {
  key: 'scalper',
  name: 'Scalper',
  description: 'Fast trades with tight stops and targets',
  
  maxConcurrentTradesPerSymbol: 3,
  maxConcurrentTradesTotal: 8,
  maxEntriesPerTick: 2,
  
  basePositionSizeFactor: 0.6,
  minSizeFactor: 0.3,
  maxSizeFactor: 1.2,
  
  entryScoreThreshold: 35,
  edgeConfidenceMin: 0.4,
  regimeScoreMin: 35,
  
  targetRRMin: 1.0,
  targetRRMax: 2.0,
  defaultStopPercent: 0.25,
  defaultTPMultiplier: 1.5,
  
  maxHoldMinutes: 10,
  cooldownAfterStopMinutes: 2,
  cooldownAfterTPMinutes: 0,
  
  preferredStructures: ['range', 'trend'],
  preferredVolatility: ['normal', 'high'],
  allowedInAnyRegime: true,
  
  trailingStopActivation: 0.4,
  trailingStopDistance: 0.2,
  cutLoserThreshold: -0.2,
  
  preferredSessions: ['London/NY Overlap', 'London Session', 'NY Session'],
  sessionQualityMin: 0.5
};

/**
 * TREND MODE - Fewer trades, ride larger swings
 * Philosophy: "Quality over quantity, let winners run"
 */
export const TREND_PROFILE: ModeProfile = {
  key: 'trend',
  name: 'Trend',
  description: 'Trend-following with wider stops and larger targets',
  
  maxConcurrentTradesPerSymbol: 2,
  maxConcurrentTradesTotal: 5,
  maxEntriesPerTick: 1,
  
  basePositionSizeFactor: 1.0,
  minSizeFactor: 0.5,
  maxSizeFactor: 1.5,
  
  entryScoreThreshold: 50,
  edgeConfidenceMin: 0.5,
  regimeScoreMin: 45,
  
  targetRRMin: 2.0,
  targetRRMax: 5.0,
  defaultStopPercent: 1.0,
  defaultTPMultiplier: 2.5,
  
  maxHoldMinutes: 120,
  cooldownAfterStopMinutes: 5,
  cooldownAfterTPMinutes: 2,
  
  preferredStructures: ['trend'],
  preferredVolatility: ['normal', 'high'],
  allowedInAnyRegime: false,     // Trend mode is stricter about regime
  
  trailingStopActivation: 1.0,
  trailingStopDistance: 0.5,
  cutLoserThreshold: -0.8,
  
  preferredSessions: ['London/NY Overlap', 'London Session', 'NY Session'],
  sessionQualityMin: 0.7
};

/**
 * ADAPTIVE MODE - Meta-mode that switches between modes
 * Uses weighted combination of other modes based on conditions
 */
export const ADAPTIVE_PROFILE: ModeProfile = {
  key: 'adaptive',
  name: 'Adaptive',
  description: 'Dynamically switches between Burst/Scalper/Trend based on conditions',
  
  // These are defaults - adaptive will adjust based on active sub-mode
  maxConcurrentTradesPerSymbol: 3,
  maxConcurrentTradesTotal: 10,
  maxEntriesPerTick: 2,
  
  basePositionSizeFactor: 0.7,
  minSizeFactor: 0.3,
  maxSizeFactor: 1.3,
  
  entryScoreThreshold: 35,
  edgeConfidenceMin: 0.4,
  regimeScoreMin: 35,
  
  targetRRMin: 1.0,
  targetRRMax: 3.0,
  defaultStopPercent: 0.5,
  defaultTPMultiplier: 2.0,
  
  maxHoldMinutes: 60,
  cooldownAfterStopMinutes: 2,
  cooldownAfterTPMinutes: 1,
  
  preferredStructures: ['trend', 'range'],
  preferredVolatility: ['high', 'normal', 'low'],
  allowedInAnyRegime: true,
  
  trailingStopActivation: 0.6,
  trailingStopDistance: 0.3,
  cutLoserThreshold: -0.5,
  
  preferredSessions: ['London/NY Overlap', 'London Session', 'NY Session', 'London Open'],
  sessionQualityMin: 0.4
};

// Profile registry
export const MODE_PROFILES: Record<TradingModeKey, ModeProfile> = {
  burst: BURST_PROFILE,
  scalper: SCALPER_PROFILE,
  trend: TREND_PROFILE,
  adaptive: ADAPTIVE_PROFILE
};

/**
 * Get profile for a mode
 */
export function getModeProfile(mode: TradingModeKey): ModeProfile {
  return MODE_PROFILES[mode] || SCALPER_PROFILE;
}

/**
 * Calculate adjusted profile parameters based on regime
 */
export function getAdjustedProfile(
  baseProfile: ModeProfile,
  regime: RegimeSnapshot,
  sessionQuality: number,
  thermostatAggression: number // 0-1
): {
  sizeMultiplier: number;
  entryThresholdAdjust: number;
  tpMultiplier: number;
  slMultiplier: number;
} {
  let sizeMultiplier = 1.0;
  let entryThresholdAdjust = 0;
  let tpMultiplier = 1.0;
  let slMultiplier = 1.0;
  
  // Regime adjustments
  if (regime.structure === 'trend' && baseProfile.preferredStructures.includes('trend')) {
    sizeMultiplier += 0.15;
    entryThresholdAdjust -= 5;
  } else if (regime.structure === 'range' && !baseProfile.preferredStructures.includes('range')) {
    sizeMultiplier -= 0.2;
    entryThresholdAdjust += 10;
  }
  
  // Volatility adjustments
  if (regime.volatility === 'high') {
    if (baseProfile.preferredVolatility.includes('high')) {
      tpMultiplier = 1.3;
      slMultiplier = 1.2;
    } else {
      sizeMultiplier -= 0.2;
      slMultiplier = 1.4;
    }
  } else if (regime.volatility === 'low') {
    if (!baseProfile.preferredVolatility.includes('low')) {
      sizeMultiplier -= 0.15;
      tpMultiplier = 0.8;
    }
  }
  
  // Session quality adjustments
  if (sessionQuality < 0.5) {
    sizeMultiplier -= 0.2;
    entryThresholdAdjust += 10;
  } else if (sessionQuality >= 0.9) {
    sizeMultiplier += 0.1;
    entryThresholdAdjust -= 5;
  }
  
  // Thermostat adjustments
  if (thermostatAggression < 0.3) {
    sizeMultiplier *= 0.7;
    entryThresholdAdjust += 15;
  } else if (thermostatAggression > 0.7) {
    sizeMultiplier *= 1.2;
    entryThresholdAdjust -= 5;
  }
  
  // Clamp values
  sizeMultiplier = Math.max(baseProfile.minSizeFactor, Math.min(baseProfile.maxSizeFactor, sizeMultiplier));
  entryThresholdAdjust = Math.max(-20, Math.min(30, entryThresholdAdjust));
  tpMultiplier = Math.max(0.5, Math.min(2.0, tpMultiplier));
  slMultiplier = Math.max(0.5, Math.min(2.0, slMultiplier));
  
  return {
    sizeMultiplier,
    entryThresholdAdjust,
    tpMultiplier,
    slMultiplier
  };
}

/**
 * Determine which mode Adaptive should act like based on conditions
 */
export function selectAdaptiveSubMode(
  regime: RegimeSnapshot,
  sessionQuality: number,
  thermostatAggression: number,
  recentPerformance: { burst: number; scalper: number; trend: number }
): { mode: 'burst' | 'scalper' | 'trend'; reason: string; confidence: number } {
  const scores: Record<'burst' | 'scalper' | 'trend', number> = {
    burst: 50,
    scalper: 50,
    trend: 50
  };
  
  // Regime structure influence
  if (regime.structure === 'trend') {
    scores.trend += 25;
    scores.burst += 10;
    scores.scalper -= 5;
  } else {
    scores.scalper += 20;
    scores.burst += 15;
    scores.trend -= 15;
  }
  
  // Volatility influence
  if (regime.volatility === 'high') {
    scores.burst += 20;
    scores.trend += 10;
    scores.scalper += 5;
  } else if (regime.volatility === 'low') {
    scores.scalper += 15;
    scores.burst -= 10;
    scores.trend -= 10;
  }
  
  // Trend strength influence
  if (regime.trendStrength > 60) {
    scores.trend += 15;
    scores.burst += 5;
  } else if (regime.trendStrength < 30) {
    scores.scalper += 10;
    scores.trend -= 20;
  }
  
  // Session quality influence
  if (sessionQuality >= 0.8) {
    scores.burst += 15;
    scores.trend += 10;
  } else if (sessionQuality < 0.5) {
    scores.burst -= 10;
    scores.trend -= 15;
    scores.scalper += 5;
  }
  
  // Thermostat influence
  if (thermostatAggression > 0.7) {
    scores.burst += 15;
    scores.scalper += 5;
  } else if (thermostatAggression < 0.3) {
    scores.burst -= 15;
    scores.trend -= 5;
    scores.scalper += 10;
  }
  
  // Recent performance influence (smaller weight)
  scores.burst += recentPerformance.burst * 5;
  scores.scalper += recentPerformance.scalper * 5;
  scores.trend += recentPerformance.trend * 5;
  
  // Find winner
  const entries = Object.entries(scores) as [('burst' | 'scalper' | 'trend'), number][];
  entries.sort((a, b) => b[1] - a[1]);
  
  const [winner, winnerScore] = entries[0];
  const [runnerUp, runnerUpScore] = entries[1];
  
  const confidence = Math.min(1, (winnerScore - runnerUpScore) / 50 + 0.5);
  
  const reasons: string[] = [];
  if (regime.structure === 'trend') reasons.push('trending');
  if (regime.volatility === 'high') reasons.push('high vol');
  if (sessionQuality >= 0.8) reasons.push('prime session');
  if (thermostatAggression > 0.7) reasons.push('aggressive');
  
  return {
    mode: winner,
    reason: reasons.length > 0 ? reasons.join(', ') : 'balanced conditions',
    confidence
  };
}
