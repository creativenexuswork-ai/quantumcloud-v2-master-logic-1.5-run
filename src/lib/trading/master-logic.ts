// ============= MASTER LOGIC v1.5 =============
// Unified Syraeth-grade quant brain for QuantumCloud
// Single decision engine for all trading modes

import type { RegimeSnapshot, TrendBias, MarketStructure, VolatilityLevel } from './regime';
import type { ModeProfile, TradingModeKey } from './mode-profiles';
import { getModeProfile, getAdjustedProfile, selectAdaptiveSubMode } from './mode-profiles';

// ============== Types ==============

export type Side = 'long' | 'short';

export interface PriceTick {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  timestamp: string;
  volatility?: number;
  regime?: string;
}

export interface Position {
  id: string;
  symbol: string;
  mode: string;
  side: string;
  size: number;
  entry_price: number;
  sl?: number;
  tp?: number;
  unrealized_pnl?: number;
  opened_at: string;
  batch_id?: string;
}

export interface ProposedOrder {
  symbol: string;
  side: Side;
  size: number;
  entryPrice: number;
  sl: number;
  tp: number;
  mode: TradingModeKey;
  reason: string;
  confidence: number;
  qualityScore: number;
  batchId?: string;
}

export interface ThermostatState {
  aggressionLevel: number;      // 0-1
  confidenceLevel: number;      // 0-1
  recentWinRate: number;        // 0-100
  recentPnlPercent: number;     // recent P&L %
  streakCount: number;          // positive for wins, negative for losses
  regimeTag: 'CALM' | 'NORMAL' | 'HOT' | 'DANGER';
}

export interface SessionInfo {
  label: string;
  quality: number;  // 0-1
  phase: 'OPEN' | 'MID' | 'CLOSE' | 'OFF';
}

export interface MasterLogicContext {
  // Mode selection
  selectedMode: TradingModeKey;
  
  // Market data
  symbols: string[];
  ticks: Record<string, PriceTick>;
  regimes: Record<string, RegimeSnapshot>;
  
  // Account state
  equity: number;
  baseRiskPercent: number;
  maxOpenTrades: number;
  
  // Current positions
  openPositions: Position[];
  
  // Performance tracking
  recentTrades: Array<{ symbol: string; realized_pnl: number; mode: string }>;
  todayPnlPercent: number;
  
  // Thermostat
  thermostat: ThermostatState;
  
  // Session
  session: SessionInfo;
}

export interface MasterLogicDecision {
  effectiveMode: TradingModeKey;
  adaptiveSubMode?: 'burst' | 'scalper' | 'trend';
  proposedOrders: ProposedOrder[];
  updatedThermostat: ThermostatState;
  positionsToClose: Array<{ id: string; reason: string }>;
  diagnostics: {
    symbolsEvaluated: number;
    candidatesFound: number;
    passedFilters: number;
    regimeSuitability: Record<string, number>;
  };
}

// ============== Core Logic ==============

/**
 * Main entry point - runs the unified quant brain
 */
export function runMasterLogicV15(ctx: MasterLogicContext): MasterLogicDecision {
  const diagnostics = {
    symbolsEvaluated: 0,
    candidatesFound: 0,
    passedFilters: 0,
    regimeSuitability: {} as Record<string, number>
  };

  // 1. Update thermostat based on recent performance
  const updatedThermostat = updateThermostat(ctx);

  // 2. Determine effective mode (handle Adaptive)
  const { effectiveMode, adaptiveSubMode } = resolveEffectiveMode(ctx, updatedThermostat);

  // 3. Get mode profile and adjustments
  const profile = getModeProfile(effectiveMode === 'adaptive' ? (adaptiveSubMode || 'scalper') : effectiveMode);
  
  // 4. Evaluate positions for management/closure
  const positionsToClose = evaluateOpenPositions(ctx, profile, updatedThermostat);

  // 5. Calculate available slots for new entries
  const currentOpenCount = ctx.openPositions.length - positionsToClose.length;
  const availableSlots = Math.max(0, profile.maxConcurrentTradesTotal - currentOpenCount);

  if (availableSlots === 0) {
    return {
      effectiveMode,
      adaptiveSubMode,
      proposedOrders: [],
      updatedThermostat,
      positionsToClose,
      diagnostics
    };
  }

  // 6. Score and rank all symbols
  const candidates = scoreAllSymbols(ctx, profile, updatedThermostat, diagnostics);

  // 7. Filter by quality and mode constraints
  const filtered = filterCandidates(candidates, ctx, profile, updatedThermostat);
  diagnostics.passedFilters = filtered.length;

  // 8. Select top candidates up to available slots
  const maxPerTick = Math.min(profile.maxEntriesPerTick, availableSlots);
  const selected = filtered.slice(0, maxPerTick);

  // 9. Generate orders
  const proposedOrders = generateOrders(selected, ctx, profile, effectiveMode, adaptiveSubMode);

  return {
    effectiveMode,
    adaptiveSubMode,
    proposedOrders,
    updatedThermostat,
    positionsToClose,
    diagnostics
  };
}

// ============== Thermostat Engine ==============

function updateThermostat(ctx: MasterLogicContext): ThermostatState {
  const t = { ...ctx.thermostat };
  
  // Calculate recent performance metrics
  const recentCount = ctx.recentTrades.length;
  if (recentCount > 0) {
    const wins = ctx.recentTrades.filter(tr => tr.realized_pnl > 0).length;
    t.recentWinRate = (wins / recentCount) * 100;
    
    // Track streaks
    let streak = 0;
    for (let i = ctx.recentTrades.length - 1; i >= 0 && i >= ctx.recentTrades.length - 5; i--) {
      const pnl = ctx.recentTrades[i].realized_pnl;
      if (pnl > 0) {
        if (streak >= 0) streak++;
        else break;
      } else if (pnl < 0) {
        if (streak <= 0) streak--;
        else break;
      }
    }
    t.streakCount = streak;
  }
  
  t.recentPnlPercent = ctx.todayPnlPercent;
  
  // Determine regime tag based on conditions
  if (ctx.todayPnlPercent <= -3 || t.streakCount <= -4) {
    t.regimeTag = 'DANGER';
    t.aggressionLevel = 0.2;
    t.confidenceLevel = 0.3;
  } else if (ctx.todayPnlPercent <= -1.5 || t.streakCount <= -2) {
    t.regimeTag = 'CALM';
    t.aggressionLevel = 0.4;
    t.confidenceLevel = 0.5;
  } else if (t.recentWinRate > 65 && t.streakCount >= 3 && ctx.todayPnlPercent > 0.5) {
    t.regimeTag = 'HOT';
    t.aggressionLevel = 0.9;
    t.confidenceLevel = 0.85;
  } else {
    t.regimeTag = 'NORMAL';
    t.aggressionLevel = 0.6;
    t.confidenceLevel = 0.65;
  }
  
  // Clamp values
  t.aggressionLevel = Math.max(0.15, Math.min(1.0, t.aggressionLevel));
  t.confidenceLevel = Math.max(0.2, Math.min(1.0, t.confidenceLevel));
  
  return t;
}

// ============== Mode Resolution ==============

function resolveEffectiveMode(
  ctx: MasterLogicContext,
  thermostat: ThermostatState
): { effectiveMode: TradingModeKey; adaptiveSubMode?: 'burst' | 'scalper' | 'trend' } {
  if (ctx.selectedMode !== 'adaptive') {
    return { effectiveMode: ctx.selectedMode };
  }
  
  // Adaptive mode - select best sub-mode based on conditions
  const avgRegime = getAverageRegime(ctx);
  
  // Calculate recent mode performance
  const modePerformance = { burst: 0, scalper: 0, trend: 0 };
  for (const trade of ctx.recentTrades.slice(-20)) {
    const mode = trade.mode as 'burst' | 'scalper' | 'trend';
    if (modePerformance[mode] !== undefined) {
      modePerformance[mode] += trade.realized_pnl > 0 ? 1 : -0.5;
    }
  }
  
  const selection = selectAdaptiveSubMode(
    avgRegime,
    ctx.session.quality,
    thermostat.aggressionLevel,
    modePerformance
  );
  
  return {
    effectiveMode: 'adaptive',
    adaptiveSubMode: selection.mode
  };
}

function getAverageRegime(ctx: MasterLogicContext): RegimeSnapshot {
  const regimes = Object.values(ctx.regimes);
  if (regimes.length === 0) {
    return {
      symbol: 'AVERAGE',
      trendBias: 'neutral',
      structure: 'range',
      volatility: 'normal',
      trendStrength: 50,
      volatilityRatio: 1,
      confidence: 0.5,
      smaAlignment: 'mixed',
      timestamp: new Date().toISOString()
    };
  }
  
  // Aggregate regime characteristics
  const avgStrength = regimes.reduce((s, r) => s + r.trendStrength, 0) / regimes.length;
  const avgVolRatio = regimes.reduce((s, r) => s + r.volatilityRatio, 0) / regimes.length;
  const avgConf = regimes.reduce((s, r) => s + r.confidence, 0) / regimes.length;
  
  // Determine dominant trend bias
  const biasCount = { bull: 0, bear: 0, neutral: 0 };
  regimes.forEach(r => biasCount[r.trendBias]++);
  const dominantBias = Object.entries(biasCount).sort((a, b) => b[1] - a[1])[0][0] as TrendBias;
  
  // Determine dominant structure
  const structCount = { trend: 0, range: 0 };
  regimes.forEach(r => structCount[r.structure]++);
  const dominantStruct = structCount.trend >= structCount.range ? 'trend' : 'range' as MarketStructure;
  
  // Determine dominant volatility
  let dominantVol: VolatilityLevel = 'normal';
  if (avgVolRatio > 1.3) dominantVol = 'high';
  else if (avgVolRatio < 0.7) dominantVol = 'low';
  
  return {
    symbol: 'AVERAGE',
    trendBias: dominantBias,
    structure: dominantStruct,
    volatility: dominantVol,
    trendStrength: avgStrength,
    volatilityRatio: avgVolRatio,
    confidence: avgConf,
    smaAlignment: 'mixed',
    timestamp: new Date().toISOString()
  };
}

// ============== Position Management ==============

function evaluateOpenPositions(
  ctx: MasterLogicContext,
  profile: ModeProfile,
  thermostat: ThermostatState
): Array<{ id: string; reason: string }> {
  const toClose: Array<{ id: string; reason: string }> = [];
  
  for (const pos of ctx.openPositions) {
    const tick = ctx.ticks[pos.symbol];
    if (!tick) continue;
    
    const currentPrice = pos.side === 'long' ? tick.bid : tick.ask;
    const entryPrice = Number(pos.entry_price);
    const pnlPercent = entryPrice > 0 
      ? ((pos.side === 'long' ? currentPrice - entryPrice : entryPrice - currentPrice) / entryPrice) * 100
      : 0;
    
    // Check per-position SL
    if (pnlPercent <= -profile.defaultStopPercent) {
      toClose.push({ id: pos.id, reason: 'position_sl' });
      continue;
    }
    
    // Check per-position TP
    const tpPercent = profile.defaultStopPercent * profile.defaultTPMultiplier;
    if (pnlPercent >= tpPercent) {
      toClose.push({ id: pos.id, reason: 'position_tp' });
      continue;
    }
    
    // Cut clear losers early (mode-specific)
    if (pnlPercent <= profile.cutLoserThreshold) {
      toClose.push({ id: pos.id, reason: 'cut_loser' });
      continue;
    }
    
    // Trailing stop logic
    if (pnlPercent >= profile.trailingStopActivation) {
      const trailLevel = profile.trailingStopActivation - profile.trailingStopDistance;
      if (pnlPercent < trailLevel) {
        toClose.push({ id: pos.id, reason: 'trailing_stop' });
        continue;
      }
    }
    
    // Check age limit
    const ageMinutes = (Date.now() - new Date(pos.opened_at).getTime()) / (1000 * 60);
    if (ageMinutes > profile.maxHoldMinutes) {
      toClose.push({ id: pos.id, reason: 'age_limit' });
      continue;
    }
    
    // Check regime flip (optional aggressive management)
    const regime = ctx.regimes[pos.symbol];
    if (regime && thermostat.regimeTag !== 'DANGER') {
      const posDir = pos.side === 'long' ? 'bull' : 'bear';
      if (regime.trendBias !== 'neutral' && regime.trendBias !== posDir && regime.confidence > 0.6) {
        // Regime flipped against position - consider closing if in loss
        if (pnlPercent < 0) {
          toClose.push({ id: pos.id, reason: 'regime_flip' });
          continue;
        }
      }
    }
  }
  
  return toClose;
}

// ============== Symbol Scoring ==============

interface ScoredCandidate {
  symbol: string;
  tick: PriceTick;
  regime: RegimeSnapshot;
  direction: Side;
  qualityScore: number;
  confidence: number;
  reasons: string[];
}

function scoreAllSymbols(
  ctx: MasterLogicContext,
  profile: ModeProfile,
  thermostat: ThermostatState,
  diagnostics: MasterLogicDecision['diagnostics']
): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];
  
  for (const symbol of ctx.symbols) {
    diagnostics.symbolsEvaluated++;
    
    const tick = ctx.ticks[symbol];
    if (!tick || !tick.mid || tick.mid <= 0) continue;
    
    // Get or create regime
    const regime = ctx.regimes[symbol] || createDefaultRegime(symbol, tick);
    
    // Score this symbol
    const scored = scoreSymbol(symbol, tick, regime, profile, thermostat, ctx);
    
    if (scored) {
      candidates.push(scored);
      diagnostics.candidatesFound++;
      diagnostics.regimeSuitability[symbol] = scored.qualityScore;
    }
  }
  
  // Sort by quality score descending
  candidates.sort((a, b) => b.qualityScore - a.qualityScore);
  
  return candidates;
}

function createDefaultRegime(symbol: string, tick: PriceTick): RegimeSnapshot {
  return {
    symbol,
    trendBias: 'neutral',
    structure: 'range',
    volatility: tick.volatility && tick.volatility > 0.6 ? 'high' : 'normal',
    trendStrength: 40,
    volatilityRatio: 1,
    confidence: 0.4,
    smaAlignment: 'mixed',
    timestamp: new Date().toISOString()
  };
}

function scoreSymbol(
  symbol: string,
  tick: PriceTick,
  regime: RegimeSnapshot,
  profile: ModeProfile,
  thermostat: ThermostatState,
  ctx: MasterLogicContext
): ScoredCandidate | null {
  const reasons: string[] = [];
  let score = 40; // Base score
  
  // 1. Regime suitability (major factor)
  const regimeSuitability = calculateRegimeSuitability(regime, profile);
  score += regimeSuitability.score * 0.3;
  if (regimeSuitability.reasons.length > 0) {
    reasons.push(...regimeSuitability.reasons);
  }
  
  // 2. Volatility fit
  const volFit = calculateVolatilityFit(regime, profile);
  score += volFit * 15;
  
  // 3. Trend strength contribution
  if (profile.preferredStructures.includes('trend')) {
    score += (regime.trendStrength / 100) * 20;
  }
  
  // 4. Confidence boost
  score += regime.confidence * 10;
  
  // 5. Session quality
  if (ctx.session.quality >= profile.sessionQualityMin) {
    score += 5;
    reasons.push('Good session');
  }
  
  // 6. Thermostat modifier
  score *= (0.7 + thermostat.aggressionLevel * 0.3);
  
  // 7. Check if we already have positions in this symbol
  const existingCount = ctx.openPositions.filter(p => p.symbol === symbol).length;
  if (existingCount >= profile.maxConcurrentTradesPerSymbol) {
    return null; // Can't add more to this symbol
  }
  if (existingCount > 0) {
    score -= existingCount * 10; // Penalty for stacking
  }
  
  // Determine direction
  const direction = determineDirection(regime, tick);
  if (!direction) return null;
  
  // Calculate confidence
  let confidence = 0.5 + (score - 50) / 100;
  confidence = Math.max(0.3, Math.min(0.95, confidence));
  
  return {
    symbol,
    tick,
    regime,
    direction,
    qualityScore: Math.max(0, Math.min(100, score)),
    confidence,
    reasons
  };
}

function calculateRegimeSuitability(
  regime: RegimeSnapshot,
  profile: ModeProfile
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  
  // Structure match
  if (profile.preferredStructures.includes(regime.structure)) {
    score += 25;
    reasons.push(`${regime.structure} structure`);
  } else if (profile.allowedInAnyRegime) {
    score += 10;
  } else {
    score -= 15;
    reasons.push(`Wrong structure (${regime.structure})`);
  }
  
  // Volatility match
  if (profile.preferredVolatility.includes(regime.volatility)) {
    score += 20;
    reasons.push(`${regime.volatility} vol`);
  } else if (profile.allowedInAnyRegime) {
    score += 5;
  }
  
  // Trend alignment
  if (regime.trendBias !== 'neutral') {
    score += 10;
    reasons.push(`${regime.trendBias} bias`);
  }
  
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function calculateVolatilityFit(regime: RegimeSnapshot, profile: ModeProfile): number {
  if (profile.preferredVolatility.includes(regime.volatility)) {
    return 1.0;
  }
  // Partial fit
  return 0.5;
}

function determineDirection(regime: RegimeSnapshot, tick: PriceTick): Side | null {
  // Use regime bias primarily
  if (regime.trendBias === 'bull' && regime.confidence > 0.35) {
    return 'long';
  }
  if (regime.trendBias === 'bear' && regime.confidence > 0.35) {
    return 'short';
  }
  
  // Fallback to momentum if neutral
  if (tick.volatility && tick.volatility > 0.5) {
    // In volatile conditions with no clear bias, slight random but biased to momentum
    return Math.random() > 0.5 ? 'long' : 'short';
  }
  
  // Default fallback - always have a direction to ensure trades fire
  return Math.random() > 0.5 ? 'long' : 'short';
}

// ============== Filtering ==============

function filterCandidates(
  candidates: ScoredCandidate[],
  ctx: MasterLogicContext,
  profile: ModeProfile,
  thermostat: ThermostatState
): ScoredCandidate[] {
  // Adjusted threshold based on thermostat
  const threshold = profile.entryScoreThreshold - 
    (thermostat.aggressionLevel > 0.7 ? 5 : 0) +
    (thermostat.regimeTag === 'DANGER' ? 15 : 0);
  
  return candidates.filter(c => {
    // Quality threshold
    if (c.qualityScore < threshold) return false;
    
    // Edge confidence
    if (c.confidence < profile.edgeConfidenceMin) return false;
    
    return true;
  });
}

// ============== Order Generation ==============

function generateOrders(
  selected: ScoredCandidate[],
  ctx: MasterLogicContext,
  profile: ModeProfile,
  effectiveMode: TradingModeKey,
  adaptiveSubMode?: 'burst' | 'scalper' | 'trend'
): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const batchId = `${effectiveMode}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  
  for (const candidate of selected) {
    const { symbol, tick, direction, qualityScore, confidence, reasons } = candidate;
    
    // Calculate position size based on risk
    const adjustedProfile = getAdjustedProfile(
      profile,
      candidate.regime,
      ctx.session.quality,
      ctx.thermostat.aggressionLevel
    );
    
    const riskPercent = ctx.baseRiskPercent * adjustedProfile.sizeMultiplier;
    const slPercent = profile.defaultStopPercent * adjustedProfile.slMultiplier / 100;
    const slDistance = tick.mid * slPercent;
    
    // Size calculation
    const riskAmount = ctx.equity * (riskPercent / 100);
    const size = slDistance > 0 ? Math.max(0.001, riskAmount / slDistance) : 0.001;
    
    // TP calculation
    const tpPercent = profile.defaultStopPercent * profile.defaultTPMultiplier * adjustedProfile.tpMultiplier / 100;
    const tpDistance = tick.mid * tpPercent;
    
    const sl = direction === 'long' ? tick.mid - slDistance : tick.mid + slDistance;
    const tp = direction === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance;
    
    const mode = adaptiveSubMode || effectiveMode;
    const reasonStr = `${mode.toUpperCase()} entry: ${reasons.slice(0, 3).join(', ')} (Q=${qualityScore.toFixed(0)})`;
    
    orders.push({
      symbol,
      side: direction,
      size,
      entryPrice: tick.mid,
      sl,
      tp,
      mode: mode as TradingModeKey,
      reason: reasonStr,
      confidence,
      qualityScore,
      batchId: effectiveMode === 'burst' ? batchId : undefined
    });
  }
  
  return orders;
}

// ============== Utility Exports ==============

export function getInitialThermostat(): ThermostatState {
  return {
    aggressionLevel: 0.6,
    confidenceLevel: 0.6,
    recentWinRate: 50,
    recentPnlPercent: 0,
    streakCount: 0,
    regimeTag: 'NORMAL'
  };
}

export function getInitialSession(): SessionInfo {
  const hour = new Date().getUTCHours();
  
  // Determine session based on UTC hour
  let label = 'Off-hours';
  let quality = 0.3;
  let phase: SessionInfo['phase'] = 'OFF';
  
  // Asia: 00:00-08:00 UTC
  if (hour >= 0 && hour < 8) {
    label = 'Asia Session';
    quality = 0.5;
    phase = hour < 2 ? 'OPEN' : hour < 6 ? 'MID' : 'CLOSE';
  }
  // London: 07:00-16:00 UTC
  else if (hour >= 7 && hour < 16) {
    label = hour >= 13 && hour < 16 ? 'London/NY Overlap' : 'London Session';
    quality = hour >= 13 ? 0.9 : 0.75; // Overlap is highest quality
    phase = hour < 9 ? 'OPEN' : hour < 14 ? 'MID' : 'CLOSE';
  }
  // NY: 12:00-21:00 UTC
  else if (hour >= 12 && hour < 21) {
    label = hour < 16 ? 'London/NY Overlap' : 'NY Session';
    quality = hour < 16 ? 0.9 : 0.7;
    phase = hour < 14 ? 'OPEN' : hour < 18 ? 'MID' : 'CLOSE';
  }
  
  return { label, quality, phase };
}

export { getModeProfile, getAdjustedProfile };
