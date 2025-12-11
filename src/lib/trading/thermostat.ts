// ============= Thermostat Engine =============
// Central aggression control based on performance and environment

import type { ClosedTrade, Position } from './types';
import type { EnvironmentSummary } from './environment';

export type AggressionLevel = 'low' | 'medium' | 'high';

export interface ThermostatState {
  aggressionLevel: AggressionLevel;
  confidence: number;           // 0-1 confidence in current state
  recentWinRate: number;        // Win rate over rolling window
  recentRR: number;             // Recent R:R
  avgEnvironmentQuality: number; // Avg env confidence over window
  streakType: 'win' | 'loss' | 'mixed';
  streakLength: number;
  adjustmentReason: string;
}

export interface ThermostatConfig {
  windowMinutes: number;        // Rolling window for performance
  minTradesForAdjustment: number; // Minimum trades before adjusting
  winRateThresholdHigh: number;   // Win rate to consider "high"
  winRateThresholdLow: number;    // Win rate to consider "low"
  maxAggressionChange: number;    // Max change per evaluation (0-2)
}

const DEFAULT_CONFIG: ThermostatConfig = {
  windowMinutes: 60,
  minTradesForAdjustment: 5,
  winRateThresholdHigh: 65,
  winRateThresholdLow: 40,
  maxAggressionChange: 1
};

// Store historical states for gradual adjustment
let previousState: ThermostatState | null = null;

function getRecentTrades(trades: ClosedTrade[], windowMinutes: number): ClosedTrade[] {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  return trades.filter(t => t.closedAt && t.closedAt > cutoff);
}

function calculateStreak(trades: ClosedTrade[]): { type: 'win' | 'loss' | 'mixed'; length: number } {
  if (trades.length === 0) return { type: 'mixed', length: 0 };
  
  // Sort by close time descending
  const sorted = [...trades].sort((a, b) => 
    (b.closedAt || '').localeCompare(a.closedAt || '')
  );
  
  const firstType = sorted[0].realizedPnl > 0 ? 'win' : 'loss';
  let length = 1;
  
  for (let i = 1; i < sorted.length; i++) {
    const isWin = sorted[i].realizedPnl > 0;
    if ((firstType === 'win' && isWin) || (firstType === 'loss' && !isWin)) {
      length++;
    } else {
      break;
    }
  }
  
  return { type: firstType, length };
}

function calculateWinRate(trades: ClosedTrade[]): number {
  if (trades.length === 0) return 50;
  const wins = trades.filter(t => t.realizedPnl > 0).length;
  return (wins / trades.length) * 100;
}

function calculateAvgRR(trades: ClosedTrade[]): number {
  const wins = trades.filter(t => t.realizedPnl > 0);
  const losses = trades.filter(t => t.realizedPnl < 0);
  
  if (wins.length === 0 || losses.length === 0) return 1.5;
  
  const avgWin = wins.reduce((s, t) => s + t.realizedPnl, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0) / losses.length);
  
  return avgLoss > 0 ? avgWin / avgLoss : 1.5;
}

function calculateAvgEnvironmentQuality(
  environments: Record<string, EnvironmentSummary>
): number {
  const values = Object.values(environments);
  if (values.length === 0) return 0.5;
  
  const sum = values.reduce((s, e) => s + e.environmentConfidence, 0);
  return sum / values.length;
}

function determineAggressionLevel(
  winRate: number,
  rr: number,
  envQuality: number,
  streak: { type: 'win' | 'loss' | 'mixed'; length: number },
  config: ThermostatConfig
): { level: AggressionLevel; reason: string } {
  let score = 50; // Start neutral
  let reasons: string[] = [];
  
  // Win rate contribution
  if (winRate >= config.winRateThresholdHigh) {
    score += 20;
    reasons.push('High win rate');
  } else if (winRate <= config.winRateThresholdLow) {
    score -= 25;
    reasons.push('Low win rate');
  }
  
  // R:R contribution
  if (rr >= 2.0) {
    score += 15;
    reasons.push('Good R:R');
  } else if (rr < 1.0) {
    score -= 20;
    reasons.push('Poor R:R');
  }
  
  // Environment quality contribution
  if (envQuality >= 0.7) {
    score += 15;
    reasons.push('Quality environments');
  } else if (envQuality < 0.4) {
    score -= 20;
    reasons.push('Poor environments');
  }
  
  // Streak contribution (careful with win streaks too)
  if (streak.type === 'win' && streak.length >= 5) {
    score += 10; // Good, but don't get overconfident
    reasons.push(`Win streak (${streak.length})`);
  } else if (streak.type === 'loss' && streak.length >= 3) {
    score -= 25;
    reasons.push(`Loss streak (${streak.length})`);
  }
  
  // Determine level
  let level: AggressionLevel;
  if (score >= 70) {
    level = 'high';
  } else if (score <= 35) {
    level = 'low';
  } else {
    level = 'medium';
  }
  
  const reason = reasons.length > 0 ? reasons.join(', ') : 'Normal conditions';
  
  return { level, reason };
}

/**
 * Update thermostat state based on recent performance
 */
export function updateThermostat(
  recentTrades: ClosedTrade[],
  environments: Record<string, EnvironmentSummary>,
  config: ThermostatConfig = DEFAULT_CONFIG
): ThermostatState {
  const windowTrades = getRecentTrades(recentTrades, config.windowMinutes);
  const winRate = calculateWinRate(windowTrades);
  const rr = calculateAvgRR(windowTrades);
  const envQuality = calculateAvgEnvironmentQuality(environments);
  const streak = calculateStreak(windowTrades);
  
  // Determine base aggression level
  const { level: baseLevel, reason } = determineAggressionLevel(
    winRate, rr, envQuality, streak, config
  );
  
  // Gradual adjustment - don't jump levels too quickly
  let finalLevel = baseLevel;
  
  if (previousState && windowTrades.length >= config.minTradesForAdjustment) {
    const levelOrder: AggressionLevel[] = ['low', 'medium', 'high'];
    const prevIndex = levelOrder.indexOf(previousState.aggressionLevel);
    const newIndex = levelOrder.indexOf(baseLevel);
    
    // Limit change to one level at a time
    if (Math.abs(newIndex - prevIndex) > config.maxAggressionChange) {
      const direction = newIndex > prevIndex ? 1 : -1;
      finalLevel = levelOrder[prevIndex + direction];
    }
  }
  
  // Calculate confidence in the state
  let confidence = 0.5;
  if (windowTrades.length >= config.minTradesForAdjustment * 2) {
    confidence += 0.3;
  } else if (windowTrades.length >= config.minTradesForAdjustment) {
    confidence += 0.1;
  }
  
  if (envQuality > 0.6) confidence += 0.1;
  if (Math.abs(winRate - 50) > 15) confidence += 0.1; // Clear direction
  
  confidence = Math.min(1, confidence);
  
  const state: ThermostatState = {
    aggressionLevel: finalLevel,
    confidence,
    recentWinRate: winRate,
    recentRR: rr,
    avgEnvironmentQuality: envQuality,
    streakType: streak.type,
    streakLength: streak.length,
    adjustmentReason: reason
  };
  
  previousState = state;
  
  return state;
}

/**
 * Get multipliers from thermostat state
 */
export function getThermostatMultipliers(state: ThermostatState): {
  sizeMultiplier: number;
  entryThresholdMultiplier: number;
  frequencyMultiplier: number;
} {
  switch (state.aggressionLevel) {
    case 'high':
      return {
        sizeMultiplier: 1.3,
        entryThresholdMultiplier: 0.9, // Looser thresholds
        frequencyMultiplier: 1.2
      };
    case 'low':
      return {
        sizeMultiplier: 0.7,
        entryThresholdMultiplier: 1.2, // Stricter thresholds
        frequencyMultiplier: 0.7
      };
    default: // medium
      return {
        sizeMultiplier: 1.0,
        entryThresholdMultiplier: 1.0,
        frequencyMultiplier: 1.0
      };
  }
}

/**
 * Check if thermostat recommends trading
 */
export function shouldThermostatAllowTrading(state: ThermostatState): boolean {
  // Even at low aggression, we still trade (just smaller/stricter)
  // Only stop if in extreme conditions
  if (state.streakType === 'loss' && state.streakLength >= 7) {
    return false; // Extended losing streak - pause
  }
  
  if (state.avgEnvironmentQuality < 0.2) {
    return false; // Markets are in chaos
  }
  
  return true;
}

/**
 * Get initial/default thermostat state
 */
export function getInitialThermostatState(): ThermostatState {
  return {
    aggressionLevel: 'medium',
    confidence: 0.5,
    recentWinRate: 50,
    recentRR: 1.5,
    avgEnvironmentQuality: 0.5,
    streakType: 'mixed',
    streakLength: 0,
    adjustmentReason: 'Initial state'
  };
}
