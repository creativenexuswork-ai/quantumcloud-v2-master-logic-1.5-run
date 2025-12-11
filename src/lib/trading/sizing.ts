// ============= Sizing Engine =============
// Calculates position sizes based on risk, confidence, and environment

import type { Side, Position, PriceTick } from './types';
import type { EnvironmentSummary } from './environment';
import type { EdgeSignal } from './edge';
import type { ThermostatState } from './thermostat';
import type { EntryProfile, ModePersonality } from './entry';

export interface SizingResult {
  positionSize: number;
  riskAmount: number;
  riskPercent: number;
  stopLoss: number;
  takeProfit: number;
  scaleInPlan: ScaleInStep[] | null;
}

export interface ScaleInStep {
  triggerPrice: number;
  additionalSize: number;
  reason: string;
}

export interface RiskProfile {
  baseRiskPercent: number;  // From user settings (e.g., 0.5%, 1%, 2%)
  maxRiskPercent: number;   // Hard cap
  maxPositionRisk: number;  // Max risk per single position
  maxSymbolExposure: number; // Max % of equity per symbol
  maxCorrelatedExposure: number; // Max % for correlated group
  maxTotalExposure: number; // Max total portfolio exposure
}

// Correlation groups for exposure management
const CORRELATION_GROUPS: Record<string, string[]> = {
  crypto: ['BTCUSD', 'ETHUSD', 'XRPUSD', 'SOLUSD', 'ADAUSD', 'BNBUSD', 'AVAXUSD'],
  usdPairs: ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDCHF'],
  yenPairs: ['USDJPY'],
  indices: ['SPY', 'QQQ'],
  tech: ['TSLA', 'AAPL', 'NVDA', 'META', 'MSFT'],
  gold: ['XAUUSD']
};

function getCorrelationGroup(symbol: string): string | null {
  for (const [group, members] of Object.entries(CORRELATION_GROUPS)) {
    if (members.some(m => symbol.includes(m.replace('USD', '')))) {
      return group;
    }
  }
  return null;
}

function calculateCurrentExposure(positions: Position[], equity: number): Record<string, number> {
  const exposure: Record<string, number> = {
    total: 0,
    crypto: 0,
    usdPairs: 0,
    yenPairs: 0,
    indices: 0,
    tech: 0,
    gold: 0
  };
  
  for (const pos of positions) {
    const posValue = pos.size * pos.entryPrice;
    const exposurePct = (posValue / equity) * 100;
    exposure.total += exposurePct;
    
    const group = getCorrelationGroup(pos.symbol);
    if (group && exposure[group] !== undefined) {
      exposure[group] += exposurePct;
    }
  }
  
  return exposure;
}

function calculateSymbolExposure(positions: Position[], symbol: string, equity: number): number {
  const symbolPositions = positions.filter(p => p.symbol === symbol);
  const totalValue = symbolPositions.reduce((sum, p) => sum + p.size * p.entryPrice, 0);
  return (totalValue / equity) * 100;
}

function getBaseRiskPercent(riskProfile: RiskProfile, mode: ModePersonality): number {
  // Adjust base risk by mode personality
  switch (mode) {
    case 'burst':
      return riskProfile.baseRiskPercent * 0.7; // Smaller, faster trades
    case 'scalper':
      return riskProfile.baseRiskPercent * 0.9;
    case 'trend':
      return riskProfile.baseRiskPercent * 1.2; // Can afford larger on trending
    default:
      return riskProfile.baseRiskPercent;
  }
}

function getEdgeConfidenceMultiplier(confidence: number): number {
  // Scale: 0.5 (low confidence) to 1.5 (high confidence)
  if (confidence >= 0.9) return 1.5;
  if (confidence >= 0.8) return 1.3;
  if (confidence >= 0.7) return 1.1;
  if (confidence >= 0.6) return 1.0;
  if (confidence >= 0.5) return 0.8;
  return 0.5;
}

function getEnvironmentMultiplier(env: EnvironmentSummary): number {
  // Strong environment = can size up
  let mult = 1.0;
  
  if (env.marketState === 'trend_clean') mult *= 1.2;
  else if (env.marketState === 'range_tradeable') mult *= 1.0;
  else if (env.marketState === 'trend_messy') mult *= 0.8;
  else mult *= 0.5; // chaos, dead, range_trap
  
  // Vol state adjustments
  if (env.volState === 'expansion' && env.volatilityRatio < 1.5) mult *= 1.1;
  if (env.volState === 'spike') mult *= 0.6;
  
  // Liquidity
  if (env.liquidityState === 'thin') mult *= 0.7;
  if (env.liquidityState === 'broken') mult *= 0.3;
  
  return mult;
}

function getThermostatMultiplier(thermostat: ThermostatState): number {
  switch (thermostat.aggressionLevel) {
    case 'high': return 1.3;
    case 'medium': return 1.0;
    case 'low': return 0.7;
    default: return 1.0;
  }
}

function calculateStopLoss(
  tick: PriceTick,
  direction: Side,
  env: EnvironmentSummary,
  mode: ModePersonality
): { sl: number; slDistance: number } {
  const atr = env.atr > 0 ? env.atr : tick.mid * 0.01;
  
  // Mode-based SL multiplier
  let atrMultiplier: number;
  switch (mode) {
    case 'burst':
      atrMultiplier = 0.5; // Tight stops
      break;
    case 'scalper':
      atrMultiplier = 0.75;
      break;
    case 'trend':
      atrMultiplier = 1.5; // Wide stops for trends
      break;
    default:
      atrMultiplier = 1.0;
  }
  
  const slDistance = atr * atrMultiplier;
  
  if (direction === 'long') {
    return { sl: tick.bid - slDistance, slDistance };
  } else {
    return { sl: tick.ask + slDistance, slDistance };
  }
}

function calculateTakeProfit(
  tick: PriceTick,
  direction: Side,
  slDistance: number,
  mode: ModePersonality
): number {
  // Target R:R based on mode
  let targetRR: number;
  switch (mode) {
    case 'burst':
      targetRR = 1.5; // Quick profits
      break;
    case 'scalper':
      targetRR = 2.0;
      break;
    case 'trend':
      targetRR = 3.0; // Let winners run
      break;
    default:
      targetRR = 2.0;
  }
  
  const tpDistance = slDistance * targetRR;
  
  if (direction === 'long') {
    return tick.ask + tpDistance;
  } else {
    return tick.bid - tpDistance;
  }
}

function createScaleInPlan(
  tick: PriceTick,
  direction: Side,
  env: EnvironmentSummary,
  mode: ModePersonality,
  baseSize: number
): ScaleInStep[] | null {
  // Only trend mode uses scale-in
  if (mode !== 'trend') return null;
  
  // Only scale in clean trends
  if (env.marketState !== 'trend_clean') return null;
  
  const atr = env.atr > 0 ? env.atr : tick.mid * 0.01;
  
  const steps: ScaleInStep[] = [];
  
  if (direction === 'long') {
    steps.push({
      triggerPrice: tick.mid + atr * 0.5,
      additionalSize: baseSize * 0.5,
      reason: 'Trend continuation confirmed'
    });
    steps.push({
      triggerPrice: tick.mid + atr * 1.0,
      additionalSize: baseSize * 0.3,
      reason: 'Strong momentum'
    });
  } else {
    steps.push({
      triggerPrice: tick.mid - atr * 0.5,
      additionalSize: baseSize * 0.5,
      reason: 'Trend continuation confirmed'
    });
    steps.push({
      triggerPrice: tick.mid - atr * 1.0,
      additionalSize: baseSize * 0.3,
      reason: 'Strong momentum'
    });
  }
  
  return steps;
}

/**
 * Calculate position size for a trade
 */
export function calculatePositionSize(
  symbol: string,
  tick: PriceTick,
  direction: Side,
  edge: EdgeSignal,
  env: EnvironmentSummary,
  thermostat: ThermostatState,
  mode: ModePersonality,
  equity: number,
  positions: Position[],
  riskProfile: RiskProfile
): SizingResult {
  // Calculate stop loss first (needed for position sizing)
  const { sl, slDistance } = calculateStopLoss(tick, direction, env, mode);
  
  // Base risk percent for mode
  let riskPct = getBaseRiskPercent(riskProfile, mode);
  
  // Apply multipliers
  const edgeMult = getEdgeConfidenceMultiplier(edge.edgeConfidence);
  const envMult = getEnvironmentMultiplier(env);
  const thermoMult = getThermostatMultiplier(thermostat);
  
  riskPct = riskPct * edgeMult * envMult * thermoMult;
  
  // Cap at max risk
  riskPct = Math.min(riskPct, riskProfile.maxPositionRisk);
  
  // Check exposure limits
  const currentExposure = calculateCurrentExposure(positions, equity);
  const symbolExposure = calculateSymbolExposure(positions, symbol, equity);
  const group = getCorrelationGroup(symbol);
  const groupExposure = group ? currentExposure[group] || 0 : 0;
  
  // Reduce size if approaching limits
  const remainingTotal = riskProfile.maxTotalExposure - currentExposure.total;
  const remainingSymbol = riskProfile.maxSymbolExposure - symbolExposure;
  const remainingGroup = group ? riskProfile.maxCorrelatedExposure - groupExposure : Infinity;
  
  const maxAllowedExposure = Math.min(remainingTotal, remainingSymbol, remainingGroup);
  
  if (maxAllowedExposure <= 0) {
    return {
      positionSize: 0,
      riskAmount: 0,
      riskPercent: 0,
      stopLoss: sl,
      takeProfit: tick.mid,
      scaleInPlan: null
    };
  }
  
  // Calculate position size
  const riskAmount = equity * (riskPct / 100);
  let positionSize = slDistance > 0 ? riskAmount / slDistance : 0;
  
  // Ensure position doesn't exceed exposure limit
  const positionValue = positionSize * tick.mid;
  const positionExposure = (positionValue / equity) * 100;
  
  if (positionExposure > maxAllowedExposure) {
    const cappedValue = equity * (maxAllowedExposure / 100);
    positionSize = cappedValue / tick.mid;
  }
  
  // Minimum size check
  if (positionSize < 0.0001) {
    positionSize = 0;
  }
  
  // Calculate take profit
  const tp = calculateTakeProfit(tick, direction, slDistance, mode);
  
  // Create scale-in plan for trend mode
  const scaleInPlan = createScaleInPlan(tick, direction, env, mode, positionSize);
  
  return {
    positionSize,
    riskAmount: positionSize * slDistance,
    riskPercent: riskPct,
    stopLoss: sl,
    takeProfit: tp,
    scaleInPlan
  };
}

/**
 * Create a default risk profile from user settings
 */
export function createRiskProfile(
  baseRiskPct: number,
  maxDailyLossPct: number
): RiskProfile {
  return {
    baseRiskPercent: baseRiskPct,
    maxRiskPercent: Math.min(baseRiskPct * 2, maxDailyLossPct / 2),
    maxPositionRisk: baseRiskPct * 1.5,
    maxSymbolExposure: 20, // Max 20% per symbol
    maxCorrelatedExposure: 40, // Max 40% per correlated group
    maxTotalExposure: 80 // Max 80% total exposure
  };
}
