// Trading Engine - Main orchestration logic with full brain modules

import type {
  EngineContext,
  EngineState,
  Position,
  ClosedTrade,
  PriceTick,
  ProposedOrder,
  SystemLog,
  PaperConfig
} from './types';

import { applyRiskGuardrails, shouldLockBurst } from './risk';
import { markToMarket, checkExits, closePositions, calculateStats } from './pnl';

// Brain modules
import { classifyEnvironment, recordTick, type EnvironmentSummary } from './environment';
import { calculateEdge, type EdgeSignal } from './edge';
import { evaluateEntry, getModePersonality, type ModePersonality } from './entry';
import { calculatePositionSize, createRiskProfile } from './sizing';
import { managePositions, identifyRotationCandidates } from './management';
import { routeMarkets, shouldConsiderForEntry } from './router';
import { analyzeSession, isModeRecommendedForSession } from './session-brain';
import { updateThermostat, shouldThermostatAllowTrading, getInitialThermostatState, type ThermostatState } from './thermostat';
import { selectTradingMode, getModeForTrade, type UserModeSelection } from './adaptive';
import { buildOrderRequest, executeOrder, type OrderParams, type ExecutionResult } from './execution';

interface RunTickInput {
  userId: string;
  config: PaperConfig;
  latestTicks: Record<string, PriceTick>;
  positions: Position[];
  recentTrades: ClosedTrade[];
  startingEquity: number;
}

// Engine V1.5 types
export interface ModeProfile {
  name: string;
  qualityThreshold?: number;
  positionSize?: number;
}

export interface EngineV15Context {
  ticks: Record<string, any> | null | undefined;
  symbols: string[];
  modeProfile: ModeProfile;
  quality?: Record<string, number>;
}

export interface EngineV15Result {
  ok: boolean;
  reason?: string;
  fill?: ExecutionResult['fill'];
}

// Persistent state
let thermostatState: ThermostatState = getInitialThermostatState();
let lastAdaptiveMode: ModePersonality | null = null;

// Warm-start flag - first cycle MUST fire
let warmStart = true;

export function resetWarmStart(): void {
  warmStart = true;
}

/**
 * Engine V1.5 - Warm-start + fire guarantee layer
 */
export async function runEngineV15(ctx: EngineV15Context): Promise<EngineV15Result> {
  const { ticks, symbols, modeProfile } = ctx;

  // Guard: no ticks at all
  if (!ticks || typeof ticks !== 'object' || Object.keys(ticks).length === 0) {
    return { ok: false, reason: "NO_TICKS" };
  }

  // Filter to only symbols with valid tick data
  const validSymbols = symbols.filter(s => ticks[s] !== undefined && ticks[s] !== null);
  if (validSymbols.length === 0) {
    return { ok: false, reason: "NO_VALID_SYMBOLS" };
  }

  // Warm-start booster: first run must produce a trade attempt
  const forceFire = warmStart === true;
  warmStart = false;

  // Quality scoring
  const scored = validSymbols
    .map(s => ({
      symbol: s,
      score: ctx.quality?.[s] ?? 0,
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    return { ok: false, reason: "NO_SCORABLE_SYMBOL" };
  }

  const qualityThreshold = modeProfile.qualityThreshold ?? 0.1;
  const shouldFire = forceFire || best.score >= qualityThreshold;

  if (!shouldFire) {
    return { ok: false, reason: "QUALITY_TOO_LOW" };
  }

  // Build the order request with guarded params
  const orderRequest = buildOrderRequest({
    symbol: best.symbol,
    side: Math.random() > 0.5 ? "BUY" : "SELL",
    size: modeProfile.positionSize ?? 0.001,
    mode: modeProfile.name,
  });

  if (!orderRequest.ok) {
    return { ok: false, reason: orderRequest.reason };
  }

  // Execute order
  const result = await executeOrder(orderRequest);
  return result;
}

/**
 * Main trading engine tick function with full brain integration
 */
export function runTradingTick(input: RunTickInput): EngineState {
  const { userId, config, latestTicks, positions: inputPositions, recentTrades, startingEquity } = input;
  const logs: SystemLog[] = [];
  const now = new Date().toISOString();
  
  // Step 1: Record ticks and classify environments
  const environments: Record<string, EnvironmentSummary> = {};
  const edges: Record<string, EdgeSignal> = {};
  
  for (const symbol of config.marketConfig.selectedSymbols) {
    const tick = latestTicks[symbol];
    if (!tick) continue;
    
    recordTick(symbol, tick);
    environments[symbol] = classifyEnvironment(symbol, tick);
    edges[symbol] = calculateEdge(symbol, tick, environments[symbol], latestTicks);
  }
  
  // Log environment summaries (only log first 3 symbols to avoid spam)
  const symbolsToLog = Object.keys(environments).slice(0, 3);
  for (const symbol of symbolsToLog) {
    const env = environments[symbol];
    const edge = edges[symbol];
    logs.push({
      level: 'info',
      source: 'environment',
      message: `[${symbol}] ${env.marketState}/${env.volState} conf=${(env.environmentConfidence * 100).toFixed(0)}% | Edge: ${edge.edgeDirection} score=${edge.edgeScore.toFixed(0)} conf=${(edge.edgeConfidence * 100).toFixed(0)}%`,
      meta: { symbol, env, edge },
      createdAt: now
    });
  }
  
  // Step 2: Update thermostat based on recent performance
  thermostatState = updateThermostat(recentTrades, environments);
  
  logs.push({
    level: 'info',
    source: 'thermostat',
    message: `Thermostat: ${thermostatState.aggressionLevel} | ${thermostatState.streakType} streak (${thermostatState.streakLength}) | WR=${thermostatState.recentWinRate.toFixed(0)}% | ${thermostatState.adjustmentReason}`,
    meta: { thermostatState },
    createdAt: now
  });
  
  // Step 3: Analyze session
  const sessionAnalysis = analyzeSession();
  
  logs.push({
    level: 'info',
    source: 'session',
    message: `Session: ${sessionAnalysis.session.name} (${sessionAnalysis.session.phase}) | vol=${sessionAnalysis.session.volatilityExpected} | quality=${(sessionAnalysis.session.quality * 100).toFixed(0)}%`,
    meta: { sessionAnalysis },
    createdAt: now
  });
  
  // Step 4: Route markets and rank by tradeability
  const routerResult = routeMarkets(
    config.marketConfig.selectedSymbols,
    latestTicks,
    environments,
    edges,
    5 // Max primary candidates
  );
  
  if (routerResult.primaryCandidates.length > 0) {
    logs.push({
      level: 'info',
      source: 'router',
      message: `Primary markets: ${routerResult.primaryCandidates.join(', ')} | Top score: ${routerResult.rankings[0]?.score || 0}`,
      meta: { primaryCandidates: routerResult.primaryCandidates, topRankings: routerResult.rankings.slice(0, 3) },
      createdAt: now
    });
  }
  
  // Step 5: Mark positions to market
  let positions = markToMarket(inputPositions, latestTicks);
  
  // Step 6: Calculate current stats
  const todayTrades = recentTrades.filter(t => 
    t.sessionDate === new Date().toISOString().split('T')[0]
  );
  let stats = calculateStats(positions, todayTrades, startingEquity);
  
  // Step 7: Trade Management - evaluate open positions
  const managementResult = managePositions(positions, latestTicks, environments, edges);
  logs.push(...managementResult.logs);
  
  // Apply management decisions: close positions
  const positionsToCloseIds = new Set(managementResult.positionsToClose.map(p => p.id));
  const closedByManagement: ClosedTrade[] = [];
  
  for (const pos of managementResult.positionsToClose) {
    const tick = latestTicks[pos.symbol];
    if (!tick) continue;
    
    const exitPrice = pos.side === 'long' ? tick.bid : tick.ask;
    const priceDiff = pos.side === 'long' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
    
    closedByManagement.push({
      id: pos.id,
      userId: pos.userId,
      symbol: pos.symbol,
      mode: pos.mode,
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      exitPrice,
      sl: pos.sl,
      tp: pos.tp,
      openedAt: pos.openedAt,
      closedAt: now,
      realizedPnl: priceDiff * pos.size,
      reason: 'management_close',
      sessionDate: new Date().toISOString().split('T')[0],
      batchId: pos.batchId
    });
  }
  
  // Apply stop updates
  for (const update of managementResult.updatedStops) {
    const posIndex = positions.findIndex(p => p.id === update.position.id);
    if (posIndex >= 0) {
      positions[posIndex] = { ...positions[posIndex], sl: update.newSl };
    }
  }
  
  // Remove closed positions
  positions = positions.filter(p => !positionsToCloseIds.has(p.id));
  
  // Step 8: Check SL/TP exits
  const { remainingPositions, closedTrades: exitedTrades, logs: exitLogs } = checkExits(positions, latestTicks);
  positions = remainingPositions;
  const allTodayTrades = [...todayTrades, ...closedByManagement, ...exitedTrades];
  logs.push(...exitLogs);
  
  // Step 9: Check if thermostat allows trading
  if (!shouldThermostatAllowTrading(thermostatState)) {
    logs.push({
      level: 'warning',
      source: 'thermostat',
      message: `Trading paused: ${thermostatState.adjustmentReason}`,
      createdAt: now
    });
    
    return {
      positions,
      trades: allTodayTrades,
      stats: calculateStats(positions, allTodayTrades, startingEquity),
      logs,
      halted: false
    };
  }
  
  // Step 10: Determine active mode (adaptive or fixed)
  const userModeSelection: UserModeSelection = config.modeConfig.enabledModes.includes('hybrid') 
    ? 'adaptive' 
    : (config.modeConfig.enabledModes[0] as UserModeSelection) || 'scalper';
  
  const adaptiveDecision = selectTradingMode(
    userModeSelection,
    environments,
    sessionAnalysis.session,
    thermostatState,
    allTodayTrades,
    routerResult.rankings
  );
  
  if (adaptiveDecision.isAdaptive && adaptiveDecision.selectedMode !== lastAdaptiveMode) {
    logs.push({
      level: 'info',
      source: 'adaptive',
      message: `Mode: ${adaptiveDecision.selectedMode} (${adaptiveDecision.adaptiveReason})`,
      createdAt: now
    });
    lastAdaptiveMode = adaptiveDecision.selectedMode;
  }
  
  // Step 11: Generate entries using EntryEngine
  const allProposedOrders: ProposedOrder[] = [];
  stats = calculateStats(positions, allTodayTrades, startingEquity);
  
  const riskProfile = createRiskProfile(
    config.riskConfig.maxConcurrentRiskPercent / 10, // Base risk per trade
    config.riskConfig.maxDailyLossPercent
  );
  
  // Only consider primary candidates from router
  for (const symbol of routerResult.primaryCandidates) {
    const tick = latestTicks[symbol];
    const env = environments[symbol];
    const edge = edges[symbol];
    
    if (!tick || !env || !edge) continue;
    
    // Get mode for this specific trade
    const tradeMode = getModeForTrade(
      symbol,
      env,
      sessionAnalysis.session,
      userModeSelection,
      adaptiveDecision.weights
    );
    
    // Check burst lock
    if (tradeMode === 'burst' && shouldLockBurst(stats.burstPnlToday, config.burstConfig.dailyProfitTargetPercent)) {
      continue;
    }
    
    // Evaluate entry
    const entryDecision = evaluateEntry(
      symbol,
      tick,
      edge,
      env,
      tradeMode,
      thermostatState,
      positions,
      allTodayTrades,
      config.riskConfig.maxOpenTrades || 10
    );
    
    if (!entryDecision.shouldEnter || !entryDecision.entryDirection) continue;
    
    // Calculate position size
    const sizing = calculatePositionSize(
      symbol,
      tick,
      entryDecision.entryDirection,
      edge,
      env,
      thermostatState,
      tradeMode,
      stats.equity,
      positions,
      riskProfile
    );
    
    if (sizing.positionSize <= 0) continue;
    
    // Map mode personality to trading mode
    const tradingMode = tradeMode === 'burst' ? 'burst' : tradeMode === 'trend' ? 'trend' : 'swing';
    
    allProposedOrders.push({
      symbol,
      side: entryDecision.entryDirection,
      size: sizing.positionSize,
      entryPrice: tick.mid,
      sl: sizing.stopLoss,
      tp: sizing.takeProfit,
      mode: tradingMode,
      reason: entryDecision.reason,
      confidence: entryDecision.confidence
    });
  }
  
  // Step 12: Apply risk guardrails
  const { orders: allowedOrders, logs: riskLogs } = applyRiskGuardrails(
    allProposedOrders,
    positions,
    stats,
    config.riskConfig,
    stats.equity
  );
  logs.push(...riskLogs);
  
  // Step 13: Open new positions
  const newPositions: Position[] = allowedOrders.map(order => ({
    id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userId,
    symbol: order.symbol,
    mode: order.mode,
    side: order.side,
    size: order.size,
    entryPrice: order.entryPrice,
    sl: order.sl,
    tp: order.tp,
    openedAt: now,
    unrealizedPnl: 0,
    batchId: order.batchId
  }));
  
  if (newPositions.length > 0) {
    const symbols = [...new Set(newPositions.map(p => p.symbol))];
    logs.push({
      level: 'info',
      source: 'entry',
      message: `Opened ${newPositions.length} position(s) on ${symbols.join(', ')}`,
      meta: { count: newPositions.length, symbols, mode: adaptiveDecision.selectedMode },
      createdAt: now
    });
  }
  
  // Step 14: Combine and return
  const finalPositions = [...positions, ...newPositions];
  const finalStats = calculateStats(finalPositions, allTodayTrades, startingEquity);
  
  return {
    positions: finalPositions,
    trades: allTodayTrades,
    stats: finalStats,
    logs,
    halted: false
  };
}

/**
 * Close all positions for a user (global close)
 */
export function globalClose(
  positions: Position[],
  ticks: Record<string, PriceTick>,
  recentTrades: ClosedTrade[],
  startingEquity: number
): EngineState {
  const { closedTrades, logs } = closePositions(positions, ticks, 'global_close');
  const allTrades = [...recentTrades, ...closedTrades];
  const stats = calculateStats([], allTrades, startingEquity);
  
  return {
    positions: [],
    trades: allTrades,
    stats,
    logs,
    halted: false
  };
}

/**
 * Close burst positions only (take burst profit)
 */
export function takeBurstProfit(
  positions: Position[],
  ticks: Record<string, PriceTick>,
  recentTrades: ClosedTrade[],
  startingEquity: number
): EngineState {
  const burstPositions = positions.filter(p => p.mode === 'burst');
  const otherPositions = positions.filter(p => p.mode !== 'burst');
  
  const { closedTrades, logs } = closePositions(burstPositions, ticks, 'take_burst_profit');
  const allTrades = [...recentTrades, ...closedTrades];
  const stats = calculateStats(otherPositions, allTrades, startingEquity);
  
  return {
    positions: otherPositions,
    trades: allTrades,
    stats,
    logs,
    halted: false
  };
}

// Re-export brain modules for external use
export { classifyEnvironment, type EnvironmentSummary } from './environment';
export { calculateEdge, type EdgeSignal } from './edge';
export { updateThermostat, type ThermostatState } from './thermostat';
export { analyzeSession } from './session-brain';
export { routeMarkets } from './router';
export { buildOrderRequest, executeOrder } from './execution';
