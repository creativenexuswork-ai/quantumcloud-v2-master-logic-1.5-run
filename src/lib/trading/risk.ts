// Risk Engine - enforces guardrails on all trading decisions

import type { 
  RiskConfig, 
  Position, 
  ProposedOrder, 
  PaperSessionStats,
  RiskCheckResult,
  SystemLog
} from './types';

/**
 * Calculate current risk exposure from open positions
 */
export function calculateCurrentRisk(
  positions: Position[],
  equity: number
): number {
  if (equity <= 0) return 100;
  
  const totalRisk = positions.reduce((sum, pos) => {
    // Risk = position size relative to equity
    const positionValue = pos.size * pos.entryPrice;
    return sum + (positionValue / equity) * 100;
  }, 0);
  
  return totalRisk;
}

/**
 * Apply risk guardrails to proposed orders
 * Returns filtered orders and any logs
 */
export function applyRiskGuardrails(
  proposedOrders: ProposedOrder[],
  positions: Position[],
  stats: PaperSessionStats,
  riskConfig: RiskConfig,
  equity: number
): { orders: ProposedOrder[]; logs: SystemLog[] } {
  const logs: SystemLog[] = [];
  const now = new Date().toISOString();
  
  // Check max concurrent risk
  const currentRisk = calculateCurrentRisk(positions, equity);
  const remainingRiskCapacity = riskConfig.maxConcurrentRiskPercent - currentRisk;
  
  if (remainingRiskCapacity <= 0) {
    logs.push({
      level: 'info',
      source: 'risk',
      message: `Max concurrent risk reached (${currentRisk.toFixed(1)}%), blocking new orders`,
      createdAt: now
    });
    return { orders: [], logs };
  }
  
  // Check max open trades
  const maxTrades = riskConfig.maxOpenTrades ?? 20;
  const availableSlots = maxTrades - positions.length;
  
  if (availableSlots <= 0) {
    logs.push({
      level: 'info',
      source: 'risk',
      message: `Max open trades (${maxTrades}) reached`,
      createdAt: now
    });
    return { orders: [], logs };
  }
  
  // Filter and limit orders
  const allowedOrders: ProposedOrder[] = [];
  let usedRisk = 0;
  
  for (const order of proposedOrders) {
    if (allowedOrders.length >= availableSlots) break;
    
    const orderRisk = (order.size * order.entryPrice / equity) * 100;
    
    if (usedRisk + orderRisk > remainingRiskCapacity) {
      logs.push({
        level: 'info',
        source: 'risk',
        message: `Order for ${order.symbol} blocked: would exceed risk capacity`,
        createdAt: now
      });
      continue;
    }
    
    // Check per-symbol exposure
    const maxPerSymbol = riskConfig.maxPerSymbolExposure ?? 30;
    const symbolPositions = positions.filter(p => p.symbol === order.symbol);
    const symbolOrders = allowedOrders.filter(o => o.symbol === order.symbol);
    const symbolExposure = [...symbolPositions, ...symbolOrders].length;
    
    if (symbolExposure >= Math.ceil(maxPerSymbol / 5)) {
      logs.push({
        level: 'info',
        source: 'risk',
        message: `Order for ${order.symbol} blocked: symbol exposure limit`,
        createdAt: now
      });
      continue;
    }
    
    allowedOrders.push(order);
    usedRisk += orderRisk;
  }
  
  if (allowedOrders.length < proposedOrders.length) {
    logs.push({
      level: 'info',
      source: 'risk',
      message: `${proposedOrders.length - allowedOrders.length} orders blocked by risk limits`,
      createdAt: now
    });
  }
  
  return { orders: allowedOrders, logs };
}

/**
 * Check if burst mode should be locked (daily target reached)
 */
export function shouldLockBurst(
  burstPnlPercent: number,
  dailyTargetPercent: number
): boolean {
  return burstPnlPercent >= dailyTargetPercent;
}
