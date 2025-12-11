// ============= PAPER TICK v1.5 — Master Logic Integration =============
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============== Default Configs ==============

const DEFAULT_RISK_CONFIG = {
  maxDailyLossPercent: 5,
  maxConcurrentRiskPercent: 10,
  maxOpenTrades: 20,
  maxPerSymbolExposure: 10,
  riskPerTrade: 2,
};

const DEFAULT_BURST_CONFIG = {
  size: 10,
  dailyProfitTargetPercent: 8,
  riskPerBurstPercent: 2,
};

const DEFAULT_MODE_CONFIG = {
  enabledModes: ['burst', 'trend', 'scalper'],
  modeSettings: {},
};

const DEFAULT_MARKET_CONFIG = {
  selectedSymbols: ['BTCUSDT', 'ETHUSDT', 'EURUSD', 'XAUUSD'],
  typeFilters: { crypto: true, forex: true, index: true, metal: true },
};

// ============== Types ==============

type Side = 'long' | 'short';
type TradingModeKey = 'burst' | 'scalper' | 'trend' | 'adaptive';
type SessionStatus = 'idle' | 'running' | 'holding' | 'stopped';
type TrendBias = 'bull' | 'bear' | 'neutral';
type MarketStructure = 'trend' | 'range';
type VolatilityLevel = 'high' | 'normal' | 'low';

interface PriceTick {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  timestamp: string;
  volatility?: number;
  regime?: string;
}

interface Position {
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

interface ProposedOrder {
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

interface RegimeSnapshot {
  symbol: string;
  trendBias: TrendBias;
  structure: MarketStructure;
  volatility: VolatilityLevel;
  trendStrength: number;
  volatilityRatio: number;
  confidence: number;
  smaAlignment: 'bullish' | 'bearish' | 'mixed';
}

interface ThermostatState {
  aggressionLevel: number;
  confidenceLevel: number;
  recentWinRate: number;
  recentPnlPercent: number;
  streakCount: number;
  regimeTag: 'CALM' | 'NORMAL' | 'HOT' | 'DANGER';
}

interface SessionInfo {
  label: string;
  quality: number;
  phase: 'OPEN' | 'MID' | 'CLOSE' | 'OFF';
}

interface ModeProfile {
  key: TradingModeKey;
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

// ============== Mode Profiles v1.5 ==============

const MODE_PROFILES: Record<TradingModeKey, ModeProfile> = {
  burst: {
    key: 'burst',
    maxConcurrentTradesPerSymbol: 5,
    maxConcurrentTradesTotal: 15,
    maxEntriesPerTick: 3,
    basePositionSizeFactor: 0.5,
    entryScoreThreshold: 25,
    edgeConfidenceMin: 0.3,
    defaultStopPercent: 0.4,
    defaultTPMultiplier: 1.5,
    maxHoldMinutes: 15,
    preferredStructures: ['trend', 'range'],
    preferredVolatility: ['high', 'normal'],
    allowedInAnyRegime: true,
    trailingStopActivation: 0.5,
    trailingStopDistance: 0.25,
    cutLoserThreshold: -0.3,
  },
  scalper: {
    key: 'scalper',
    maxConcurrentTradesPerSymbol: 3,
    maxConcurrentTradesTotal: 8,
    maxEntriesPerTick: 2,
    basePositionSizeFactor: 0.6,
    entryScoreThreshold: 35,
    edgeConfidenceMin: 0.4,
    defaultStopPercent: 0.25,
    defaultTPMultiplier: 1.5,
    maxHoldMinutes: 10,
    preferredStructures: ['range', 'trend'],
    preferredVolatility: ['normal', 'high'],
    allowedInAnyRegime: true,
    trailingStopActivation: 0.4,
    trailingStopDistance: 0.2,
    cutLoserThreshold: -0.2,
  },
  trend: {
    key: 'trend',
    maxConcurrentTradesPerSymbol: 2,
    maxConcurrentTradesTotal: 5,
    maxEntriesPerTick: 1,
    basePositionSizeFactor: 1.0,
    entryScoreThreshold: 50,
    edgeConfidenceMin: 0.5,
    defaultStopPercent: 1.0,
    defaultTPMultiplier: 2.5,
    maxHoldMinutes: 120,
    preferredStructures: ['trend'],
    preferredVolatility: ['normal', 'high'],
    allowedInAnyRegime: false,
    trailingStopActivation: 1.0,
    trailingStopDistance: 0.5,
    cutLoserThreshold: -0.8,
  },
  adaptive: {
    key: 'adaptive',
    maxConcurrentTradesPerSymbol: 3,
    maxConcurrentTradesTotal: 10,
    maxEntriesPerTick: 2,
    basePositionSizeFactor: 0.7,
    entryScoreThreshold: 35,
    edgeConfidenceMin: 0.4,
    defaultStopPercent: 0.5,
    defaultTPMultiplier: 2.0,
    maxHoldMinutes: 60,
    preferredStructures: ['trend', 'range'],
    preferredVolatility: ['high', 'normal', 'low'],
    allowedInAnyRegime: true,
    trailingStopActivation: 0.6,
    trailingStopDistance: 0.3,
    cutLoserThreshold: -0.5,
  },
};

// ============== Regime Engine v1.5 ==============

const priceHistory: Record<string, number[]> = {};
const MAX_HISTORY = 50;

function recordPriceTick(symbol: string, mid: number): void {
  if (!priceHistory[symbol]) priceHistory[symbol] = [];
  priceHistory[symbol].push(mid);
  if (priceHistory[symbol].length > MAX_HISTORY) priceHistory[symbol].shift();
}

function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices.length > 0 ? prices[prices.length - 1] : 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function classifyRegime(symbol: string, tick: PriceTick): RegimeSnapshot {
  recordPriceTick(symbol, tick.mid);
  const prices = priceHistory[symbol] || [];
  
  if (prices.length < 10) {
    return {
      symbol,
      trendBias: 'neutral',
      structure: 'range',
      volatility: 'normal',
      trendStrength: 40,
      volatilityRatio: 1,
      confidence: 0.4,
      smaAlignment: 'mixed',
    };
  }
  
  // Calculate trend bias
  const sma5 = calculateSMA(prices, 5);
  const sma20 = calculateSMA(prices, Math.min(20, prices.length));
  const currentPrice = prices[prices.length - 1];
  
  let bullishCount = 0;
  if (currentPrice > sma5) bullishCount++;
  if (sma5 > sma20) bullishCount++;
  if (currentPrice > sma20) bullishCount++;
  
  const smaAlignment: 'bullish' | 'bearish' | 'mixed' = 
    bullishCount >= 2 ? 'bullish' : bullishCount <= 1 ? 'bearish' : 'mixed';
  
  // Calculate directional movement
  let ups = 0, downs = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) ups++;
    else if (prices[i] < prices[i - 1]) downs++;
  }
  
  const directionalStrength = Math.abs(ups - downs) / Math.max(1, ups + downs);
  const trendStrength = Math.min(100, directionalStrength * 50 + (smaAlignment !== 'mixed' ? 25 : 0));
  
  const trendBias: TrendBias = ups > downs && trendStrength > 35 ? 'bull' 
    : downs > ups && trendStrength > 35 ? 'bear' : 'neutral';
  
  // Calculate volatility
  let atrSum = 0;
  for (let i = 1; i < prices.length; i++) {
    atrSum += Math.abs(prices[i] - prices[i - 1]);
  }
  const atr = atrSum / (prices.length - 1);
  const volatilityRatio = prices.length > 20 
    ? atr / (calculateSMA(prices.slice(-20).map((p, i, arr) => i > 0 ? Math.abs(p - arr[i-1]) : 0).slice(1), 19) || atr)
    : 1;
  
  const volatility: VolatilityLevel = volatilityRatio > 1.3 ? 'high' : volatilityRatio < 0.7 ? 'low' : 'normal';
  const structure: MarketStructure = trendStrength > 45 ? 'trend' : 'range';
  
  // Calculate confidence
  let confidence = 0.5;
  if (prices.length >= 30) confidence += 0.2;
  if (smaAlignment !== 'mixed') confidence += 0.15;
  confidence = Math.min(0.9, confidence);
  
  return {
    symbol,
    trendBias,
    structure,
    volatility,
    trendStrength,
    volatilityRatio,
    confidence,
    smaAlignment,
  };
}

// ============== Thermostat Engine v1.5 ==============

function updateThermostat(
  recentTrades: any[],
  todayPnlPercent: number,
  prevThermostat?: ThermostatState
): ThermostatState {
  const t: ThermostatState = prevThermostat ? { ...prevThermostat } : {
    aggressionLevel: 0.6,
    confidenceLevel: 0.6,
    recentWinRate: 50,
    recentPnlPercent: 0,
    streakCount: 0,
    regimeTag: 'NORMAL',
  };
  
  const recentCount = recentTrades.length;
  if (recentCount > 0) {
    const wins = recentTrades.filter(tr => Number(tr.realized_pnl) > 0).length;
    t.recentWinRate = (wins / recentCount) * 100;
    
    let streak = 0;
    for (let i = recentTrades.length - 1; i >= 0 && i >= recentTrades.length - 5; i--) {
      const pnl = Number(recentTrades[i].realized_pnl);
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
  
  t.recentPnlPercent = todayPnlPercent;
  
  if (todayPnlPercent <= -3 || t.streakCount <= -4) {
    t.regimeTag = 'DANGER';
    t.aggressionLevel = 0.2;
    t.confidenceLevel = 0.3;
  } else if (todayPnlPercent <= -1.5 || t.streakCount <= -2) {
    t.regimeTag = 'CALM';
    t.aggressionLevel = 0.4;
    t.confidenceLevel = 0.5;
  } else if (t.recentWinRate > 65 && t.streakCount >= 3 && todayPnlPercent > 0.5) {
    t.regimeTag = 'HOT';
    t.aggressionLevel = 0.9;
    t.confidenceLevel = 0.85;
  } else {
    t.regimeTag = 'NORMAL';
    t.aggressionLevel = 0.6;
    t.confidenceLevel = 0.65;
  }
  
  t.aggressionLevel = Math.max(0.15, Math.min(1.0, t.aggressionLevel));
  t.confidenceLevel = Math.max(0.2, Math.min(1.0, t.confidenceLevel));
  
  return t;
}

// ============== Session Detection ==============

function getSessionInfo(): SessionInfo {
  const hour = new Date().getUTCHours();
  
  let label = 'Off-hours';
  let quality = 0.3;
  let phase: SessionInfo['phase'] = 'OFF';
  
  if (hour >= 0 && hour < 8) {
    label = 'Asia Session';
    quality = 0.5;
    phase = hour < 2 ? 'OPEN' : hour < 6 ? 'MID' : 'CLOSE';
  } else if (hour >= 7 && hour < 16) {
    label = hour >= 13 && hour < 16 ? 'London/NY Overlap' : 'London Session';
    quality = hour >= 13 ? 0.9 : 0.75;
    phase = hour < 9 ? 'OPEN' : hour < 14 ? 'MID' : 'CLOSE';
  } else if (hour >= 12 && hour < 21) {
    label = hour < 16 ? 'London/NY Overlap' : 'NY Session';
    quality = hour < 16 ? 0.9 : 0.7;
    phase = hour < 14 ? 'OPEN' : hour < 18 ? 'MID' : 'CLOSE';
  }
  
  return { label, quality, phase };
}

// ============== Adaptive Mode Selection ==============

function selectAdaptiveSubMode(
  avgRegime: RegimeSnapshot,
  sessionQuality: number,
  thermostat: ThermostatState,
  recentTrades: any[]
): 'burst' | 'scalper' | 'trend' {
  const scores = { burst: 50, scalper: 50, trend: 50 };
  
  // Regime structure influence
  if (avgRegime.structure === 'trend') {
    scores.trend += 25;
    scores.burst += 10;
    scores.scalper -= 5;
  } else {
    scores.scalper += 20;
    scores.burst += 15;
    scores.trend -= 15;
  }
  
  // Volatility influence
  if (avgRegime.volatility === 'high') {
    scores.burst += 20;
    scores.trend += 10;
  } else if (avgRegime.volatility === 'low') {
    scores.scalper += 15;
    scores.burst -= 10;
  }
  
  // Trend strength influence
  if (avgRegime.trendStrength > 60) {
    scores.trend += 15;
  } else if (avgRegime.trendStrength < 30) {
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
  }
  
  // Thermostat influence
  if (thermostat.aggressionLevel > 0.7) {
    scores.burst += 15;
  } else if (thermostat.aggressionLevel < 0.3) {
    scores.burst -= 15;
  }
  
  // Recent mode performance
  const modePerf = { burst: 0, scalper: 0, trend: 0 };
  for (const trade of recentTrades.slice(-20)) {
    const mode = trade.mode as keyof typeof modePerf;
    if (modePerf[mode] !== undefined) {
      modePerf[mode] += Number(trade.realized_pnl) > 0 ? 1 : -0.5;
    }
  }
  scores.burst += modePerf.burst * 3;
  scores.scalper += modePerf.scalper * 3;
  scores.trend += modePerf.trend * 3;
  
  // Find winner
  if (scores.trend >= scores.burst && scores.trend >= scores.scalper) return 'trend';
  if (scores.burst >= scores.scalper) return 'burst';
  return 'scalper';
}

// ============== Master Logic v1.5 - Unified Brain ==============

interface MasterLogicContext {
  selectedMode: TradingModeKey;
  symbols: string[];
  ticks: Record<string, PriceTick>;
  equity: number;
  baseRiskPercent: number;
  maxOpenTrades: number;
  openPositions: Position[];
  recentTrades: any[];
  todayPnlPercent: number;
}

interface ScoredCandidate {
  symbol: string;
  tick: PriceTick;
  regime: RegimeSnapshot;
  direction: Side;
  qualityScore: number;
  confidence: number;
  reasons: string[];
}

function runMasterLogicV15(ctx: MasterLogicContext): {
  proposedOrders: ProposedOrder[];
  positionsToClose: Array<{ id: string; reason: string }>;
  effectiveMode: TradingModeKey;
  adaptiveSubMode?: 'burst' | 'scalper' | 'trend';
  thermostat: ThermostatState;
  diagnostics: { symbolsEvaluated: number; candidatesFound: number; passedFilters: number };
} {
  const diagnostics = { symbolsEvaluated: 0, candidatesFound: 0, passedFilters: 0 };
  const session = getSessionInfo();
  
  // Guard: ensure ticks object exists
  if (!ctx.ticks || typeof ctx.ticks !== 'object') {
    console.warn('[MASTER_LOGIC] No ticks data provided');
    return {
      proposedOrders: [],
      positionsToClose: [],
      effectiveMode: ctx.selectedMode,
      thermostat: updateThermostat(ctx.recentTrades, ctx.todayPnlPercent),
      diagnostics,
    };
  }
  
  // 1. Update thermostat
  const thermostat = updateThermostat(ctx.recentTrades, ctx.todayPnlPercent);
  
  // 2. Filter symbols to only those with available tick data
  const availableSymbols = ctx.symbols.filter(s => ctx.ticks[s] && ctx.ticks[s].mid > 0);
  if (availableSymbols.length === 0) {
    console.warn('[MASTER_LOGIC] No symbols have valid tick data');
    return {
      proposedOrders: [],
      positionsToClose: [],
      effectiveMode: ctx.selectedMode,
      thermostat,
      diagnostics,
    };
  }
  
  // 3. Classify regimes for available symbols only
  const regimes: Record<string, RegimeSnapshot> = {};
  for (const symbol of availableSymbols) {
    const tick = ctx.ticks[symbol];
    regimes[symbol] = classifyRegime(symbol, tick);
  }
  
  // 3. Resolve effective mode (handle Adaptive)
  let effectiveMode = ctx.selectedMode;
  let adaptiveSubMode: 'burst' | 'scalper' | 'trend' | undefined;
  
  if (ctx.selectedMode === 'adaptive') {
    // Calculate average regime
    const regimeList = Object.values(regimes);
    const avgRegime: RegimeSnapshot = regimeList.length > 0 ? {
      symbol: 'AVERAGE',
      trendBias: regimeList.filter(r => r.trendBias === 'bull').length > regimeList.length / 2 ? 'bull' 
        : regimeList.filter(r => r.trendBias === 'bear').length > regimeList.length / 2 ? 'bear' : 'neutral',
      structure: regimeList.filter(r => r.structure === 'trend').length >= regimeList.length / 2 ? 'trend' : 'range',
      volatility: regimeList.reduce((s, r) => s + r.volatilityRatio, 0) / regimeList.length > 1.3 ? 'high' : 'normal',
      trendStrength: regimeList.reduce((s, r) => s + r.trendStrength, 0) / regimeList.length,
      volatilityRatio: regimeList.reduce((s, r) => s + r.volatilityRatio, 0) / regimeList.length,
      confidence: regimeList.reduce((s, r) => s + r.confidence, 0) / regimeList.length,
      smaAlignment: 'mixed',
    } : { symbol: 'AVERAGE', trendBias: 'neutral', structure: 'range', volatility: 'normal', trendStrength: 40, volatilityRatio: 1, confidence: 0.5, smaAlignment: 'mixed' };
    
    adaptiveSubMode = selectAdaptiveSubMode(avgRegime, session.quality, thermostat, ctx.recentTrades);
    console.log(`[ADAPTIVE] Selected sub-mode: ${adaptiveSubMode} (regime=${avgRegime.structure}/${avgRegime.volatility}, session=${session.quality.toFixed(2)})`);
  }
  
  const activeProfile = MODE_PROFILES[adaptiveSubMode || effectiveMode] || MODE_PROFILES.scalper;
  
  // 4. Evaluate positions for management/closure
  const positionsToClose: Array<{ id: string; reason: string }> = [];
  
  for (const pos of ctx.openPositions) {
    const tick = ctx.ticks[pos.symbol];
    if (!tick) continue;
    
    const currentPrice = pos.side === 'long' ? tick.bid : tick.ask;
    const entryPrice = Number(pos.entry_price);
    const pnlPercent = entryPrice > 0 
      ? ((pos.side === 'long' ? currentPrice - entryPrice : entryPrice - currentPrice) / entryPrice) * 100
      : 0;
    
    // Mode-specific profile for the position
    const posProfile = MODE_PROFILES[pos.mode as TradingModeKey] || activeProfile;
    
    // Check per-position SL
    if (pnlPercent <= -posProfile.defaultStopPercent) {
      positionsToClose.push({ id: pos.id, reason: 'position_sl' });
      continue;
    }
    
    // Check per-position TP
    const tpPercent = posProfile.defaultStopPercent * posProfile.defaultTPMultiplier;
    if (pnlPercent >= tpPercent) {
      positionsToClose.push({ id: pos.id, reason: 'position_tp' });
      continue;
    }
    
    // Cut losers early
    if (pnlPercent <= posProfile.cutLoserThreshold) {
      positionsToClose.push({ id: pos.id, reason: 'cut_loser' });
      continue;
    }
    
    // Trailing stop
    if (pnlPercent >= posProfile.trailingStopActivation) {
      const trailLevel = posProfile.trailingStopActivation - posProfile.trailingStopDistance;
      if (pnlPercent < trailLevel) {
        positionsToClose.push({ id: pos.id, reason: 'trailing_stop' });
        continue;
      }
    }
    
    // Age limit
    const ageMinutes = (Date.now() - new Date(pos.opened_at).getTime()) / (1000 * 60);
    if (ageMinutes > posProfile.maxHoldMinutes) {
      positionsToClose.push({ id: pos.id, reason: 'age_limit' });
      continue;
    }
    
    // Regime flip check
    const regime = regimes[pos.symbol];
    if (regime && thermostat.regimeTag !== 'DANGER') {
      const posDir = pos.side === 'long' ? 'bull' : 'bear';
      if (regime.trendBias !== 'neutral' && regime.trendBias !== posDir && regime.confidence > 0.6 && pnlPercent < 0) {
        positionsToClose.push({ id: pos.id, reason: 'regime_flip' });
      }
    }
  }
  
  // 5. Calculate available slots
  const currentOpenCount = ctx.openPositions.length - positionsToClose.length;
  const availableSlots = Math.max(0, Math.min(activeProfile.maxConcurrentTradesTotal, ctx.maxOpenTrades) - currentOpenCount);
  
  if (availableSlots === 0) {
    return { proposedOrders: [], positionsToClose, effectiveMode, adaptiveSubMode, thermostat, diagnostics };
  }
  
  // 6. Score all symbols (only those with valid ticks)
  const candidates: ScoredCandidate[] = [];
  
  for (const symbol of availableSymbols) {
    diagnostics.symbolsEvaluated++;
    const tick = ctx.ticks[symbol];
    if (!tick || !tick.mid || tick.mid <= 0) continue;
    
    const regime = regimes[symbol] || { symbol, trendBias: 'neutral' as TrendBias, structure: 'range' as MarketStructure, volatility: 'normal' as VolatilityLevel, trendStrength: 40, volatilityRatio: 1, confidence: 0.4, smaAlignment: 'mixed' as const };
    const reasons: string[] = [];
    let score = 40;
    
    // Regime suitability
    if (activeProfile.preferredStructures.includes(regime.structure)) {
      score += 25;
      reasons.push(`${regime.structure}`);
    } else if (activeProfile.allowedInAnyRegime) {
      score += 10;
    } else {
      score -= 15;
    }
    
    if (activeProfile.preferredVolatility.includes(regime.volatility)) {
      score += 20;
      reasons.push(`${regime.volatility} vol`);
    }
    
    if (regime.trendBias !== 'neutral') {
      score += 10;
      reasons.push(`${regime.trendBias}`);
    }
    
    // Trend strength contribution
    if (activeProfile.preferredStructures.includes('trend')) {
      score += (regime.trendStrength / 100) * 20;
    }
    
    // Confidence boost
    score += regime.confidence * 10;
    
    // Session quality
    if (session.quality >= 0.7) {
      score += 5;
      reasons.push('good session');
    }
    
    // Thermostat modifier
    score *= (0.7 + thermostat.aggressionLevel * 0.3);
    
    // Check existing positions in symbol
    const existingCount = ctx.openPositions.filter(p => p.symbol === symbol).length;
    if (existingCount >= activeProfile.maxConcurrentTradesPerSymbol) continue;
    if (existingCount > 0) score -= existingCount * 10;
    
    // Determine direction
    let direction: Side;
    if (regime.trendBias === 'bull' && regime.confidence > 0.35) {
      direction = 'long';
    } else if (regime.trendBias === 'bear' && regime.confidence > 0.35) {
      direction = 'short';
    } else {
      // Fallback - always have a direction to ensure trades fire
      direction = Math.random() > 0.5 ? 'long' : 'short';
    }
    
    // Calculate confidence
    let confidence = 0.5 + (score - 50) / 100;
    confidence = Math.max(0.3, Math.min(0.95, confidence));
    
    candidates.push({
      symbol,
      tick,
      regime,
      direction,
      qualityScore: Math.max(0, Math.min(100, score)),
      confidence,
      reasons,
    });
    diagnostics.candidatesFound++;
  }
  
  // Sort by quality
  candidates.sort((a, b) => b.qualityScore - a.qualityScore);
  
  // 7. Filter by thresholds
  const threshold = activeProfile.entryScoreThreshold - 
    (thermostat.aggressionLevel > 0.7 ? 5 : 0) +
    (thermostat.regimeTag === 'DANGER' ? 15 : 0);
  
  const filtered = candidates.filter(c => 
    c.qualityScore >= threshold && c.confidence >= activeProfile.edgeConfidenceMin
  );
  diagnostics.passedFilters = filtered.length;
  
  // 8. Select top candidates
  const maxPerTick = Math.min(activeProfile.maxEntriesPerTick, availableSlots);
  const selected = filtered.slice(0, maxPerTick);
  
  // 9. Generate orders
  const proposedOrders: ProposedOrder[] = [];
  const batchId = `${adaptiveSubMode || effectiveMode}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  
  for (const candidate of selected) {
    const { symbol, tick, direction, qualityScore, confidence, reasons, regime } = candidate;
    
    // Calculate size adjustments based on conditions
    let sizeMultiplier = activeProfile.basePositionSizeFactor;
    if (regime.structure === 'trend' && activeProfile.preferredStructures.includes('trend')) {
      sizeMultiplier += 0.15;
    }
    if (session.quality < 0.5) sizeMultiplier -= 0.2;
    if (thermostat.aggressionLevel < 0.3) sizeMultiplier *= 0.7;
    else if (thermostat.aggressionLevel > 0.7) sizeMultiplier *= 1.2;
    sizeMultiplier = Math.max(0.2, Math.min(1.5, sizeMultiplier));
    
    const riskPercent = ctx.baseRiskPercent * sizeMultiplier;
    const slPercent = activeProfile.defaultStopPercent / 100;
    const slDistance = tick.mid * slPercent;
    
    const riskAmount = ctx.equity * (riskPercent / 100);
    const size = slDistance > 0 ? Math.max(0.001, riskAmount / slDistance) : 0.001;
    
    const tpPercent = activeProfile.defaultStopPercent * activeProfile.defaultTPMultiplier / 100;
    const tpDistance = tick.mid * tpPercent;
    
    const sl = direction === 'long' ? tick.mid - slDistance : tick.mid + slDistance;
    const tp = direction === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance;
    
    const mode = (adaptiveSubMode || effectiveMode) as TradingModeKey;
    const reasonStr = `${mode.toUpperCase()}: ${reasons.slice(0, 3).join(', ')} (Q=${qualityScore.toFixed(0)})`;
    
    proposedOrders.push({
      symbol,
      side: direction,
      size,
      entryPrice: tick.mid,
      sl,
      tp,
      mode,
      reason: reasonStr,
      confidence,
      qualityScore,
      batchId: mode === 'burst' ? batchId : undefined,
    });
    
    console.log(`[MASTER_LOGIC] Order: ${symbol} ${direction} Q=${qualityScore.toFixed(0)} conf=${confidence.toFixed(2)} mode=${mode}`);
  }
  
  return {
    proposedOrders,
    positionsToClose,
    effectiveMode,
    adaptiveSubMode,
    thermostat,
    diagnostics,
  };
}

// ============== Main Handler ==============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid auth' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;
    const body = await req.json().catch(() => ({}));
    const { burstRequested, globalClose, takeBurstProfit, takeProfit } = body;
    const today = new Date().toISOString().split('T')[0];

    // ================================================================
    // MANUAL ACTION GUARD
    // ================================================================
    const isManualAction = takeProfit === true || globalClose === true;
    if (isManualAction) {
      console.log(`[MANUAL_ACTION] Detected: takeProfit=${takeProfit}, globalClose=${globalClose}`);
    }

    // Fetch latest prices with error handling
    let ticks: Record<string, PriceTick> | null = null;
    let priceFeedRaw: unknown = null;
    
    try {
      const priceResponse = await fetch(`${supabaseUrl}/functions/v1/price-feed`, {
        headers: { Authorization: `Bearer ${supabaseKey}` },
      });
      priceFeedRaw = await priceResponse.json();
      
      if (priceFeedRaw && typeof priceFeedRaw === 'object' && 'ticks' in priceFeedRaw) {
        const rawTicks = (priceFeedRaw as { ticks: unknown }).ticks;
        if (rawTicks && typeof rawTicks === 'object' && !Array.isArray(rawTicks)) {
          ticks = rawTicks as Record<string, PriceTick>;
        }
      }
    } catch (priceFetchError) {
      console.error('[PAPER_TICK] Failed to fetch prices:', priceFetchError);
    }
    
    // ================================================================
    // HARD GUARD: Validate ticks shape
    // ================================================================
    if (ticks === undefined || ticks === null || typeof ticks !== 'object' || Object.keys(ticks).length === 0) {
      console.warn('[PAPER_TICK] NO_TICK_DATA - ticks invalid or empty');
      return new Response(JSON.stringify({
        ok: false,
        error: 'NO_TICK_DATA',
        details: priceFeedRaw ?? null,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const availableSymbols = Object.keys(ticks);
    console.log(`[PAPER_TICK] Got ${availableSymbols.length} symbols: ${availableSymbols.slice(0, 5).join(', ')}...`);

    // ================================================================
    // TAKE PROFIT HANDLER
    // ================================================================
    if (takeProfit === true) {
      console.log(`[TAKE_PROFIT] ATOMIC CLOSE starting for user ${userId}`);
      
      const { data: allPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId);
      const closedCount = (allPositions || []).length;
      let closePnl = 0;
      
      const { data: existingTrades } = await supabase.from('paper_trades').select('*').eq('user_id', userId).eq('session_date', today);
      const existingRealizedPnl = (existingTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
      
      const { data: dailyStats } = await supabase.from('paper_stats_daily').select('equity_start').eq('user_id', userId).eq('trade_date', today).maybeSingle();
      const { data: account } = await supabase.from('accounts').select('equity').eq('user_id', userId).eq('type', 'paper').maybeSingle();
      const startingEquity = dailyStats?.equity_start ?? account?.equity ?? 10000;
      
      const { data: config } = await supabase.from('paper_config').select('session_status').eq('user_id', userId).maybeSingle();
      const currentSessionStatus = config?.session_status || 'running';
      
      if (closedCount > 0) {
        const tradeRecords = (allPositions || []).map(pos => {
          const tick = ticks[pos.symbol];
          const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : Number(pos.entry_price);
          const priceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
          const pnl = priceDiff * Number(pos.size);
          closePnl += pnl;
          return {
            user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
            size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
            sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
            realized_pnl: pnl, reason: 'take_profit', session_date: today, batch_id: pos.batch_id,
          };
        });
        
        await Promise.all([
          supabase.from('paper_trades').insert(tradeRecords),
          supabase.from('paper_positions').delete().eq('user_id', userId),
          supabase.from('system_logs').insert({
            user_id: userId, level: 'info', source: 'execution',
            message: `TAKE PROFIT: ${closedCount} positions closed. P&L: $${closePnl.toFixed(2)}`,
          }),
        ]);
      }
      
      const totalRealizedPnl = existingRealizedPnl + closePnl;
      const finalTradesToday = (existingTrades?.length || 0) + closedCount;
      const wins = (existingTrades || []).filter((t: any) => Number(t.realized_pnl) > 0).length + (closePnl > 0 ? 1 : 0);
      
      return new Response(JSON.stringify({ 
        success: true, action: 'takeProfit', closedCount,
        sessionStatus: currentSessionStatus,
        stats: {
          todayPnl: totalRealizedPnl,
          tradesToday: finalTradesToday,
          openPositionsCount: 0,
          equity: startingEquity + totalRealizedPnl,
          winRate: finalTradesToday > 0 ? (wins / finalTradesToday) * 100 : 50,
        }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ================================================================
    // GLOBAL CLOSE HANDLER
    // ================================================================
    if (globalClose === true) {
      console.log(`[GLOBAL_CLOSE] ATOMIC CLOSE + STOP starting for user ${userId}`);
      
      const { data: allPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId);
      const closedCount = (allPositions || []).length;
      let closePnl = 0;
      
      const { data: existingTrades } = await supabase.from('paper_trades').select('*').eq('user_id', userId).eq('session_date', today);
      const existingRealizedPnl = (existingTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
      
      const { data: dailyStats } = await supabase.from('paper_stats_daily').select('equity_start').eq('user_id', userId).eq('trade_date', today).maybeSingle();
      const { data: account } = await supabase.from('accounts').select('equity').eq('user_id', userId).eq('type', 'paper').maybeSingle();
      const startingEquity = dailyStats?.equity_start ?? account?.equity ?? 10000;
      
      if (closedCount > 0) {
        const tradeRecords = (allPositions || []).map(pos => {
          const tick = ticks[pos.symbol];
          const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : Number(pos.entry_price);
          const priceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
          const pnl = priceDiff * Number(pos.size);
          closePnl += pnl;
          return {
            user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
            size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
            sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
            realized_pnl: pnl, reason: 'global_close', session_date: today, batch_id: pos.batch_id,
          };
        });
        
        await Promise.all([
          supabase.from('paper_trades').insert(tradeRecords),
          supabase.from('paper_positions').delete().eq('user_id', userId),
          supabase.from('paper_config').update({ session_status: 'idle', is_running: false, burst_requested: false }).eq('user_id', userId),
          supabase.from('system_logs').insert({
            user_id: userId, level: 'info', source: 'execution',
            message: `CLOSE ALL: ${closedCount} positions closed. Session stopped.`,
          }),
        ]);
      } else {
        await Promise.all([
          supabase.from('paper_config').update({ session_status: 'idle', is_running: false, burst_requested: false }).eq('user_id', userId),
          supabase.from('system_logs').insert({
            user_id: userId, level: 'info', source: 'execution',
            message: `CLOSE ALL: No positions found. Session stopped.`,
          }),
        ]);
      }
      
      const totalRealizedPnl = existingRealizedPnl + closePnl;
      const finalTradesToday = (existingTrades?.length || 0) + closedCount;
      
      return new Response(JSON.stringify({ 
        success: true, action: 'globalClose', closedCount,
        sessionStatus: 'idle',
        stats: {
          todayPnl: totalRealizedPnl,
          tradesToday: finalTradesToday,
          openPositionsCount: 0,
          equity: startingEquity + totalRealizedPnl,
          winRate: 50,
        }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ================================================================
    // REGULAR TICK
    // ================================================================
    
    let { data: config } = await supabase.from('paper_config').select('*').eq('user_id', userId).maybeSingle();

    if (!config) {
      const { data: newConfig, error: createError } = await supabase.from('paper_config').insert({
        user_id: userId,
        risk_config: DEFAULT_RISK_CONFIG,
        burst_config: DEFAULT_BURST_CONFIG,
        mode_config: DEFAULT_MODE_CONFIG,
        market_config: DEFAULT_MARKET_CONFIG,
        session_status: 'idle',
      }).select().single();
      if (createError) throw createError;
      config = newConfig;
    }

    const riskConfig = config.risk_config || DEFAULT_RISK_CONFIG;
    const burstConfig = config.burst_config || DEFAULT_BURST_CONFIG;
    const modeConfig = config.mode_config || DEFAULT_MODE_CONFIG;
    const marketConfig = config.market_config || DEFAULT_MARKET_CONFIG;
    const sessionStatus: SessionStatus = config.session_status || 'idle';

    const { data: dailyStats } = await supabase.from('paper_stats_daily').select('equity_start').eq('user_id', userId).eq('trade_date', today).maybeSingle();
    const { data: account } = await supabase.from('accounts').select('equity').eq('user_id', userId).eq('type', 'paper').maybeSingle();
    const startingEquity = dailyStats?.equity_start ?? account?.equity ?? 10000;

    const { data: positions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('closed', false);
    const { data: todayTrades } = await supabase.from('paper_trades').select('*').eq('user_id', userId).eq('session_date', today);

    const realizedPnl = (todayTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
    const unrealizedPnl = (positions || []).reduce((sum: number, p: any) => sum + Number(p.unrealized_pnl || 0), 0);
    const currentPnl = realizedPnl + unrealizedPnl;
    const currentPnlPercent = startingEquity > 0 ? (currentPnl / startingEquity) * 100 : 0;
    const closedCount = (todayTrades || []).length;
    const wins = (todayTrades || []).filter((t: any) => Number(t.realized_pnl) > 0).length;
    const winRate = closedCount > 0 ? (wins / closedCount) * 100 : 50;

    // Check daily loss limit
    const isHalted = currentPnlPercent <= -riskConfig.maxDailyLossPercent;
    
    if (isHalted && !config.trading_halted_for_day) {
      await supabase.from('system_logs').insert({
        user_id: userId, level: 'error', source: 'risk',
        message: `RISK: Trading HALTED - Daily loss limit of ${riskConfig.maxDailyLossPercent}% reached`,
        meta: { currentPnlPercent, limit: riskConfig.maxDailyLossPercent },
      });

      for (const pos of (positions || [])) {
        const tick = ticks[pos.symbol];
        const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : Number(pos.entry_price);
        const priceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
        const pnl = priceDiff * Number(pos.size);

        await supabase.from('paper_trades').insert({
          user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
          size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
          sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
          realized_pnl: pnl, reason: 'risk_halt', session_date: today, batch_id: pos.batch_id,
        });
        await supabase.from('paper_positions').delete().eq('id', pos.id);
      }

      await supabase.from('paper_config').update({ 
        trading_halted_for_day: true, session_status: 'idle', is_running: false 
      }).eq('user_id', userId);
    }

    // Handle take burst profit
    if (takeBurstProfit) {
      const { data: burstPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('mode', 'burst');
      const burstCount = (burstPositions || []).length;
      
      if (burstCount > 0) {
        const burstIds = (burstPositions || []).map(p => p.id);
        const tradeRecords = (burstPositions || []).map(pos => {
          const tick = ticks[pos.symbol];
          const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : Number(pos.entry_price);
          const priceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
          const pnl = priceDiff * Number(pos.size);
          return {
            user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
            size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
            sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
            realized_pnl: pnl, reason: 'take_burst_profit', session_date: today, batch_id: pos.batch_id,
          };
        });
        
        await Promise.all([
          supabase.from('paper_trades').insert(tradeRecords),
          supabase.from('paper_positions').delete().in('id', burstIds),
          supabase.from('system_logs').insert({
            user_id: userId, level: 'info', source: 'burst',
            message: `BURST: Take profit - ${burstCount} burst positions closed`,
          }),
        ]);
      }
    }

    // Update burst requested flag
    if (burstRequested !== undefined) {
      await supabase.from('paper_config').update({ burst_requested: burstRequested }).eq('user_id', userId);
      config.burst_requested = burstRequested;
      if (burstRequested) {
        await supabase.from('system_logs').insert({
          user_id: userId, level: 'info', source: 'burst',
          message: `BURST: Mode activated`,
        });
      }
    }

    // Re-fetch positions for position management
    const { data: currentPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('closed', false);

    // Update mark-to-market for all positions
    for (const pos of (currentPositions || [])) {
      const tick = ticks[pos.symbol];
      if (!tick) continue;
      const currentPrice = pos.side === 'long' ? tick.bid : tick.ask;
      const priceDiff = pos.side === 'long' ? currentPrice - Number(pos.entry_price) : Number(pos.entry_price) - currentPrice;
      const unrealizedPnl = priceDiff * Number(pos.size);
      await supabase.from('paper_positions').update({ unrealized_pnl: unrealizedPnl }).eq('id', pos.id);
    }

    // Re-fetch and calculate stats
    const { data: finalPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('closed', false);
    const { data: finalTrades } = await supabase.from('paper_trades').select('*').eq('user_id', userId).eq('session_date', today);
    
    const finalRealizedPnl = (finalTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
    const finalUnrealizedPnl = (finalPositions || []).reduce((sum: number, p: any) => sum + Number(p.unrealized_pnl || 0), 0);
    const finalTodayPnl = finalRealizedPnl + finalUnrealizedPnl;
    const finalTodayPnlPercent = startingEquity > 0 ? (finalTodayPnl / startingEquity) * 100 : 0;
    const finalClosedCount = (finalTrades || []).length;
    const finalWins = (finalTrades || []).filter((t: any) => Number(t.realized_pnl) > 0).length;
    const finalWinRate = finalClosedCount > 0 ? (finalWins / finalClosedCount) * 100 : 50;

    // Re-fetch session status
    const { data: freshConfig } = await supabase.from('paper_config').select('session_status, is_running').eq('user_id', userId).maybeSingle();
    const freshSessionStatus: SessionStatus = freshConfig?.session_status || 'idle';
    const freshIsRunning = freshConfig?.is_running ?? false;
    
    const shouldRunModes = freshSessionStatus === 'running' && freshIsRunning && !isHalted && !config.trading_halted_for_day;
    
    console.log(`[ENGINE] status=${freshSessionStatus}, running=${freshIsRunning}, shouldRunModes=${shouldRunModes}, positions=${(finalPositions || []).length}`);
    
    if (shouldRunModes) {
      // Ensure we always have symbols to trade
      let symbolsToTrade = marketConfig.selectedSymbols || [];
      if (!symbolsToTrade || symbolsToTrade.length === 0) {
        symbolsToTrade = DEFAULT_MARKET_CONFIG.selectedSymbols;
      }
      
      // ================================================================
      // VALIDATE SYMBOLS AGAINST RETURNED TICKS
      // ================================================================
      const validSymbols = symbolsToTrade.filter((s: string) => {
        const v = ticks?.[s];
        return v !== undefined && v !== null && typeof v === 'object' && v.mid > 0;
      });
      
      if (validSymbols.length === 0) {
        console.warn(`[ENGINE] NO_VALID_SYMBOLS - requested: ${symbolsToTrade.join(', ')}`);
        console.warn(`[ENGINE] Available ticks: ${Object.keys(ticks || {}).join(', ')}`);
        return new Response(JSON.stringify({
          ok: false,
          error: 'NO_VALID_SYMBOLS',
          requested: symbolsToTrade,
          available: Object.keys(ticks || {}),
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      // Use validSymbols instead of symbolsWithData
      const symbolsWithData = validSymbols;
      
      // Determine selected mode
      let enabledModes = modeConfig.enabledModes as TradingModeKey[] || ['scalper'];
      if (!enabledModes || enabledModes.length === 0) {
        enabledModes = ['burst', 'trend', 'scalper'];
      }
      
      // Pick primary mode (first enabled, or burst if explicitly requested)
      let selectedMode: TradingModeKey = enabledModes[0] || 'scalper';
      if (config.burst_requested) {
        selectedMode = 'burst';
      }
      
      // Check burst lock
      const burstTrades = (finalTrades || []).filter((t: any) => t.mode === 'burst');
      const burstPnl = burstTrades.reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
      const burstPnlPercent = startingEquity > 0 ? (burstPnl / startingEquity) * 100 : 0;
      const burstLocked = burstPnlPercent >= burstConfig.dailyProfitTargetPercent;
      
      if (selectedMode === 'burst' && burstLocked) {
        await supabase.from('system_logs').insert({
          user_id: userId, level: 'info', source: 'burst',
          message: `BURST: Mode locked - Daily target reached`,
        });
        selectedMode = enabledModes.find(m => m !== 'burst') || 'scalper';
      }
      
      console.log(`[ENGINE] Running Master Logic v1.5 with mode=${selectedMode}, symbols=${symbolsWithData.length} (of ${symbolsToTrade.length} configured)`);
      
      // Run Master Logic v1.5
      const result = runMasterLogicV15({
        selectedMode,
        symbols: symbolsWithData,
        ticks,
        equity: startingEquity + finalTodayPnl,
        baseRiskPercent: riskConfig.riskPerTrade || 2,
        maxOpenTrades: riskConfig.maxOpenTrades || 20,
        openPositions: (finalPositions || []) as Position[],
        recentTrades: finalTrades || [],
        todayPnlPercent: finalTodayPnlPercent,
      });
      
      console.log(`[MASTER_LOGIC] Diagnostics: evaluated=${result.diagnostics.symbolsEvaluated}, candidates=${result.diagnostics.candidatesFound}, passed=${result.diagnostics.passedFilters}`);
      console.log(`[MASTER_LOGIC] Thermostat: regime=${result.thermostat.regimeTag}, aggression=${result.thermostat.aggressionLevel.toFixed(2)}, winRate=${result.thermostat.recentWinRate.toFixed(0)}%`);
      
      // Process position closures from Master Logic
      for (const closeOrder of result.positionsToClose) {
        const pos = (finalPositions || []).find((p: any) => p.id === closeOrder.id);
        if (!pos) continue;
        
        const tick = ticks[pos.symbol];
        const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : Number(pos.entry_price);
        const priceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
        const pnl = priceDiff * Number(pos.size);
        
        await supabase.from('paper_trades').insert({
          user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
          size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
          sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
          realized_pnl: pnl, reason: closeOrder.reason, session_date: today, batch_id: pos.batch_id,
        });
        await supabase.from('paper_positions').delete().eq('id', pos.id);
        
        await supabase.from('system_logs').insert({
          user_id: userId,
          level: pnl >= 0 ? 'info' : 'warn',
          source: 'execution',
          message: `${pos.mode.toUpperCase()}: ${pos.symbol} ${pos.side.toUpperCase()} closed - ${closeOrder.reason} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
          meta: { pnl, mode: pos.mode, reason: closeOrder.reason },
        });
      }
      
      // Open new positions from Master Logic
      let openedCount = 0;
      const openedByMode: Record<string, number> = {};
      
      for (const order of result.proposedOrders) {
        const insertPayload = {
          user_id: userId,
          symbol: order.symbol,
          mode: order.mode,
          side: order.side,
          size: order.size,
          entry_price: order.entryPrice,
          sl: order.sl,
          tp: order.tp,
          batch_id: order.batchId,
          unrealized_pnl: 0,
        };
        
        const { error: insertError } = await supabase.from('paper_positions').insert(insertPayload);
        
        if (insertError) {
          console.error(`[ENGINE] Insert error for ${order.symbol}:`, JSON.stringify(insertError));
          continue;
        }

        openedCount++;
        openedByMode[order.mode] = (openedByMode[order.mode] || 0) + 1;
        
        console.log(`[ENGINE] OPENED: ${order.symbol} ${order.side} mode=${order.mode} Q=${order.qualityScore.toFixed(0)}`);
      }

      // Log opened positions
      for (const [mode, count] of Object.entries(openedByMode)) {
        await supabase.from('system_logs').insert({
          user_id: userId,
          level: 'info',
          source: mode === 'burst' ? 'burst' : 'execution',
          message: `${mode.toUpperCase()}: Opened ${count} position(s)`,
          meta: { count, mode, effectiveMode: result.effectiveMode, adaptiveSubMode: result.adaptiveSubMode },
        });
      }
    }

    // Final stats
    const { data: veryFinalPositions } = await supabase.from('paper_positions').select('id').eq('user_id', userId).eq('closed', false);
    const { data: veryFinalTrades } = await supabase.from('paper_trades').select('realized_pnl').eq('user_id', userId).eq('session_date', today);
    
    const veryFinalRealizedPnl = (veryFinalTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);

    return new Response(JSON.stringify({ 
      success: true, 
      sessionStatus: freshSessionStatus,
      halted: isHalted,
      stats: {
        todayPnl: finalTodayPnl,
        todayPnlPercent: finalTodayPnlPercent,
        tradesToday: finalClosedCount,
        openPositionsCount: (veryFinalPositions || []).length,
        equity: startingEquity + veryFinalRealizedPnl,
        winRate: finalWinRate,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    // ================================================================
    // UNCAUGHT EXCEPTION HANDLER - Never return 500
    // ================================================================
    console.error('[PAPER_TICK] UNCAUGHT_EXCEPTION:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : null;
    return new Response(JSON.stringify({ 
      ok: false,
      error: 'UNCAUGHT_EXCEPTION',
      message: errorMessage,
      stack: errorStack,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
