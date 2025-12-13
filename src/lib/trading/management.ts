// ============= Trade Management Engine =============
// Manages open positions: early exits, profit-taking, rotation

import type { Position, ClosedTrade, PriceTick, SystemLog } from './types';
import type { EnvironmentSummary } from './environment';
import type { EdgeSignal } from './edge';
import { getModePersonality, type ModePersonality } from './entry';

export interface ManagementDecision {
  action: 'hold' | 'close' | 'partial_close' | 'trail_stop';
  reason: string;
  newSl?: number;
  closePercent?: number; // For partial close
  priority: number; // Higher = more urgent
}

export interface PositionAnalysis {
  position: Position;
  decision: ManagementDecision;
  currentPnlPercent: number;
  timeInTrade: number; // minutes
  momentum: 'with' | 'against' | 'neutral';
}

export interface TradeManagementResult {
  positionsToClose: Position[];
  positionsToPartialClose: { position: Position; percent: number }[];
  updatedStops: { position: Position; newSl: number }[];
  logs: SystemLog[];
}

function calculatePnlPercent(pos: Position, tick: PriceTick): number {
  const currentPrice = pos.side === 'long' ? tick.bid : tick.ask;
  const priceDiff = pos.side === 'long' 
    ? currentPrice - pos.entryPrice 
    : pos.entryPrice - currentPrice;
  
  return (priceDiff / pos.entryPrice) * 100;
}

function calculateTimeInTrade(pos: Position): number {
  const opened = new Date(pos.openedAt).getTime();
  const now = Date.now();
  return (now - opened) / (1000 * 60); // minutes
}

function assessMomentum(
  pos: Position,
  tick: PriceTick,
  edge: EdgeSignal
): 'with' | 'against' | 'neutral' {
  // Compare edge direction with position direction
  if (edge.edgeDirection === 'neutral') return 'neutral';
  
  if (edge.edgeDirection === pos.side) {
    return edge.edgeScore >= 50 ? 'with' : 'neutral';
  } else {
    return edge.edgeScore >= 50 ? 'against' : 'neutral';
  }
}

function evaluateLosingTrade(
  pos: Position,
  tick: PriceTick,
  env: EnvironmentSummary,
  edge: EdgeSignal,
  pnlPct: number,
  mode: ModePersonality
): ManagementDecision {
  const momentum = assessMomentum(pos, tick, edge);
  
  // Structure clearly broken and edge collapsed - cut early
  if (edge.edgeDirection !== 'neutral' && 
      edge.edgeDirection !== pos.side && 
      edge.edgeConfidence > 0.6) {
    return {
      action: 'close',
      reason: 'Structure broken against position, edge collapsed',
      priority: 9
    };
  }
  
  // Environment degraded to chaos/trap - exit
  if (env.marketState === 'chaos' || env.marketState === 'range_trap') {
    if (pnlPct < -0.3) {
      return {
        action: 'close',
        reason: `Environment degraded to ${env.marketState}`,
        priority: 8
      };
    }
  }
  
  // Liquidity broken - must exit
  if (env.liquidityState === 'broken') {
    return {
      action: 'close',
      reason: 'Liquidity broken - emergency exit',
      priority: 10
    };
  }
  
  // Momentum strongly against and losing
  if (momentum === 'against' && pnlPct < -0.5) {
    return {
      action: 'close',
      reason: 'Strong momentum against position',
      priority: 7
    };
  }
  
  // Default: let SL manage
  return {
    action: 'hold',
    reason: 'Within acceptable loss range, SL will manage',
    priority: 0
  };
}

function evaluateWinningTrade(
  pos: Position,
  tick: PriceTick,
  env: EnvironmentSummary,
  edge: EdgeSignal,
  pnlPct: number,
  timeInTrade: number,
  mode: ModePersonality
): ManagementDecision {
  const momentum = assessMomentum(pos, tick, edge);
  const atr = env.atr > 0 ? env.atr : pos.entryPrice * 0.01;
  
  // Mode-specific profit taking thresholds
  const profitThresholds: Record<ModePersonality, { quick: number; target: number; runner: number }> = {
    burst: { quick: 0.3, target: 0.6, runner: 1.0 },
    scalper: { quick: 0.5, target: 1.0, runner: 1.5 },
    trend: { quick: 1.0, target: 2.0, runner: 4.0 }
  };
  
  const thresholds = profitThresholds[mode];
  
  // Burst mode: quick profits, don't let winners reverse
  if (mode === 'burst') {
    if (pnlPct >= thresholds.target || (momentum !== 'with' && pnlPct >= thresholds.quick)) {
      return {
        action: 'close',
        reason: 'Burst target reached or momentum slowing',
        priority: 6
      };
    }
    
    // Trail stop if in profit
    if (pnlPct >= thresholds.quick) {
      const trailDistance = atr * 0.3;
      const newSl = pos.side === 'long' 
        ? tick.bid - trailDistance 
        : tick.ask + trailDistance;
      
      // Only move SL in favorable direction
      const shouldTrail = pos.side === 'long' 
        ? (!pos.sl || newSl > pos.sl)
        : (!pos.sl || newSl < pos.sl);
      
      if (shouldTrail) {
        return {
          action: 'trail_stop',
          reason: 'Trailing stop for burst profit',
          newSl,
          priority: 4
        };
      }
    }
  }
  
  // Scalper mode: moderate holds
  if (mode === 'scalper') {
    // Take profit if momentum stalling
    if (momentum !== 'with' && pnlPct >= thresholds.quick) {
      if (pnlPct >= thresholds.target) {
        return {
          action: 'close',
          reason: 'Target reached, momentum neutral',
          priority: 5
        };
      } else {
        return {
          action: 'partial_close',
          reason: 'Partial profit - momentum slowing',
          closePercent: 50,
          priority: 4
        };
      }
    }
    
    // Trail stop
    if (pnlPct >= thresholds.quick) {
      const trailDistance = atr * 0.5;
      const newSl = pos.side === 'long' 
        ? tick.bid - trailDistance 
        : tick.ask + trailDistance;
      
      const shouldTrail = pos.side === 'long' 
        ? (!pos.sl || newSl > pos.sl)
        : (!pos.sl || newSl < pos.sl);
      
      if (shouldTrail) {
        return {
          action: 'trail_stop',
          reason: 'Trailing stop for scalp',
          newSl,
          priority: 3
        };
      }
    }
  }
  
  // Trend mode: let winners run
  if (mode === 'trend') {
    // Only exit if clear reversal signal
    if (momentum === 'against' && edge.edgeScore >= 60) {
      if (pnlPct >= thresholds.target) {
        return {
          action: 'close',
          reason: 'Trend reversal signal, banking profits',
          priority: 5
        };
      } else {
        return {
          action: 'partial_close',
          reason: 'Reversal signal - protect partial profit',
          closePercent: 50,
          priority: 4
        };
      }
    }
    
    // Wide trailing stop
    if (pnlPct >= thresholds.quick) {
      const trailDistance = atr * 1.0;
      const newSl = pos.side === 'long' 
        ? tick.bid - trailDistance 
        : tick.ask + trailDistance;
      
      const shouldTrail = pos.side === 'long' 
        ? (!pos.sl || newSl > pos.sl)
        : (!pos.sl || newSl < pos.sl);
      
      if (shouldTrail) {
        return {
          action: 'trail_stop',
          reason: 'Wide trailing stop for trend',
          newSl,
          priority: 2
        };
      }
    }
  }
  
  return {
    action: 'hold',
    reason: 'Position performing well, maintaining',
    priority: 0
  };
}

function evaluateStagnantTrade(
  pos: Position,
  tick: PriceTick,
  env: EnvironmentSummary,
  edge: EdgeSignal,
  pnlPct: number,
  timeInTrade: number,
  mode: ModePersonality
): ManagementDecision {
  // Stagnation thresholds by mode (minutes)
  const stagnationTime: Record<ModePersonality, number> = {
    burst: 15,
    scalper: 30,
    trend: 120
  };
  
  const isStagnant = timeInTrade > stagnationTime[mode] && Math.abs(pnlPct) < 0.2;
  
  if (!isStagnant) {
    return { action: 'hold', reason: 'Trade not stagnant', priority: 0 };
  }
  
  // Edge score dropped significantly
  if (edge.edgeScore < 40) {
    return {
      action: 'close',
      reason: 'Stagnant trade with degraded edge',
      priority: 5
    };
  }
  
  // Environment no longer favorable
  if (env.environmentConfidence < 0.4) {
    return {
      action: 'close',
      reason: 'Stagnant trade, poor environment',
      priority: 4
    };
  }
  
  return {
    action: 'hold',
    reason: 'Stagnant but edge intact',
    priority: 0
  };
}

/**
 * Analyze a single position and decide management action
 */
export function analyzePosition(
  pos: Position,
  tick: PriceTick,
  env: EnvironmentSummary,
  edge: EdgeSignal
): PositionAnalysis {
  const pnlPct = calculatePnlPercent(pos, tick);
  const timeInTrade = calculateTimeInTrade(pos);
  const momentum = assessMomentum(pos, tick, edge);
  const mode = getModePersonality(pos.mode);
  
  let decision: ManagementDecision;
  
  if (pnlPct < 0) {
    decision = evaluateLosingTrade(pos, tick, env, edge, pnlPct, mode);
  } else if (pnlPct > 0.1) {
    decision = evaluateWinningTrade(pos, tick, env, edge, pnlPct, timeInTrade, mode);
  } else {
    decision = evaluateStagnantTrade(pos, tick, env, edge, pnlPct, timeInTrade, mode);
  }
  
  return {
    position: pos,
    decision,
    currentPnlPercent: pnlPct,
    timeInTrade,
    momentum
  };
}

/**
 * Manage all positions and return actions to take
 */
export function managePositions(
  positions: Position[],
  ticks: Record<string, PriceTick>,
  environments: Record<string, EnvironmentSummary>,
  edges: Record<string, EdgeSignal>
): TradeManagementResult {
  const analyses: PositionAnalysis[] = [];
  const logs: SystemLog[] = [];
  const now = new Date().toISOString();
  
  // Analyze each position
  for (const pos of positions) {
    const tick = ticks[pos.symbol];
    if (!tick) continue;
    
    const env = environments[pos.symbol];
    const edge = edges[pos.symbol];
    
    if (!env || !edge) continue;
    
    const analysis = analyzePosition(pos, tick, env, edge);
    analyses.push(analysis);
  }
  
  // Sort by priority (highest first)
  analyses.sort((a, b) => b.decision.priority - a.decision.priority);
  
  const positionsToClose: Position[] = [];
  const positionsToPartialClose: { position: Position; percent: number }[] = [];
  const updatedStops: { position: Position; newSl: number }[] = [];
  
  for (const analysis of analyses) {
    const { position, decision } = analysis;
    
    switch (decision.action) {
      case 'close':
        positionsToClose.push(position);
        logs.push({
          level: 'info',
          source: 'management',
          message: `Closing ${position.symbol} ${position.side}: ${decision.reason}`,
          meta: { posId: position.id, pnlPct: analysis.currentPnlPercent },
          createdAt: now
        });
        break;
        
      case 'partial_close':
        if (decision.closePercent) {
          positionsToPartialClose.push({ 
            position, 
            percent: decision.closePercent 
          });
          logs.push({
            level: 'info',
            source: 'management',
            message: `Partial close ${decision.closePercent}% of ${position.symbol}: ${decision.reason}`,
            meta: { posId: position.id },
            createdAt: now
          });
        }
        break;
        
      case 'trail_stop':
        if (decision.newSl !== undefined) {
          updatedStops.push({ position, newSl: decision.newSl });
          logs.push({
            level: 'info',
            source: 'management',
            message: `Trailing stop on ${position.symbol}: ${decision.reason}`,
            meta: { posId: position.id, newSl: decision.newSl },
            createdAt: now
          });
        }
        break;
    }
  }
  
  return {
    positionsToClose,
    positionsToPartialClose,
    updatedStops,
    logs
  };
}

/**
 * Identify rotation candidates - stagnant positions that could be replaced
 */
export function identifyRotationCandidates(
  positions: Position[],
  ticks: Record<string, PriceTick>,
  environments: Record<string, EnvironmentSummary>,
  edges: Record<string, EdgeSignal>
): Position[] {
  const candidates: Position[] = [];
  
  for (const pos of positions) {
    const tick = ticks[pos.symbol];
    const env = environments[pos.symbol];
    const edge = edges[pos.symbol];
    
    if (!tick || !env || !edge) continue;
    
    const pnlPct = calculatePnlPercent(pos, tick);
    const timeInTrade = calculateTimeInTrade(pos);
    
    // Stagnant with low edge = rotation candidate
    const isStagnant = timeInTrade > 30 && Math.abs(pnlPct) < 0.3;
    const lowEdge = edge.edgeScore < 45;
    
    if (isStagnant && lowEdge) {
      candidates.push(pos);
    }
  }
  
  return candidates;
}
