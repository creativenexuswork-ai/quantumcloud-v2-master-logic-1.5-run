// ============= Environment Classifier =============
// Analyzes market conditions to determine tradeability

import type { PriceTick, Position, ClosedTrade } from './types';

export type MarketState = 'trend_clean' | 'trend_messy' | 'range_tradeable' | 'range_trap' | 'chaos' | 'dead';
export type VolState = 'expansion' | 'compression' | 'exhaustion' | 'spike';
export type LiquidityState = 'normal' | 'thin' | 'broken';

export interface EnvironmentSummary {
  marketState: MarketState;
  volState: VolState;
  liquidityState: LiquidityState;
  environmentConfidence: number; // 0-1 score of how tradeable conditions are
  atr: number;
  avgRange: number;
  trendStrength: number;
  volatilityRatio: number;
}

export interface PriceCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: string;
}

// Store recent price history for analysis
const priceHistory: Record<string, PriceTick[]> = {};
const MAX_HISTORY = 100;

export function recordTick(symbol: string, tick: PriceTick): void {
  if (!priceHistory[symbol]) {
    priceHistory[symbol] = [];
  }
  priceHistory[symbol].push(tick);
  if (priceHistory[symbol].length > MAX_HISTORY) {
    priceHistory[symbol].shift();
  }
}

export function getHistory(symbol: string): PriceTick[] {
  return priceHistory[symbol] || [];
}

function calculateATR(history: PriceTick[], period: number = 14): number {
  if (history.length < period + 1) return 0;
  
  const ranges: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const high = history[i].ask;
    const low = history[i].bid;
    const prevClose = history[i - 1].mid;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    ranges.push(tr);
  }
  
  const recentRanges = ranges.slice(-period);
  return recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;
}

function calculateTrendStrength(history: PriceTick[]): number {
  if (history.length < 20) return 0;
  
  const recent = history.slice(-20);
  const closes = recent.map(t => t.mid);
  
  // Simple directional movement
  let ups = 0;
  let downs = 0;
  
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) ups++;
    else if (closes[i] < closes[i - 1]) downs++;
  }
  
  const total = ups + downs;
  if (total === 0) return 0;
  
  // Returns 0-1, where 1 is perfect trend
  return Math.abs(ups - downs) / total;
}

function detectSwingPoints(history: PriceTick[]): { highs: number[]; lows: number[] } {
  if (history.length < 10) return { highs: [], lows: [] };
  
  const highs: number[] = [];
  const lows: number[] = [];
  
  for (let i = 2; i < history.length - 2; i++) {
    const h = history[i].ask;
    const l = history[i].bid;
    
    if (h > history[i - 1].ask && h > history[i - 2].ask &&
        h > history[i + 1].ask && h > history[i + 2].ask) {
      highs.push(h);
    }
    
    if (l < history[i - 1].bid && l < history[i - 2].bid &&
        l < history[i + 1].bid && l < history[i + 2].bid) {
      lows.push(l);
    }
  }
  
  return { highs, lows };
}

function calculateCandleOverlap(history: PriceTick[]): number {
  if (history.length < 10) return 0.5;
  
  const recent = history.slice(-10);
  let overlapCount = 0;
  
  for (let i = 1; i < recent.length; i++) {
    const prevRange = { high: recent[i - 1].ask, low: recent[i - 1].bid };
    const currRange = { high: recent[i].ask, low: recent[i].bid };
    
    // Check if ranges overlap
    if (currRange.low < prevRange.high && currRange.high > prevRange.low) {
      overlapCount++;
    }
  }
  
  return overlapCount / (recent.length - 1);
}

function classifyMarketState(
  trendStrength: number,
  overlap: number,
  volatilityRatio: number,
  swings: { highs: number[]; lows: number[] }
): MarketState {
  // Dead market - very low volatility
  if (volatilityRatio < 0.3) {
    return 'dead';
  }
  
  // Chaos - high volatility with no structure
  if (volatilityRatio > 2.0 && overlap > 0.7) {
    return 'chaos';
  }
  
  // Trend detection
  if (trendStrength > 0.6) {
    return overlap < 0.5 ? 'trend_clean' : 'trend_messy';
  }
  
  // Range detection
  if (trendStrength < 0.3) {
    // Check for equal highs/lows (trap signs)
    const { highs, lows } = swings;
    const hasEqualLevels = (highs.length > 2 || lows.length > 2) && overlap > 0.6;
    
    return hasEqualLevels ? 'range_trap' : 'range_tradeable';
  }
  
  // Mixed - default to messy
  return overlap > 0.6 ? 'range_trap' : 'trend_messy';
}

function classifyVolState(
  history: PriceTick[],
  currentATR: number,
  avgATR: number
): VolState {
  if (history.length < 20) return 'compression';
  
  const recentATRs: number[] = [];
  for (let i = 14; i < history.length; i++) {
    const slice = history.slice(i - 14, i);
    recentATRs.push(calculateATR(slice, 14));
  }
  
  const atrTrend = recentATRs.slice(-5);
  const avgRecentATR = atrTrend.reduce((a, b) => a + b, 0) / atrTrend.length;
  
  // Spike detection
  if (currentATR > avgATR * 2.5) {
    return 'spike';
  }
  
  // Expansion - ATR increasing
  const isExpanding = atrTrend.every((v, i) => i === 0 || v >= atrTrend[i - 1] * 0.95);
  if (isExpanding && currentATR > avgATR * 1.3) {
    return 'expansion';
  }
  
  // Compression - ATR decreasing or low
  if (currentATR < avgATR * 0.7) {
    return 'compression';
  }
  
  // Exhaustion - after spike, settling down
  const wasHighVol = recentATRs.slice(-10, -5).some(a => a > avgATR * 1.8);
  if (wasHighVol && currentATR < avgATR * 1.2) {
    return 'exhaustion';
  }
  
  return 'compression';
}

function classifyLiquidityState(tick: PriceTick, avgSpread: number): LiquidityState {
  const currentSpread = tick.ask - tick.bid;
  
  if (currentSpread > avgSpread * 3) {
    return 'broken';
  }
  
  if (currentSpread > avgSpread * 1.5) {
    return 'thin';
  }
  
  return 'normal';
}

/**
 * Classify the market environment for a given symbol
 */
export function classifyEnvironment(symbol: string, tick: PriceTick): EnvironmentSummary {
  recordTick(symbol, tick);
  const history = getHistory(symbol);
  
  // Calculate metrics
  const atr = calculateATR(history);
  const trendStrength = calculateTrendStrength(history);
  const overlap = calculateCandleOverlap(history);
  const swings = detectSwingPoints(history);
  
  // Calculate average ATR for comparison
  const avgATR = history.length > 30 
    ? calculateATR(history.slice(0, -10), 14) 
    : atr;
  
  const volatilityRatio = avgATR > 0 ? atr / avgATR : 1;
  
  // Calculate average spread
  const spreads = history.map(t => t.ask - t.bid);
  const avgSpread = spreads.length > 0 
    ? spreads.reduce((a, b) => a + b, 0) / spreads.length 
    : tick.ask - tick.bid;
  
  // Classify each state dimension
  const marketState = classifyMarketState(trendStrength, overlap, volatilityRatio, swings);
  const volState = classifyVolState(history, atr, avgATR);
  const liquidityState = classifyLiquidityState(tick, avgSpread);
  
  // Calculate environment confidence (0-1)
  let confidence = 0.5;
  
  // Boost for clean states
  if (marketState === 'trend_clean') confidence += 0.25;
  else if (marketState === 'range_tradeable') confidence += 0.15;
  else if (marketState === 'trend_messy') confidence += 0.05;
  else if (marketState === 'chaos' || marketState === 'dead') confidence -= 0.3;
  else if (marketState === 'range_trap') confidence -= 0.2;
  
  // Vol state adjustments
  if (volState === 'expansion') confidence += 0.1;
  else if (volState === 'compression') confidence += 0.05;
  else if (volState === 'spike') confidence -= 0.15;
  else if (volState === 'exhaustion') confidence -= 0.05;
  
  // Liquidity adjustments
  if (liquidityState === 'broken') confidence -= 0.4;
  else if (liquidityState === 'thin') confidence -= 0.15;
  
  // Clamp confidence
  confidence = Math.max(0, Math.min(1, confidence));
  
  return {
    marketState,
    volState,
    liquidityState,
    environmentConfidence: confidence,
    atr,
    avgRange: avgATR,
    trendStrength,
    volatilityRatio
  };
}

/**
 * Check if environment is suitable for opening new trades
 */
export function isTradeableEnvironment(env: EnvironmentSummary): boolean {
  // Never trade in chaos, dead, or broken liquidity
  if (env.marketState === 'chaos' || env.marketState === 'dead') return false;
  if (env.liquidityState === 'broken') return false;
  
  // Need minimum confidence
  return env.environmentConfidence >= 0.3;
}

/**
 * Get environment quality multiplier for sizing
 */
export function getEnvironmentMultiplier(env: EnvironmentSummary): number {
  if (env.marketState === 'trend_clean') return 1.2;
  if (env.marketState === 'range_tradeable') return 1.0;
  if (env.marketState === 'trend_messy') return 0.8;
  if (env.marketState === 'range_trap') return 0.5;
  return 0.3; // chaos, dead
}
