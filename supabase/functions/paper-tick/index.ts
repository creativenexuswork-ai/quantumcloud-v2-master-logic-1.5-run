// ============= PAPER TICK v1.5 — Master Logic Integration =============
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeModeKey, normalizeEnabledModes, normalizeRiskConfig, resolveAccountEquity,
  decideDirection, evaluateExit, governor, positionRisk, netClosePnl, sizeFromRisk,
  executionPrice, canAddSymbolExposure,
  type EquityResult, type RiskConfig, type CostModelConfig,
} from "../_shared/paper-core.ts";

// Canonical equity loader: requires verified baseline + account-scoped realized trades.
// deno-lint-ignore no-explicit-any
async function loadEquity(supabase: any, userId: string, unrealizedOverride?: number[]): Promise<EquityResult> {
  const [{ data: accts, error: aErr }, { data: realized, error: tErr }, { data: open, error: pErr }] = await Promise.all([
    supabase.from('accounts').select('id, equity, type, is_active, opening_capital_set_at').eq('user_id', userId).eq('type', 'paper').eq('is_active', true),
    supabase.from('paper_trades').select('realized_pnl, account_id').eq('user_id', userId),
    supabase.from('paper_positions').select('unrealized_pnl').eq('user_id', userId).eq('closed', false),
  ]);
  if (aErr || tErr || pErr) return { ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'LOAD_FAILED' };
  return resolveAccountEquity(
    accts,
    realized || [],
    unrealizedOverride ?? (open || []).map((p: any) => Number(p.unrealized_pnl || 0)),
  );
}

// Shared close accounting helper used by all close paths (manual TP, global close, burst TP, engine exits).
// deno-lint-ignore no-explicit-any
function buildCloseRecord(pos: any, tick: PriceTick | undefined, reason: string, costModel: CostModelConfig, userId: string, today: string) {
  const entry = Number(pos.entry_price);
  const size = Number(pos.size);
  const exitPrice = tick ? executionPrice(pos.side, 'exit', tick, costModel) : entry;
  const { net } = netClosePnl(pos.side, entry, exitPrice, size, costModel);
  return {
    record: {
      user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
      size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
      sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
      realized_pnl: net, reason, session_date: today, batch_id: pos.batch_id,
    },
    pnl: net,
    exitPrice,
  };
}

function equityFields(eq: EquityResult) {
  return eq.ok
    ? { equity: eq.equity, balance: eq.balance, equityStatus: 'OK' }
    : { equity: null, balance: null, equityStatus: eq.code, equityReason: eq.reason };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============== Default Configs ==============

const DEFAULT_RISK_CONFIG = {
  maxDailyLossPercent: 5,
  maxConcurrentRiskPercent: 10,
  maxOpenTrades: 20,
  maxPerSymbolExposure: 30,
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
  selectedSymbols: ['BTCUSD', 'ETHUSD'],
  typeFilters: { crypto: true, forex: false, index: false, metal: false },
};

// ============== Symbol Normalizer (BTCUSDT → BTCUSD) ==============

function normalizeSymbol(s: string): string {
  const x = (s || '').toUpperCase().trim();
  if (x === 'BTCUSDT') return 'BTCUSD';
  if (x === 'ETHUSDT') return 'ETHUSD';
  // generic: strip trailing 'T' if stored as USDT variants
  if (x.endsWith('USDT')) return x.replace('USDT', 'USD');
  return x;
}

function normalizeSymbolList(list: string[]): string[] {
  const out = (list || []).map(normalizeSymbol).filter(Boolean);
  // de-dupe while preserving order
  return Array.from(new Set(out));
}

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
  
  // Manual exit reasons that should be neutral when PnL < 0
  const NEUTRAL_REASONS = ['take_profit', 'global_close', 'take_burst_profit'];
  
  const recentCount = recentTrades.length;
  if (recentCount > 0) {
    // Count wins/losses, treating manual negative closes as neutral
    let wins = 0;
    let countedTrades = 0;
    for (const tr of recentTrades) {
      const pnl = Number(tr.realized_pnl);
      const isManualNegative = NEUTRAL_REASONS.includes(tr.reason) && pnl < 0;
      if (isManualNegative) continue; // Skip neutral trades entirely
      countedTrades++;
      if (pnl > 0) wins++;
    }
    t.recentWinRate = countedTrades > 0 ? (wins / countedTrades) * 100 : 50;
    
    // Streak calculation - manual negative closes don't break/extend streaks
    let streak = 0;
    for (let i = recentTrades.length - 1; i >= 0 && i >= recentTrades.length - 5; i--) {
      const tr = recentTrades[i];
      const pnl = Number(tr.realized_pnl);
      const isManualNegative = NEUTRAL_REASONS.includes(tr.reason) && pnl < 0;
      if (isManualNegative) continue; // Skip neutral trades
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
  maxPerSymbolExposurePct: number;
  costModel: CostModelConfig;
  burstSize?: number;
  allowEntries: boolean;
  governorSizeMultiplier: number;
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
  slUpdates?: Array<{ id: string; sl: number }>;
  effectiveMode: TradingModeKey;
  adaptiveSubMode?: 'burst' | 'scalper' | 'trend';
  thermostat: ThermostatState;
  diagnostics: { symbolsEvaluated: number; candidatesFound: number; passedFilters: number; noEvidence?: number };
} {
  const diagnostics = { symbolsEvaluated: 0, candidatesFound: 0, passedFilters: 0, noEvidence: 0 };
  const slUpdates: Array<{ id: string; sl: number }> = [];
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
    
    // Profile of the mode that opened the position (legacy 'sniper' -> scalper)
    const posProfile = MODE_PROFILES[(normalizeModeKey(pos.mode) || 'scalper') as TradingModeKey] || activeProfile;
    
    // Position-owned SL/TP + reachable trailing stop (ratchets stored SL)
    const exit = evaluateExit(pos as any, currentPrice, posProfile, Date.now());
    if (exit.action === 'close') {
      positionsToClose.push({ id: pos.id, reason: exit.reason });
      continue;
    }
    if (exit.action === 'move_sl') slUpdates.push({ id: pos.id, sl: exit.sl });
    
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
  
  if (availableSlots === 0 || !ctx.allowEntries) {
    return { proposedOrders: [], positionsToClose, slUpdates, effectiveMode, adaptiveSubMode, thermostat, diagnostics };
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
    // No entry on insufficient evidence (no random fallback)
    const decided = decideDirection(regime.trendBias, regime.confidence);
    if (!decided) { diagnostics.noEvidence++; continue; }
    const direction: Side = decided;
    
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
  const isBurstActive = (adaptiveSubMode || effectiveMode) === 'burst';
  const modeCap = isBurstActive && ctx.burstSize && ctx.burstSize > 0
    ? Math.min(activeProfile.maxEntriesPerTick, ctx.burstSize)
    : activeProfile.maxEntriesPerTick;
  const maxPerTick = Math.min(modeCap, availableSlots);
  const selected = filtered.slice(0, maxPerTick);
  
  // 9. Generate orders
  const proposedOrders: ProposedOrder[] = [];
  const batchId = `${adaptiveSubMode || effectiveMode}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const closingIds = new Set(positionsToClose.map(p => p.id));
  const symbolNotional: Record<string, number> = {};
  for (const p of ctx.openPositions) {
    if (closingIds.has(p.id)) continue;
    symbolNotional[p.symbol] = (symbolNotional[p.symbol] || 0) + Number(p.entry_price) * Number(p.size);
  }
  
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
    
    const riskPercent = ctx.baseRiskPercent * sizeMultiplier * ctx.governorSizeMultiplier;
    const slPercent = activeProfile.defaultStopPercent / 100;
    const entryPrice = executionPrice(direction, 'entry', tick, ctx.costModel);
    const slDistance = entryPrice * slPercent;
    
    const slPrice = direction === 'long' ? entryPrice - slDistance : entryPrice + slDistance;
    const size = sizeFromRisk(ctx.equity, riskPercent, entryPrice, slPrice);
    if (!(size > 0)) continue;
    const orderNotional = entryPrice * size;
    if (!canAddSymbolExposure(ctx.equity, symbolNotional[symbol] || 0, orderNotional, ctx.maxPerSymbolExposurePct)) {
      continue;
    }
    symbolNotional[symbol] = (symbolNotional[symbol] || 0) + orderNotional;
    
    const tpPercent = activeProfile.defaultStopPercent * activeProfile.defaultTPMultiplier / 100;
    const tpDistance = entryPrice * tpPercent;
    
    const sl = direction === 'long' ? entryPrice - slDistance : entryPrice + slDistance;
    const tp = direction === 'long' ? entryPrice + tpDistance : entryPrice - tpDistance;
    
    const mode = (adaptiveSubMode || effectiveMode) as TradingModeKey;
    const reasonStr = `${mode.toUpperCase()}: ${reasons.slice(0, 3).join(', ')} (Q=${qualityScore.toFixed(0)})`;
    
    proposedOrders.push({
      symbol,
      side: direction,
      size,
      entryPrice,
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
    slUpdates,
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
    // Cost model from the normalized risk contract (applied consistently on entry and all close paths)
    const { data: feeCfg } = await supabase.from('paper_config').select('risk_config').eq('user_id', userId).maybeSingle();
    const costModel = normalizeRiskConfig(feeCfg?.risk_config).costModel;

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
      console.warn('[PAPER_TICK] NO_TICK_DATA details:', JSON.stringify(priceFeedRaw));
      return new Response(JSON.stringify({
        ok: false,
        error: 'NO_TICK_DATA',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const availableSymbols = Object.keys(ticks);
    console.log(`[PAPER_TICK] Got ${availableSymbols.length} symbols: ${availableSymbols.slice(0, 5).join(', ')}...`);

    // ================================================================
    // TAKE PROFIT HANDLER
    // ================================================================
    if (takeProfit === true) {
      console.log(`[TAKE_PROFIT] ATOMIC CLOSE starting for user ${userId}`);
      
      // Claim/delete first to prevent duplicate paper_trades inserts under concurrent ticks
      // (true DB-level atomic close RPC is pending until DB access is restored).
      const { data: claimedPositions } = await supabase.from('paper_positions').delete().eq('user_id', userId).select('*');
      const closedCount = (claimedPositions || []).length;
      let closePnl = 0;
      let closedWins = 0;
      
      const { data: existingTrades } = await supabase.from('paper_trades').select('*').eq('user_id', userId).eq('session_date', today);
      const existingRealizedPnl = (existingTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
      
      
      const { data: config } = await supabase.from('paper_config').select('session_status').eq('user_id', userId).maybeSingle();
      const currentSessionStatus = config?.session_status || 'running';
      
      if (closedCount > 0) {
        const tradeRecords = (claimedPositions || []).map((pos: any) => {
          const closed = buildCloseRecord(pos, ticks[pos.symbol], 'take_profit', costModel, userId, today);
          closePnl += closed.pnl;
          if (closed.pnl > 0) closedWins++;
          return closed.record;
        });
        
        await Promise.all([
          supabase.from('paper_trades').insert(tradeRecords),
          supabase.from('system_logs').insert({
            user_id: userId, level: 'info', source: 'execution',
            message: `TAKE PROFIT: ${closedCount} positions closed. P&L: $${closePnl.toFixed(2)}`,
          }),
        ]);
      }
      
      const totalRealizedPnl = existingRealizedPnl + closePnl;
      const finalTradesToday = (existingTrades?.length || 0) + closedCount;
      const wins = (existingTrades || []).filter((t: any) => Number(t.realized_pnl) > 0).length + closedWins;
      
      return new Response(JSON.stringify({ 
        success: true, action: 'takeProfit', closedCount,
        sessionStatus: currentSessionStatus,
        stats: {
          todayPnl: totalRealizedPnl,
          tradesToday: finalTradesToday,
          openPositionsCount: 0,
          ...equityFields(await loadEquity(supabase, userId, [])),
          winRate: finalTradesToday > 0 ? (wins / finalTradesToday) * 100 : 50,
        }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ================================================================
    // GLOBAL CLOSE HANDLER
    // ================================================================
    if (globalClose === true) {
      console.log(`[GLOBAL_CLOSE] ATOMIC CLOSE + STOP starting for user ${userId}`);
      
      // Claim/delete first to prevent duplicate paper_trades inserts under concurrent ticks
      const { data: claimedPositions } = await supabase.from('paper_positions').delete().eq('user_id', userId).select('*');
      const closedCount = (claimedPositions || []).length;
      let closePnl = 0;
      
      const { data: existingTrades } = await supabase.from('paper_trades').select('*').eq('user_id', userId).eq('session_date', today);
      const existingRealizedPnl = (existingTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
      
      
      if (closedCount > 0) {
        const tradeRecords = (claimedPositions || []).map((pos: any) => {
          const closed = buildCloseRecord(pos, ticks[pos.symbol], 'global_close', costModel, userId, today);
          closePnl += closed.pnl;
          return closed.record;
        });
        
        await Promise.all([
          supabase.from('paper_trades').insert(tradeRecords),
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
          ...equityFields(await loadEquity(supabase, userId, [])),
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
    const sessionStartedAt: string | null = config.session_started_at || null;
    const isRunning: boolean = config.is_running ?? false;

    // ================================================================
    // EXECUTION GATE: Skip tick if session inactive or cooldown active
    // This prevents ALL engine state drift (thermostat, adaptive, streak)
    // ================================================================
    const COOLDOWN_AFTER_STOP_MINUTES = 2;
    const COOLDOWN_AFTER_TP_MINUTES = 1;
    
    const now = Date.now();
    let cooldownActive = false;
    let cooldownReason = '';
    
    // Check stop cooldown (using updated_at as proxy for last stop since we don't have last_stop_at column)
    // If session is idle and was recently updated, treat as cooldown
    if (sessionStatus === 'idle' || sessionStatus === 'stopped') {
      cooldownActive = true;
      cooldownReason = 'session_inactive';
    }
    
    // Check if session is not running
    if (!isRunning) {
      cooldownActive = true;
      cooldownReason = cooldownReason || 'is_running_false';
    }

    // EARLY EXIT: If session inactive or cooldown active, skip ALL processing
    if (cooldownActive) {
      console.log(`[TICK_SKIPPED] Session inactive or cooldown active. Reason: ${cooldownReason}, status=${sessionStatus}, isRunning=${isRunning}`);
      
      // Still return current stats for UI display, but don't process anything
      const { data: displayPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('closed', false);
      const { data: displayTrades } = await supabase.from('paper_trades').select('*').eq('user_id', userId).eq('session_date', today);
      const displayEquity = await loadEquity(supabase, userId);
      const displayRealizedPnl = (displayTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
      const displayUnrealizedPnl = (displayPositions || []).reduce((sum: number, p: any) => sum + Number(p.unrealized_pnl || 0), 0);
      const displayTodayPnl = displayRealizedPnl + displayUnrealizedPnl;
      
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: cooldownReason,
        sessionStatus,
        stats: {
          todayPnl: displayTodayPnl,
          tradesToday: (displayTrades || []).length,
          openPositionsCount: (displayPositions || []).length,
          ...equityFields(displayEquity),
          winRate: 50,
        },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const risk: RiskConfig = normalizeRiskConfig(riskConfig);
    const equityAtStart = await loadEquity(supabase, userId);
    // Percent bases: day-start equity = balance minus today's realized (derived, never hardcoded)
    let startingEquity = 0;

    const { data: positions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('closed', false);
    
    // ================================================================
    // SESSION-FILTERED TRADES: Only count trades from current session
    // This ensures thermostat resets properly on restart
    // ================================================================
    let sessionTrades: any[] = [];
    if (sessionStartedAt) {
      // Filter trades to only those opened AFTER session_started_at
      const { data: filteredTrades } = await supabase
        .from('paper_trades')
        .select('*')
        .eq('user_id', userId)
        .gte('opened_at', sessionStartedAt);
      sessionTrades = filteredTrades || [];
    } else {
      // Fallback: use today's trades if no session boundary
      const { data: todayTradesData } = await supabase
        .from('paper_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('session_date', today);
      sessionTrades = todayTradesData || [];
    }
    
    // Also get all of today's trades for P&L display (different from thermostat input)
    const { data: todayTrades } = await supabase.from('paper_trades').select('*').eq('user_id', userId).eq('session_date', today);

    const realizedPnl = (todayTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
    const unrealizedPnl = (positions || []).reduce((sum: number, p: any) => sum + Number(p.unrealized_pnl || 0), 0);
    if (equityAtStart.ok) startingEquity = equityAtStart.balance - realizedPnl;
    const currentPnl = realizedPnl + unrealizedPnl;
    const currentPnlPercent = startingEquity > 0 ? (currentPnl / startingEquity) * 100 : 0;
    const closedCount = (todayTrades || []).length;
    const wins = (todayTrades || []).filter((t: any) => Number(t.realized_pnl) > 0).length;
    const winRate = closedCount > 0 ? (wins / closedCount) * 100 : 50;

    // Daily halt logic REMOVED - engine runs indefinitely

    // Handle take burst profit
    if (takeBurstProfit) {
      const { data: claimedBurst } = await supabase.from('paper_positions').delete().eq('user_id', userId).eq('mode', 'burst').select('*');
      const burstCount = (claimedBurst || []).length;
      
      if (burstCount > 0) {
        const tradeRecords = (claimedBurst || []).map((pos: any) =>
          buildCloseRecord(pos, ticks[pos.symbol], 'take_burst_profit', costModel, userId, today).record
        );
        
        await Promise.all([
          supabase.from('paper_trades').insert(tradeRecords),
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
      const exitMark = executionPrice(pos.side, 'exit', tick, costModel);
      const unrealizedPnl = netClosePnl(pos.side, Number(pos.entry_price), exitMark, Number(pos.size), costModel).net;
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
    
    const shouldRunModes = freshSessionStatus === 'running' && freshIsRunning;
    let engineDiagnostics: Record<string, unknown> | null = null;
    
    console.log(`[ENGINE] status=${freshSessionStatus}, running=${freshIsRunning}, shouldRunModes=${shouldRunModes}, positions=${(finalPositions || []).length}`);
    
    if (shouldRunModes) {
      // ================================================================
      // NORMALIZE + VALIDATE SYMBOLS (BTCUSDT → BTCUSD, etc.)
      // ================================================================
      let symbolsToTrade = normalizeSymbolList(marketConfig.selectedSymbols || []);
      if (symbolsToTrade.length === 0) {
        symbolsToTrade = DEFAULT_MARKET_CONFIG.selectedSymbols;
      }

      // Normalize tick keys for matching
      const tickKeys = Object.keys(ticks || {}).map(normalizeSymbol);
      const tickKeySet = new Set(tickKeys);

      // Find valid symbols from config
      let validSymbols = symbolsToTrade.filter((s: string) => {
        const norm = normalizeSymbol(s);
        // Check both original key and normalized key in ticks
        const tick = ticks?.[s] || ticks?.[norm];
        return tick !== undefined && tick !== null && typeof tick === 'object' && tick.mid > 0;
      });

      // Auto-fallback if config symbols don't match ticks
      if (validSymbols.length === 0) {
        const fallback = DEFAULT_MARKET_CONFIG.selectedSymbols.filter(s => tickKeySet.has(s));
        if (fallback.length > 0) {
          console.log(`[ENGINE] SYMBOL_FALLBACK - using defaults: ${fallback.join(', ')}`);
          validSymbols = fallback;
        }
      }

      // Self-heal DB if legacy symbols detected (one-time per account)
      const hadLegacy = (marketConfig.selectedSymbols || []).some((s: string) => /USDT$/i.test(s));
      if (hadLegacy) {
        const repaired = normalizeSymbolList(marketConfig.selectedSymbols || []);
        await supabase
          .from('paper_config')
          .update({ market_config: { ...marketConfig, selectedSymbols: repaired } })
          .eq('user_id', userId);
        console.log(JSON.stringify({ tag: 'SYMBOL_REPAIR', user_id: userId, from: marketConfig.selectedSymbols, to: repaired }));
      }

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

      // Use validSymbols for trading
      const symbolsWithData = validSymbols;
      
      // Determine selected mode
      const normModes = normalizeEnabledModes(modeConfig.enabledModes);
      if (normModes.unknown.length > 0) {
        console.warn(JSON.stringify({ tag: 'UNKNOWN_MODE', user_id: userId, ignored: normModes.unknown }));
      }
      let enabledModes = normModes.modes as TradingModeKey[];
      if (enabledModes.length === 0) {
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
      
      console.log(`[ENGINE] Running Master Logic v1.5 with mode=${selectedMode}, symbols=${symbolsWithData.length} (of ${symbolsToTrade.length} configured), sessionTrades=${sessionTrades.length}`);
      
      // Run Master Logic v1.5 with SESSION-FILTERED TRADES for thermostat
      // This ensures restart = fresh thermostat state
      const liveEquity = equityAtStart.ok ? equityAtStart.balance - realizedPnl + finalTodayPnl : 0;
      const gov = governor({
        equity: liveEquity,
        dayStartEquity: startingEquity,
        openRiskAmount: (finalPositions || []).reduce((s: number, p: any) => s + positionRisk(p), 0),
        openCount: (finalPositions || []).length,
        risk,
      });
      if (!equityAtStart.ok) gov.reasons.unshift(`EQUITY_UNAVAILABLE:${equityAtStart.reason}`);
      const allowEntries = equityAtStart.ok && gov.allowEntries;
      console.log(JSON.stringify({
        tag: 'ENGINE_CONTRACT', user_id: userId, mode: selectedMode, equity: equityAtStart.ok ? liveEquity : null,
        risk: { perTradeRiskPct: risk.perTradeRiskPct, maxDailyDrawdownPct: risk.maxDailyDrawdownPct, maxOpenTrades: risk.maxOpenTrades, maxConcurrentRiskPct: risk.maxConcurrentRiskPct, feeBps: risk.feeBps, sources: risk.sources },
        governor: { allowEntries, sizeMultiplier: gov.sizeMultiplier, reasons: gov.reasons, dayDrawdownPct: gov.dayDrawdownPct, openRiskPct: gov.openRiskPct },
      }));
      engineDiagnostics = { mode: selectedMode, allowEntries, governorReasons: gov.reasons, sizeMultiplier: gov.sizeMultiplier, dayDrawdownPct: gov.dayDrawdownPct, openRiskPct: gov.openRiskPct, risk };

      const result = runMasterLogicV15({
        selectedMode,
        symbols: symbolsWithData,
        ticks,
        equity: liveEquity,
        baseRiskPercent: risk.perTradeRiskPct,
        maxOpenTrades: risk.maxOpenTrades,
        maxPerSymbolExposurePct: risk.maxPerSymbolExposurePct,
        costModel: risk.costModel,
        burstSize: Number(burstConfig?.size) || DEFAULT_BURST_CONFIG.size,
        allowEntries,
        governorSizeMultiplier: gov.sizeMultiplier,
        openPositions: (finalPositions || []) as Position[],
        recentTrades: sessionTrades, // SESSION-FILTERED, not all today's trades
        todayPnlPercent: finalTodayPnlPercent,
      });
      
      console.log(`[MASTER_LOGIC] Diagnostics: evaluated=${result.diagnostics.symbolsEvaluated}, candidates=${result.diagnostics.candidatesFound}, passed=${result.diagnostics.passedFilters}`);
      console.log(`[MASTER_LOGIC] Thermostat: regime=${result.thermostat.regimeTag}, aggression=${result.thermostat.aggressionLevel.toFixed(2)}, winRate=${result.thermostat.recentWinRate.toFixed(0)}%`);
      
      if (engineDiagnostics) engineDiagnostics.noEvidence = result.diagnostics.noEvidence ?? 0;
      // Persist trailing-stop ratchets (stored SL only ever tightens)
      for (const u of result.slUpdates || []) {
        await supabase.from('paper_positions').update({ sl: u.sl }).eq('id', u.id).eq('user_id', userId);
      }

      // Process position closures from Master Logic
      for (const closeOrder of result.positionsToClose) {
        // Claim/delete first so concurrent ticks cannot double-book the same close
        const { data: claimed } = await supabase.from('paper_positions').delete().eq('id', closeOrder.id).eq('user_id', userId).select('*').maybeSingle();
        const pos = claimed;
        if (!pos) continue;
        
        const { record, pnl } = buildCloseRecord(pos, ticks[pos.symbol], closeOrder.reason, risk.costModel, userId, today);
        
        await supabase.from('paper_trades').insert(record);
        
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
    
    const veryFinalEquity = await loadEquity(supabase, userId);

    return new Response(JSON.stringify({ 
      success: true, 
      sessionStatus: freshSessionStatus,
      halted: false,
      stats: {
        todayPnl: finalTodayPnl,
        todayPnlPercent: finalTodayPnlPercent,
        tradesToday: finalClosedCount,
        openPositionsCount: (veryFinalPositions || []).length,
        ...equityFields(veryFinalEquity),
        winRate: finalWinRate,
      },
      diagnostics: engineDiagnostics,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    // ================================================================
    // UNCAUGHT EXCEPTION HANDLER - Never return 500
    // ================================================================
    console.error('[PAPER_TICK] UNCAUGHT_EXCEPTION:', error);
    return new Response(JSON.stringify({ 
      ok: false,
      error: 'Internal server error',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
