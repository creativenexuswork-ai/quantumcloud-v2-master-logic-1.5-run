// Trading Mode Implementations
// Each mode returns proposed orders based on market conditions

import type { 
  EngineContext, 
  ProposedOrder, 
  PriceTick, 
  Side,
  TradingMode 
} from './types';

// Helper to detect simple trend from price history (mock)
function detectTrend(tick: PriceTick): 'up' | 'down' | 'neutral' {
  // In real implementation, use moving averages from price history
  const regime = tick.regime;
  if (regime === 'trend') {
    return tick.volatility && tick.volatility > 0.5 ? 'up' : 'down';
  }
  return 'neutral';
}

// Calculate position size based on risk
function calculateSize(
  equity: number,
  riskPercent: number,
  price: number,
  slDistance: number
): number {
  if (slDistance === 0) return 0;
  const riskAmount = equity * (riskPercent / 100);
  return Math.max(0.001, riskAmount / slDistance);
}

// Generate unique batch ID for burst trades
function generateBatchId(): string {
  return `burst_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sniper Mode - Low frequency, high confidence trades
 */
export function runSniperMode(ctx: EngineContext): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const settings = ctx.config.modeConfig.modeSettings.sniper;
  const riskPct = settings?.riskPerTrade ?? 0.5;
  
  for (const symbol of ctx.config.marketConfig.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick) continue;
    
    // Sniper only trades in clear trend with low volatility
    if (tick.regime !== 'trend' || tick.volatility && tick.volatility > 0.7) continue;
    
    const trend = detectTrend(tick);
    if (trend === 'neutral') continue;
    
    const side: Side = trend === 'up' ? 'long' : 'short';
    const slDistance = tick.mid * 0.015; // 1.5% SL
    const tpDistance = tick.mid * 0.03; // 3% TP (2:1 R:R)
    
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    
    orders.push({
      symbol,
      side,
      size,
      entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'sniper',
      reason: `Clear ${trend} trend detected in ${tick.regime} regime`,
      confidence: 0.8
    });
  }
  
  // Sniper takes max 1-2 trades
  return orders.slice(0, 2);
}

/**
 * Burst Mode - Rapid cluster of micro-positions
 */
export function runBurstMode(ctx: EngineContext): ProposedOrder[] {
  if (!ctx.config.burstRequested) return [];
  
  const orders: ProposedOrder[] = [];
  const burstSize = ctx.config.burstConfig.size;
  const totalRisk = ctx.config.burstConfig.riskPerBurstPercent ?? 2;
  const riskPerTrade = totalRisk / burstSize;
  
  // Find best symbol for burst (highest volatility in trend)
  let bestSymbol: string | null = null;
  let bestScore = 0;
  
  for (const symbol of ctx.config.marketConfig.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick || tick.regime === 'low_vol') continue;
    
    const score = (tick.volatility ?? 0.5) * (tick.regime === 'trend' ? 1.5 : 1);
    if (score > bestScore) {
      bestScore = score;
      bestSymbol = symbol;
    }
  }
  
  if (!bestSymbol) return [];
  
  const tick = ctx.ticks[bestSymbol];
  const trend = detectTrend(tick);
  const side: Side = trend === 'down' ? 'short' : 'long';
  const batchId = generateBatchId();
  
  // Create burst of micro-positions
  for (let i = 0; i < burstSize; i++) {
    const slDistance = tick.mid * 0.005; // Tight 0.5% SL for burst
    const tpDistance = tick.mid * 0.01; // 1% TP
    const size = calculateSize(ctx.equity, riskPerTrade, tick.mid, slDistance);
    
    // Slight price variation for realism
    const priceOffset = (Math.random() - 0.5) * tick.mid * 0.0002;
    
    orders.push({
      symbol: bestSymbol,
      side,
      size,
      entryPrice: tick.mid + priceOffset,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'burst',
      reason: `Burst trade ${i + 1}/${burstSize} on momentum`,
      confidence: 0.6,
      batchId
    });
  }
  
  return orders;
}

/**
 * Trend Mode - Follow established trends
 */
export function runTrendMode(ctx: EngineContext): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const settings = ctx.config.modeConfig.modeSettings.trend;
  const riskPct = settings?.riskPerTrade ?? 1;
  
  for (const symbol of ctx.config.marketConfig.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick || tick.regime !== 'trend') continue;
    
    const trend = detectTrend(tick);
    if (trend === 'neutral') continue;
    
    const side: Side = trend === 'up' ? 'long' : 'short';
    const slDistance = tick.mid * 0.01;
    const tpDistance = tick.mid * 0.02;
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    
    orders.push({
      symbol,
      side,
      size,
      entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'trend',
      reason: `Following ${trend} trend`,
      confidence: 0.7
    });
  }
  
  return orders.slice(0, 3);
}

/**
 * Swing Mode - Larger moves on higher timeframes
 */
export function runSwingMode(ctx: EngineContext): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const settings = ctx.config.modeConfig.modeSettings.swing;
  const riskPct = settings?.riskPerTrade ?? 2;
  
  for (const symbol of ctx.config.marketConfig.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick) continue;
    
    // Swing prefers clear regimes
    if (tick.regime === 'high_vol') continue;
    
    const trend = detectTrend(tick);
    if (trend === 'neutral') continue;
    
    const side: Side = trend === 'up' ? 'long' : 'short';
    const slDistance = tick.mid * 0.025; // Wider SL
    const tpDistance = tick.mid * 0.05; // Larger TP
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    
    orders.push({
      symbol,
      side,
      size,
      entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'swing',
      reason: `Swing trade on ${trend} bias`,
      confidence: 0.65
    });
  }
  
  return orders.slice(0, 2);
}

/**
 * Memory Mode - Adaptive based on recent performance
 */
export function runMemoryMode(ctx: EngineContext): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const recentWinRate = ctx.stats.winRate;
  
  // Adjust risk based on recent performance
  const baseRisk = 1;
  const riskMultiplier = recentWinRate > 60 ? 1.2 : recentWinRate < 40 ? 0.5 : 1;
  const riskPct = baseRisk * riskMultiplier;
  
  // Filter symbols based on recent success
  const successfulSymbols = new Set(
    ctx.recentTrades
      .filter(t => t.realizedPnl > 0)
      .map(t => t.symbol)
  );
  
  for (const symbol of ctx.config.marketConfig.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick) continue;
    
    // Prefer symbols that have been profitable
    const symbolBonus = successfulSymbols.has(symbol) ? 0.1 : 0;
    
    const trend = detectTrend(tick);
    if (trend === 'neutral') continue;
    
    const side: Side = trend === 'up' ? 'long' : 'short';
    const slDistance = tick.mid * 0.012;
    const tpDistance = tick.mid * 0.018;
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    
    orders.push({
      symbol,
      side,
      size,
      entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'memory',
      reason: `Adaptive trade (win rate: ${recentWinRate.toFixed(0)}%)`,
      confidence: 0.6 + symbolBonus
    });
  }
  
  return orders.slice(0, 3);
}

/**
 * Stealth Mode - Human-like timing variability
 */
export function runStealthMode(ctx: EngineContext): ProposedOrder[] {
  // Random skip to simulate human-like behavior
  if (Math.random() > 0.3) return [];
  
  const orders: ProposedOrder[] = [];
  const settings = ctx.config.modeConfig.modeSettings.stealth;
  const riskPct = settings?.riskPerTrade ?? 0.5;
  
  const symbols = [...ctx.config.marketConfig.selectedSymbols];
  // Randomize order
  symbols.sort(() => Math.random() - 0.5);
  
  for (const symbol of symbols.slice(0, 2)) {
    const tick = ctx.ticks[symbol];
    if (!tick) continue;
    
    const trend = detectTrend(tick);
    if (trend === 'neutral') continue;
    
    const side: Side = trend === 'up' ? 'long' : 'short';
    
    // Add variability to SL/TP
    const slVariance = 1 + (Math.random() - 0.5) * 0.2;
    const slDistance = tick.mid * 0.01 * slVariance;
    const tpDistance = tick.mid * 0.015 * slVariance;
    
    // Round size to look more human
    const rawSize = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    const size = Math.round(rawSize * 100) / 100;
    
    orders.push({
      symbol,
      side,
      size,
      entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'stealth',
      reason: 'Stealth entry with timing variance',
      confidence: 0.55
    });
  }
  
  return orders.slice(0, 1);
}

/**
 * News Mode - Avoids high-impact periods
 */
export function runNewsMode(ctx: EngineContext): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const settings = ctx.config.modeConfig.modeSettings.news;
  const riskPct = settings?.riskPerTrade ?? 0.5;
  
  for (const symbol of ctx.config.marketConfig.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick) continue;
    
    // News mode avoids high volatility (proxy for news events)
    if (tick.regime === 'high_vol') continue;
    if (tick.volatility && tick.volatility > 0.6) continue;
    
    const trend = detectTrend(tick);
    if (trend === 'neutral') continue;
    
    const side: Side = trend === 'up' ? 'long' : 'short';
    const slDistance = tick.mid * 0.008;
    const tpDistance = tick.mid * 0.016;
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    
    orders.push({
      symbol,
      side,
      size,
      entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'news',
      reason: 'Low news-risk environment',
      confidence: 0.7
    });
  }
  
  return orders.slice(0, 2);
}

/**
 * Hybrid Mode - Combines signals from multiple modes
 */
export function runHybridMode(ctx: EngineContext): ProposedOrder[] {
  // Get signals from other modes
  const sniperOrders = runSniperMode(ctx);
  const trendOrders = runTrendMode(ctx);
  const swingOrders = runSwingMode(ctx);
  
  // Combine and dedupe by symbol
  const ordersBySymbol = new Map<string, ProposedOrder>();
  
  // Priority: sniper > trend > swing
  for (const order of [...swingOrders, ...trendOrders, ...sniperOrders]) {
    ordersBySymbol.set(order.symbol, {
      ...order,
      mode: 'hybrid',
      reason: `Hybrid: ${order.reason}`
    });
  }
  
  return Array.from(ordersBySymbol.values()).slice(0, 3);
}

// Mode runner map
export const MODE_RUNNERS: Record<TradingMode, (ctx: EngineContext) => ProposedOrder[]> = {
  sniper: runSniperMode,
  burst: runBurstMode,
  trend: runTrendMode,
  swing: runSwingMode,
  memory: runMemoryMode,
  stealth: runStealthMode,
  news: runNewsMode,
  hybrid: runHybridMode,
};
