// P&L Calculations and Position Management

import type { 
  Position, 
  ClosedTrade, 
  PriceTick, 
  PaperSessionStats,
  SystemLog 
} from './types';

/**
 * Mark positions to market with current prices
 */
export function markToMarket(
  positions: Position[],
  ticks: Record<string, PriceTick>
): Position[] {
  return positions.map(pos => {
    const tick = ticks[pos.symbol];
    if (!tick) return pos;
    
    const currentPrice = pos.side === 'long' ? tick.bid : tick.ask;
    const priceDiff = pos.side === 'long' 
      ? currentPrice - pos.entryPrice 
      : pos.entryPrice - currentPrice;
    
    const unrealizedPnl = priceDiff * pos.size;
    
    return { ...pos, unrealizedPnl };
  });
}

/**
 * Check positions for SL/TP hits
 */
export function checkExits(
  positions: Position[],
  ticks: Record<string, PriceTick>
): { 
  remainingPositions: Position[]; 
  closedTrades: ClosedTrade[];
  logs: SystemLog[];
} {
  const remainingPositions: Position[] = [];
  const closedTrades: ClosedTrade[] = [];
  const logs: SystemLog[] = [];
  const now = new Date().toISOString();
  const today = new Date().toISOString().split('T')[0];
  
  for (const pos of positions) {
    const tick = ticks[pos.symbol];
    if (!tick) {
      remainingPositions.push(pos);
      continue;
    }
    
    const currentPrice = pos.side === 'long' ? tick.bid : tick.ask;
    let closeReason: string | null = null;
    let exitPrice = currentPrice;
    
    // Check stop loss
    if (pos.sl) {
      if (pos.side === 'long' && tick.bid <= pos.sl) {
        closeReason = 'sl_hit';
        exitPrice = pos.sl;
      } else if (pos.side === 'short' && tick.ask >= pos.sl) {
        closeReason = 'sl_hit';
        exitPrice = pos.sl;
      }
    }
    
    // Check take profit
    if (!closeReason && pos.tp) {
      if (pos.side === 'long' && tick.bid >= pos.tp) {
        closeReason = 'tp_hit';
        exitPrice = pos.tp;
      } else if (pos.side === 'short' && tick.ask <= pos.tp) {
        closeReason = 'tp_hit';
        exitPrice = pos.tp;
      }
    }
    
    if (closeReason) {
      const priceDiff = pos.side === 'long'
        ? exitPrice - pos.entryPrice
        : pos.entryPrice - exitPrice;
      const realizedPnl = priceDiff * pos.size;
      
      closedTrades.push({
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
        realizedPnl,
        reason: closeReason,
        sessionDate: today,
        batchId: pos.batchId
      });
      
      logs.push({
        level: realizedPnl >= 0 ? 'info' : 'warning',
        source: `mode:${pos.mode}`,
        message: `${pos.symbol} ${pos.side} closed: ${closeReason} | P&L: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)}`,
        meta: { tradeId: pos.id, pnl: realizedPnl },
        createdAt: now
      });
    } else {
      remainingPositions.push(pos);
    }
  }
  
  return { remainingPositions, closedTrades, logs };
}

/**
 * Close positions manually (for global close or take burst profit)
 */
export function closePositions(
  positions: Position[],
  ticks: Record<string, PriceTick>,
  reason: string
): { closedTrades: ClosedTrade[]; logs: SystemLog[] } {
  const closedTrades: ClosedTrade[] = [];
  const logs: SystemLog[] = [];
  const now = new Date().toISOString();
  const today = new Date().toISOString().split('T')[0];
  
  for (const pos of positions) {
    const tick = ticks[pos.symbol];
    const exitPrice = tick 
      ? (pos.side === 'long' ? tick.bid : tick.ask)
      : pos.entryPrice;
    
    const priceDiff = pos.side === 'long'
      ? exitPrice - pos.entryPrice
      : pos.entryPrice - exitPrice;
    const realizedPnl = priceDiff * pos.size;
    
    closedTrades.push({
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
      realizedPnl,
      reason,
      sessionDate: today,
      batchId: pos.batchId
    });
  }
  
  const totalPnl = closedTrades.reduce((sum, t) => sum + t.realizedPnl, 0);
  
  logs.push({
    level: 'info',
    source: 'execution',
    message: `${reason}: Closed ${closedTrades.length} positions | Total P&L: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`,
    meta: { count: closedTrades.length, totalPnl },
    createdAt: now
  });
  
  return { closedTrades, logs };
}

/**
 * Calculate session statistics
 */
export function calculateStats(
  positions: Position[],
  todayTrades: ClosedTrade[],
  startingEquity: number
): PaperSessionStats {
  // Calculate today's realized P&L
  const realizedPnl = todayTrades.reduce((sum, t) => sum + t.realizedPnl, 0);
  
  // Calculate unrealized P&L from open positions
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  
  const todayPnl = realizedPnl + unrealizedPnl;
  const todayPnlPercent = startingEquity > 0 ? (todayPnl / startingEquity) * 100 : 0;
  
  // Win rate
  const closedCount = todayTrades.length;
  const wins = todayTrades.filter(t => t.realizedPnl > 0).length;
  const winRate = closedCount > 0 ? (wins / closedCount) * 100 : 0;
  
  // Average R:R (simplified)
  const avgWin = todayTrades.filter(t => t.realizedPnl > 0)
    .reduce((sum, t) => sum + t.realizedPnl, 0) / Math.max(wins, 1);
  const losses = todayTrades.filter(t => t.realizedPnl < 0);
  const avgLoss = Math.abs(losses.reduce((sum, t) => sum + t.realizedPnl, 0)) / Math.max(losses.length, 1);
  const avgRR = avgLoss > 0 ? avgWin / avgLoss : 1.5;
  
  // Max drawdown (simplified - from today's trades)
  let peak = 0;
  let maxDrawdown = 0;
  let runningPnl = 0;
  
  for (const trade of todayTrades) {
    runningPnl += trade.realizedPnl;
    if (runningPnl > peak) peak = runningPnl;
    const drawdown = peak - runningPnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  // Burst stats
  const burstTrades = todayTrades.filter(t => t.mode === 'burst');
  const burstPnl = burstTrades.reduce((sum, t) => sum + t.realizedPnl, 0);
  const burstPnlPercent = startingEquity > 0 ? (burstPnl / startingEquity) * 100 : 0;
  const burstBatches = new Set(burstTrades.map(t => t.batchId).filter(Boolean)).size;
  
  const burstPositions = positions.filter(p => p.mode === 'burst');
  const burstStatus = burstPositions.length > 0 
    ? 'running' 
    : burstPnlPercent >= 8 ? 'locked' : 'idle';
  
  return {
    equity: startingEquity + todayPnl,
    todayPnl,
    todayPnlPercent,
    winRate,
    avgRR: Math.round(avgRR * 10) / 10,
    tradesToday: closedCount,
    maxDrawdown: startingEquity > 0 ? (maxDrawdown / startingEquity) * 100 : 0,
    openPositionsCount: positions.length,
    burstPnlToday: burstPnlPercent,
    burstsToday: burstBatches,
    burstStatus
  };
}
