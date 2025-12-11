// ============= Adaptive Mode Controller =============
// Dynamically selects and weights trading modes based on conditions

import type { Position, ClosedTrade, PriceTick } from './types';
import type { EnvironmentSummary } from './environment';
import type { ThermostatState } from './thermostat';
import type { SessionInfo } from './session-brain';
import type { TradeabilityScore } from './router';
import type { ModePersonality } from './entry';

export type UserModeSelection = 'burst' | 'scalper' | 'trend' | 'adaptive';

export interface ModeWeight {
  mode: ModePersonality;
  weight: number;  // 0-1
  reason: string;
}

export interface AdaptiveDecision {
  selectedMode: ModePersonality;
  weights: ModeWeight[];
  isAdaptive: boolean;
  adaptiveReason: string;
}

export interface ModePerformance {
  mode: ModePersonality;
  trades: number;
  winRate: number;
  avgPnl: number;
  lastTradeTime: string | null;
}

function calculateModePerformance(
  trades: ClosedTrade[],
  windowMinutes: number = 120
): Record<ModePersonality, ModePerformance> {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const recentTrades = trades.filter(t => t.closedAt && t.closedAt > cutoff);
  
  const modeMap: Record<ModePersonality, ClosedTrade[]> = {
    burst: [],
    scalper: [],
    trend: []
  };
  
  // Map trades to mode personalities
  for (const trade of recentTrades) {
    const mode = trade.mode;
    if (mode === 'burst' || mode === 'sniper' || mode === 'stealth') {
      modeMap.burst.push(trade);
    } else if (mode === 'swing' || mode === 'memory' || mode === 'news') {
      modeMap.scalper.push(trade);
    } else if (mode === 'trend' || mode === 'hybrid') {
      modeMap.trend.push(trade);
    }
  }
  
  const result: Record<ModePersonality, ModePerformance> = {} as any;
  
  for (const [mode, modeTrades] of Object.entries(modeMap) as [ModePersonality, ClosedTrade[]][]) {
    const wins = modeTrades.filter(t => t.realizedPnl > 0);
    const winRate = modeTrades.length > 0 ? (wins.length / modeTrades.length) * 100 : 50;
    const avgPnl = modeTrades.length > 0 
      ? modeTrades.reduce((s, t) => s + t.realizedPnl, 0) / modeTrades.length 
      : 0;
    
    const lastTrade = modeTrades.length > 0 
      ? modeTrades.sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''))[0]
      : null;
    
    result[mode] = {
      mode,
      trades: modeTrades.length,
      winRate,
      avgPnl,
      lastTradeTime: lastTrade?.closedAt || null
    };
  }
  
  return result;
}

function calculateEnvironmentFit(
  env: EnvironmentSummary,
  mode: ModePersonality
): number {
  let fit = 0.5;
  
  switch (mode) {
    case 'burst':
      // Burst likes expansion and clean conditions
      if (env.volState === 'expansion') fit += 0.2;
      if (env.marketState === 'trend_clean') fit += 0.15;
      if (env.marketState === 'trend_messy') fit += 0.05;
      if (env.volState === 'spike') fit -= 0.2;
      if (env.marketState === 'dead') fit -= 0.3;
      break;
      
    case 'scalper':
      // Scalper likes compression and ranges
      if (env.volState === 'compression') fit += 0.2;
      if (env.marketState === 'range_tradeable') fit += 0.15;
      if (env.marketState === 'trend_messy') fit += 0.1;
      if (env.volState === 'spike') fit -= 0.15;
      if (env.marketState === 'chaos') fit -= 0.25;
      break;
      
    case 'trend':
      // Trend likes clean trends
      if (env.marketState === 'trend_clean') fit += 0.3;
      if (env.marketState === 'trend_messy') fit += 0.1;
      if (env.volState === 'expansion') fit += 0.1;
      if (env.marketState === 'range_tradeable') fit -= 0.1;
      if (env.marketState === 'range_trap') fit -= 0.2;
      if (env.marketState === 'chaos') fit -= 0.3;
      break;
  }
  
  // Liquidity affects all modes
  if (env.liquidityState === 'broken') fit -= 0.4;
  if (env.liquidityState === 'thin') fit -= 0.15;
  
  return Math.max(0, Math.min(1, fit));
}

function calculateSessionFit(
  session: SessionInfo,
  mode: ModePersonality
): number {
  if (!session.recommendedModes.includes(mode)) {
    return 0.3; // Not recommended but not blocked
  }
  
  let fit = 0.5;
  
  switch (mode) {
    case 'burst':
      // Burst needs high quality sessions
      if (session.quality >= 0.9) fit += 0.3;
      else if (session.quality >= 0.7) fit += 0.15;
      else if (session.quality < 0.5) fit -= 0.2;
      
      if (session.volatilityExpected === 'high') fit += 0.1;
      break;
      
    case 'scalper':
      // Scalper more flexible on session
      if (session.quality >= 0.6) fit += 0.2;
      if (session.spreadExpected === 'tight') fit += 0.1;
      break;
      
    case 'trend':
      // Trend needs decent sessions
      if (session.quality >= 0.8) fit += 0.2;
      if (session.volatilityExpected === 'normal') fit += 0.1;
      break;
  }
  
  return Math.max(0, Math.min(1, fit));
}

function calculatePerformanceFit(
  performance: ModePerformance
): number {
  if (performance.trades < 3) return 0.5; // Not enough data
  
  let fit = 0.5;
  
  // Win rate impact
  if (performance.winRate >= 65) fit += 0.25;
  else if (performance.winRate >= 55) fit += 0.1;
  else if (performance.winRate <= 40) fit -= 0.2;
  else if (performance.winRate <= 50) fit -= 0.1;
  
  // Average P&L impact
  if (performance.avgPnl > 0) fit += 0.15;
  else if (performance.avgPnl < 0) fit -= 0.15;
  
  return Math.max(0, Math.min(1, fit));
}

/**
 * Calculate mode weights based on all factors
 */
export function calculateModeWeights(
  environments: Record<string, EnvironmentSummary>,
  session: SessionInfo,
  thermostat: ThermostatState,
  recentTrades: ClosedTrade[],
  tradeabilityScores: TradeabilityScore[]
): ModeWeight[] {
  const modes: ModePersonality[] = ['burst', 'scalper', 'trend'];
  const performance = calculateModePerformance(recentTrades);
  
  // Calculate average environment fit
  const envValues = Object.values(environments);
  const avgEnvFits: Record<ModePersonality, number> = {} as any;
  
  for (const mode of modes) {
    if (envValues.length === 0) {
      avgEnvFits[mode] = 0.5;
    } else {
      const sum = envValues.reduce((s, e) => s + calculateEnvironmentFit(e, mode), 0);
      avgEnvFits[mode] = sum / envValues.length;
    }
  }
  
  // Calculate weights
  const weights: ModeWeight[] = [];
  
  for (const mode of modes) {
    const envFit = avgEnvFits[mode];
    const sessionFit = calculateSessionFit(session, mode);
    const perfFit = calculatePerformanceFit(performance[mode]);
    
    // Thermostat influence
    let thermoFactor = 1.0;
    if (thermostat.aggressionLevel === 'low') {
      // Prefer scalper/trend over burst when cautious
      if (mode === 'burst') thermoFactor = 0.7;
      else if (mode === 'trend') thermoFactor = 1.1;
    } else if (thermostat.aggressionLevel === 'high') {
      // Allow burst when aggressive
      if (mode === 'burst') thermoFactor = 1.2;
    }
    
    // Combined weight
    const baseWeight = (envFit * 0.35 + sessionFit * 0.25 + perfFit * 0.4) * thermoFactor;
    const weight = Math.max(0.1, Math.min(1, baseWeight)); // Always keep some weight
    
    const reasons: string[] = [];
    if (envFit > 0.6) reasons.push('env');
    if (sessionFit > 0.6) reasons.push('session');
    if (perfFit > 0.6) reasons.push('perf');
    
    weights.push({
      mode,
      weight,
      reason: reasons.length > 0 ? `Fits ${reasons.join(', ')}` : 'Base allocation'
    });
  }
  
  // Normalize weights to sum to 1
  const totalWeight = weights.reduce((s, w) => s + w.weight, 0);
  for (const w of weights) {
    w.weight = w.weight / totalWeight;
  }
  
  return weights.sort((a, b) => b.weight - a.weight);
}

/**
 * Select trading mode based on user choice and conditions
 */
export function selectTradingMode(
  userSelection: UserModeSelection,
  environments: Record<string, EnvironmentSummary>,
  session: SessionInfo,
  thermostat: ThermostatState,
  recentTrades: ClosedTrade[],
  tradeabilityScores: TradeabilityScore[]
): AdaptiveDecision {
  const weights = calculateModeWeights(
    environments, session, thermostat, recentTrades, tradeabilityScores
  );
  
  // If user selected a specific mode, use it
  if (userSelection !== 'adaptive') {
    const selectedMode = userSelection as ModePersonality;
    return {
      selectedMode,
      weights,
      isAdaptive: false,
      adaptiveReason: `User selected ${selectedMode} mode`
    };
  }
  
  // Adaptive mode - select highest weighted mode
  const bestMode = weights[0];
  
  // Build reason
  let adaptiveReason = `${bestMode.mode} selected`;
  if (bestMode.weight > 0.5) {
    adaptiveReason += ' (strong fit)';
  } else if (bestMode.weight < 0.35) {
    adaptiveReason += ' (marginal conditions)';
  }
  
  // Check if modes are roughly equal
  if (weights.length >= 2 && weights[0].weight - weights[1].weight < 0.1) {
    adaptiveReason += ` (close to ${weights[1].mode})`;
  }
  
  return {
    selectedMode: bestMode.mode,
    weights,
    isAdaptive: true,
    adaptiveReason
  };
}

/**
 * Get mode for a specific trade based on asset conditions
 */
export function getModeForTrade(
  symbol: string,
  env: EnvironmentSummary,
  session: SessionInfo,
  userSelection: UserModeSelection,
  globalWeights: ModeWeight[]
): ModePersonality {
  // If user selected specific mode, use it
  if (userSelection !== 'adaptive') {
    return userSelection as ModePersonality;
  }
  
  // Calculate symbol-specific fit
  const modes: ModePersonality[] = ['burst', 'scalper', 'trend'];
  let bestMode = globalWeights[0].mode;
  let bestScore = 0;
  
  for (const mode of modes) {
    const envFit = calculateEnvironmentFit(env, mode);
    const sessionFit = calculateSessionFit(session, mode);
    const globalWeight = globalWeights.find(w => w.mode === mode)?.weight || 0.33;
    
    const score = envFit * 0.4 + sessionFit * 0.2 + globalWeight * 0.4;
    
    if (score > bestScore) {
      bestScore = score;
      bestMode = mode;
    }
  }
  
  return bestMode;
}

/**
 * Check if adaptive mode should switch (for logging)
 */
export function shouldLogModeSwitch(
  previousMode: ModePersonality | null,
  newMode: ModePersonality,
  weights: ModeWeight[]
): boolean {
  if (!previousMode) return false;
  if (previousMode === newMode) return false;
  
  // Only log if the switch is significant
  const prevWeight = weights.find(w => w.mode === previousMode)?.weight || 0;
  const newWeight = weights.find(w => w.mode === newMode)?.weight || 0;
  
  return newWeight - prevWeight > 0.1;
}
