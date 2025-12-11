// ============= Entry Engine =============
// Decides whether to open new trades based on edge, environment, and mode

import type { Side, TradingMode, Position, ClosedTrade, PriceTick } from './types';
import type { EnvironmentSummary } from './environment';
import type { EdgeSignal } from './edge';
import type { ThermostatState } from './thermostat';

export type EntryProfile = 'burst_scalp' | 'trend' | 'hybrid';
export type ModePersonality = 'burst' | 'scalper' | 'trend';

export interface EntryDecision {
  shouldEnter: boolean;
  entryDirection: Side | null;
  entryProfile: EntryProfile;
  suggestedEntryZone: { lower: number; upper: number } | null;
  reason: string;
  confidence: number;
}

export interface ModeThresholds {
  minEdgeScore: number;
  minConfidence: number;
  minEnvConfidence: number;
  allowedMarketStates: string[];
  allowedVolStates: string[];
  maxConcurrentPerMode: number;
}

// Mode personality configurations - MORE PERMISSIVE thresholds
const MODE_CONFIGS: Record<ModePersonality, ModeThresholds> = {
  burst: {
    minEdgeScore: 25, // Very low - burst should trade frequently
    minConfidence: 0.3,
    minEnvConfidence: 0.25,
    allowedMarketStates: ['trend_clean', 'trend_messy', 'range_tradeable', 'compression', 'expansion'],
    allowedVolStates: ['expansion', 'compression', 'normal', 'exhaustion', 'spike'],
    maxConcurrentPerMode: 10
  },
  scalper: {
    minEdgeScore: 35, // Medium threshold
    minConfidence: 0.35,
    minEnvConfidence: 0.3,
    allowedMarketStates: ['trend_clean', 'trend_messy', 'range_tradeable'],
    allowedVolStates: ['compression', 'expansion', 'exhaustion', 'normal'],
    maxConcurrentPerMode: 8
  },
  trend: {
    minEdgeScore: 45, // Higher but still reasonable
    minConfidence: 0.4,
    minEnvConfidence: 0.35,
    allowedMarketStates: ['trend_clean', 'trend_messy', 'range_tradeable'],
    allowedVolStates: ['expansion', 'compression', 'normal'],
    maxConcurrentPerMode: 5
  }
};

interface RecentPerformance {
  hitRate: number;    // Win rate 0-100
  avgRR: number;      // Average risk/reward
  recentTrades: number;
}

function calculateRecentPerformance(trades: ClosedTrade[], windowMinutes: number = 60): RecentPerformance {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const recentTrades = trades.filter(t => t.closedAt && t.closedAt > cutoff);
  
  if (recentTrades.length === 0) {
    return { hitRate: 50, avgRR: 1.5, recentTrades: 0 };
  }
  
  const wins = recentTrades.filter(t => t.realizedPnl > 0);
  const hitRate = (wins.length / recentTrades.length) * 100;
  
  const avgWin = wins.length > 0 
    ? wins.reduce((s, t) => s + t.realizedPnl, 0) / wins.length 
    : 0;
  const losses = recentTrades.filter(t => t.realizedPnl < 0);
  const avgLoss = losses.length > 0 
    ? Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0) / losses.length) 
    : 1;
  
  const avgRR = avgLoss > 0 ? avgWin / avgLoss : 1.5;
  
  return { hitRate, avgRR, recentTrades: recentTrades.length };
}

function calculateSuggestedEntryZone(
  tick: PriceTick,
  direction: Side,
  env: EnvironmentSummary
): { lower: number; upper: number } {
  const spread = tick.ask - tick.bid;
  const atrFactor = env.atr > 0 ? env.atr : tick.mid * 0.001;
  
  // Entry zone based on current price and volatility
  const zoneSize = Math.max(spread * 2, atrFactor * 0.3);
  
  if (direction === 'long') {
    // For longs, entry zone is around/below current ask
    return {
      lower: tick.ask - zoneSize,
      upper: tick.ask + zoneSize * 0.5
    };
  } else {
    // For shorts, entry zone is around/above current bid
    return {
      lower: tick.bid - zoneSize * 0.5,
      upper: tick.bid + zoneSize
    };
  }
}

function getPositionCountByMode(positions: Position[], mode: string): number {
  return positions.filter(p => p.mode === mode).length;
}

function getPositionCountBySymbol(positions: Position[], symbol: string): number {
  return positions.filter(p => p.symbol === symbol).length;
}

function hasConflictingPosition(positions: Position[], symbol: string, direction: Side): boolean {
  const symbolPositions = positions.filter(p => p.symbol === symbol);
  return symbolPositions.some(p => p.side !== direction);
}

/**
 * Evaluate whether to enter a trade
 */
export function evaluateEntry(
  symbol: string,
  tick: PriceTick,
  edge: EdgeSignal,
  env: EnvironmentSummary,
  modePersonality: ModePersonality,
  thermostat: ThermostatState,
  positions: Position[],
  recentTrades: ClosedTrade[],
  maxTotalPositions: number = 10
): EntryDecision {
  const config = MODE_CONFIGS[modePersonality];
  const performance = calculateRecentPerformance(recentTrades);
  
  // Thermostat adjustments to thresholds
  const thermoMultiplier = thermostat.aggressionLevel === 'high' ? 0.9 : 
                           thermostat.aggressionLevel === 'low' ? 1.15 : 1.0;
  
  const adjustedMinEdge = config.minEdgeScore * thermoMultiplier;
  const adjustedMinConfidence = config.minConfidence * thermoMultiplier;
  
  // Check 1: Environment quality
  if (env.marketState === 'chaos' || env.marketState === 'dead' || env.marketState === 'range_trap') {
    if (env.environmentConfidence < 0.5) {
      return {
        shouldEnter: false,
        entryDirection: null,
        entryProfile: 'hybrid',
        suggestedEntryZone: null,
        reason: `Poor environment: ${env.marketState}`,
        confidence: 0
      };
    }
  }
  
  // Check 2: Market state allowed for mode
  if (!config.allowedMarketStates.includes(env.marketState)) {
    return {
      shouldEnter: false,
      entryDirection: null,
      entryProfile: mapModeToProfile(modePersonality),
      suggestedEntryZone: null,
      reason: `Market state ${env.marketState} not suitable for ${modePersonality}`,
      confidence: 0
    };
  }
  
  // Check 3: Vol state allowed for mode
  if (!config.allowedVolStates.includes(env.volState)) {
    return {
      shouldEnter: false,
      entryDirection: null,
      entryProfile: mapModeToProfile(modePersonality),
      suggestedEntryZone: null,
      reason: `Vol state ${env.volState} not suitable for ${modePersonality}`,
      confidence: 0
    };
  }
  
  // Check 4: Liquidity
  if (env.liquidityState === 'broken') {
    return {
      shouldEnter: false,
      entryDirection: null,
      entryProfile: mapModeToProfile(modePersonality),
      suggestedEntryZone: null,
      reason: 'Liquidity broken - spread too wide',
      confidence: 0
    };
  }
  
  // Check 5: Edge score threshold
  if (edge.edgeScore < adjustedMinEdge) {
    return {
      shouldEnter: false,
      entryDirection: null,
      entryProfile: mapModeToProfile(modePersonality),
      suggestedEntryZone: null,
      reason: `Edge score ${edge.edgeScore} below threshold ${Math.round(adjustedMinEdge)}`,
      confidence: 0
    };
  }
  
  // Check 6: Edge confidence
  if (edge.edgeConfidence < adjustedMinConfidence) {
    return {
      shouldEnter: false,
      entryDirection: null,
      entryProfile: mapModeToProfile(modePersonality),
      suggestedEntryZone: null,
      reason: `Edge confidence ${(edge.edgeConfidence * 100).toFixed(0)}% below threshold`,
      confidence: 0
    };
  }
  
  // Check 7: Environment confidence
  if (env.environmentConfidence < config.minEnvConfidence) {
    return {
      shouldEnter: false,
      entryDirection: null,
      entryProfile: mapModeToProfile(modePersonality),
      suggestedEntryZone: null,
      reason: `Environment confidence ${(env.environmentConfidence * 100).toFixed(0)}% below threshold`,
      confidence: 0
    };
  }
  
  // Check 8: No direction
  if (edge.edgeDirection === 'neutral') {
    return {
      shouldEnter: false,
      entryDirection: null,
      entryProfile: mapModeToProfile(modePersonality),
      suggestedEntryZone: null,
      reason: 'No clear direction signal',
      confidence: 0
    };
  }
  
  // Check 9: Position limits
  const modePositions = getPositionCountByMode(positions, modePersonality);
  if (modePositions >= config.maxConcurrentPerMode) {
    return {
      shouldEnter: false,
      entryDirection: null,
      entryProfile: mapModeToProfile(modePersonality),
      suggestedEntryZone: null,
      reason: `Max positions for ${modePersonality} mode reached`,
      confidence: 0
    };
  }
  
  // Check 10: Total position limit
  if (positions.length >= maxTotalPositions) {
    return {
      shouldEnter: false,
      entryDirection: null,
      entryProfile: mapModeToProfile(modePersonality),
      suggestedEntryZone: null,
      reason: 'Max total positions reached',
      confidence: 0
    };
  }
  
  // Check 11: Symbol exposure limit (max 2 per symbol)
  const symbolPositions = getPositionCountBySymbol(positions, symbol);
  if (symbolPositions >= 2) {
    return {
      shouldEnter: false,
      entryDirection: null,
      entryProfile: mapModeToProfile(modePersonality),
      suggestedEntryZone: null,
      reason: `Max positions for ${symbol} reached`,
      confidence: 0
    };
  }
  
  // Check 12: No conflicting positions (opposite direction)
  if (hasConflictingPosition(positions, symbol, edge.edgeDirection)) {
    return {
      shouldEnter: false,
      entryDirection: null,
      entryProfile: mapModeToProfile(modePersonality),
      suggestedEntryZone: null,
      reason: `Conflicting ${edge.edgeDirection === 'long' ? 'short' : 'long'} position exists`,
      confidence: 0
    };
  }
  
  // All checks passed - approve entry
  const entryZone = calculateSuggestedEntryZone(tick, edge.edgeDirection, env);
  
  // Calculate final confidence
  let finalConfidence = edge.edgeConfidence * env.environmentConfidence;
  if (performance.hitRate > 60) finalConfidence *= 1.1;
  if (performance.hitRate < 40 && performance.recentTrades > 5) finalConfidence *= 0.8;
  finalConfidence = Math.min(1, finalConfidence);
  
  return {
    shouldEnter: true,
    entryDirection: edge.edgeDirection,
    entryProfile: mapModeToProfile(modePersonality),
    suggestedEntryZone: entryZone,
    reason: edge.reasons.join(', ') || 'Edge conditions met',
    confidence: finalConfidence
  };
}

function mapModeToProfile(mode: ModePersonality): EntryProfile {
  switch (mode) {
    case 'burst': return 'burst_scalp';
    case 'scalper': return 'burst_scalp';
    case 'trend': return 'trend';
    default: return 'hybrid';
  }
}

/**
 * Map trading mode to personality
 */
export function getModePersonality(mode: TradingMode): ModePersonality {
  if (mode === 'burst' || mode === 'sniper' || mode === 'stealth') return 'burst';
  if (mode === 'swing' || mode === 'memory' || mode === 'news') return 'scalper';
  if (mode === 'trend' || mode === 'hybrid') return 'trend';
  return 'scalper';
}
