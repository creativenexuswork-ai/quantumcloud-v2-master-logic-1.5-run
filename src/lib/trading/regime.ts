// ============= REGIME ENGINE v1.5 =============
// Market context classification with multi-timeframe analysis

import type { PriceTick } from './types';
import { getHistory } from './environment';

export type TrendBias = 'bull' | 'bear' | 'neutral';
export type MarketStructure = 'trend' | 'range';
export type VolatilityLevel = 'high' | 'normal' | 'low';

export interface RegimeSnapshot {
  symbol: string;
  trendBias: TrendBias;
  structure: MarketStructure;
  volatility: VolatilityLevel;
  trendStrength: number;      // 0-100
  volatilityRatio: number;    // Current ATR / Avg ATR
  confidence: number;         // 0-1
  smaAlignment: 'bullish' | 'bearish' | 'mixed';
  timestamp: string;
}

// Store multi-timeframe data per symbol
const mtfData: Record<string, {
  shortTermMid: number[];   // 1m/5m data
  mediumTermMid: number[];  // 1h data
  longTermMid: number[];    // 4h/1d data
  atrHistory: number[];
}> = {};

const MAX_SHORT = 50;
const MAX_MEDIUM = 30;
const MAX_LONG = 20;

function ensureSymbolData(symbol: string) {
  if (!mtfData[symbol]) {
    mtfData[symbol] = {
      shortTermMid: [],
      mediumTermMid: [],
      longTermMid: [],
      atrHistory: []
    };
  }
}

/**
 * Record a new tick and update multi-timeframe buffers
 */
export function recordRegimeTick(symbol: string, tick: PriceTick): void {
  ensureSymbolData(symbol);
  const data = mtfData[symbol];
  
  // Short term always updates
  data.shortTermMid.push(tick.mid);
  if (data.shortTermMid.length > MAX_SHORT) {
    data.shortTermMid.shift();
  }
  
  // Medium/long term update less frequently (simulated - in real system use actual MTF candles)
  // For now, use every Nth tick as proxy
  if (data.shortTermMid.length % 5 === 0) {
    data.mediumTermMid.push(tick.mid);
    if (data.mediumTermMid.length > MAX_MEDIUM) {
      data.mediumTermMid.shift();
    }
  }
  
  if (data.shortTermMid.length % 20 === 0) {
    data.longTermMid.push(tick.mid);
    if (data.longTermMid.length > MAX_LONG) {
      data.longTermMid.shift();
    }
  }
}

function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices.length > 0 ? prices[prices.length - 1] : 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return calculateSMA(prices, prices.length);
  
  const k = 2 / (period + 1);
  let ema = prices[0];
  
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  
  return ema;
}

function calculateATR(prices: number[]): number {
  if (prices.length < 2) return 0;
  
  let sum = 0;
  for (let i = 1; i < prices.length; i++) {
    sum += Math.abs(prices[i] - prices[i - 1]);
  }
  
  return sum / (prices.length - 1);
}

function determineSMAAlignment(
  shortTermPrices: number[],
  mediumTermPrices: number[],
  longTermPrices: number[]
): 'bullish' | 'bearish' | 'mixed' {
  if (shortTermPrices.length < 5 || mediumTermPrices.length < 3) {
    return 'mixed';
  }
  
  const sma5 = calculateSMA(shortTermPrices, 5);
  const sma20 = calculateSMA(shortTermPrices, 20);
  const ema10 = calculateEMA(shortTermPrices, 10);
  
  const currentPrice = shortTermPrices[shortTermPrices.length - 1];
  
  // Count bullish signals
  let bullish = 0;
  let bearish = 0;
  
  if (currentPrice > sma5) bullish++;
  else bearish++;
  
  if (sma5 > sma20) bullish++;
  else bearish++;
  
  if (currentPrice > ema10) bullish++;
  else bearish++;
  
  // Check medium term alignment
  if (mediumTermPrices.length >= 5) {
    const mediumSMA = calculateSMA(mediumTermPrices, 5);
    const mediumCurrent = mediumTermPrices[mediumTermPrices.length - 1];
    if (mediumCurrent > mediumSMA) bullish++;
    else bearish++;
  }
  
  if (bullish >= 3) return 'bullish';
  if (bearish >= 3) return 'bearish';
  return 'mixed';
}

function determineTrendBias(
  prices: number[],
  smaAlignment: 'bullish' | 'bearish' | 'mixed'
): { bias: TrendBias; strength: number } {
  if (prices.length < 10) {
    return { bias: 'neutral', strength: 0 };
  }
  
  // Calculate directional movement
  let ups = 0;
  let downs = 0;
  const recent = prices.slice(-20);
  
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1]) ups++;
    else if (recent[i] < recent[i - 1]) downs++;
  }
  
  const total = ups + downs;
  if (total === 0) return { bias: 'neutral', strength: 0 };
  
  const directionalStrength = Math.abs(ups - downs) / total;
  
  // Price change percentage
  const startPrice = recent[0];
  const endPrice = recent[recent.length - 1];
  const changePercent = ((endPrice - startPrice) / startPrice) * 100;
  
  // Combine signals
  let strength = directionalStrength * 50;
  
  if (Math.abs(changePercent) > 0.5) strength += 20;
  if (Math.abs(changePercent) > 1.0) strength += 15;
  
  if (smaAlignment === 'bullish' && ups > downs) strength += 15;
  if (smaAlignment === 'bearish' && downs > ups) strength += 15;
  
  strength = Math.min(100, strength);
  
  // Determine bias
  let bias: TrendBias = 'neutral';
  if (ups > downs && strength > 30) {
    bias = 'bull';
  } else if (downs > ups && strength > 30) {
    bias = 'bear';
  }
  
  return { bias, strength };
}

function determineStructure(
  prices: number[],
  trendStrength: number,
  volatilityRatio: number
): MarketStructure {
  if (prices.length < 15) return 'range';
  
  // High trend strength = trending
  if (trendStrength > 50) {
    return 'trend';
  }
  
  // Check for ranging behavior
  const recent = prices.slice(-15);
  const high = Math.max(...recent);
  const low = Math.min(...recent);
  const range = high - low;
  const avg = (high + low) / 2;
  const rangePercent = (range / avg) * 100;
  
  // Narrow range with low trend strength = ranging
  if (rangePercent < 1.5 && trendStrength < 40) {
    return 'range';
  }
  
  // High volatility with moderate trend = trend
  if (volatilityRatio > 1.2 && trendStrength > 35) {
    return 'trend';
  }
  
  return trendStrength > 35 ? 'trend' : 'range';
}

function determineVolatility(
  prices: number[],
  currentATR: number,
  historicalATRs: number[]
): { level: VolatilityLevel; ratio: number } {
  if (prices.length < 5) {
    return { level: 'normal', ratio: 1.0 };
  }
  
  // Calculate average historical ATR
  const avgATR = historicalATRs.length > 0
    ? historicalATRs.reduce((a, b) => a + b, 0) / historicalATRs.length
    : currentATR;
  
  const ratio = avgATR > 0 ? currentATR / avgATR : 1.0;
  
  let level: VolatilityLevel;
  if (ratio > 1.5) {
    level = 'high';
  } else if (ratio < 0.6) {
    level = 'low';
  } else {
    level = 'normal';
  }
  
  return { level, ratio };
}

/**
 * Classify the current market regime for a symbol
 */
export function classifyRegime(symbol: string, tick: PriceTick): RegimeSnapshot {
  ensureSymbolData(symbol);
  recordRegimeTick(symbol, tick);
  
  const data = mtfData[symbol];
  const history = getHistory(symbol);
  
  // Calculate ATR
  const currentATR = calculateATR(data.shortTermMid.slice(-14));
  data.atrHistory.push(currentATR);
  if (data.atrHistory.length > 50) {
    data.atrHistory.shift();
  }
  
  // Determine SMA alignment
  const smaAlignment = determineSMAAlignment(
    data.shortTermMid,
    data.mediumTermMid,
    data.longTermMid
  );
  
  // Determine trend bias and strength
  const { bias: trendBias, strength: trendStrength } = determineTrendBias(
    data.shortTermMid,
    smaAlignment
  );
  
  // Determine volatility
  const { level: volatility, ratio: volatilityRatio } = determineVolatility(
    data.shortTermMid,
    currentATR,
    data.atrHistory.slice(0, -1)
  );
  
  // Determine structure
  const structure = determineStructure(
    data.shortTermMid,
    trendStrength,
    volatilityRatio
  );
  
  // Calculate confidence based on data quality
  let confidence = 0.5;
  if (data.shortTermMid.length >= 30) confidence += 0.2;
  if (data.mediumTermMid.length >= 10) confidence += 0.15;
  if (data.longTermMid.length >= 5) confidence += 0.15;
  
  // Reduce confidence in conflicting signals
  if (smaAlignment === 'mixed') confidence -= 0.1;
  if (trendBias === 'neutral' && structure === 'trend') confidence -= 0.1;
  
  confidence = Math.max(0.2, Math.min(1, confidence));
  
  return {
    symbol,
    trendBias,
    structure,
    volatility,
    trendStrength,
    volatilityRatio,
    confidence,
    smaAlignment,
    timestamp: new Date().toISOString()
  };
}

/**
 * Check if regime is suitable for a specific mode
 */
export function isRegimeSuitableForMode(
  regime: RegimeSnapshot,
  mode: 'burst' | 'scalper' | 'trend'
): { suitable: boolean; reason: string; score: number } {
  let score = 50;
  const reasons: string[] = [];
  
  switch (mode) {
    case 'burst':
      // Burst trades in most conditions, prefers some volatility
      if (regime.volatility === 'high') {
        score += 20;
        reasons.push('High vol');
      } else if (regime.volatility === 'low') {
        score -= 10;
        reasons.push('Low vol');
      }
      
      if (regime.structure === 'trend') {
        score += 15;
        reasons.push('Trending');
      }
      
      // Burst always trades, just adjusts sizing
      break;
      
    case 'scalper':
      // Scalper likes normal conditions with decent volatility
      if (regime.volatility === 'normal') {
        score += 20;
        reasons.push('Normal vol');
      } else if (regime.volatility === 'high') {
        score += 10; // Can trade high vol but more careful
        reasons.push('High vol (caution)');
      }
      
      if (regime.structure === 'range') {
        score += 15;
        reasons.push('Ranging');
      }
      break;
      
    case 'trend':
      // Trend mode is stricter
      if (regime.structure !== 'trend') {
        score -= 30;
        reasons.push('Not trending');
      } else {
        score += 25;
        reasons.push('Trend structure');
      }
      
      if (regime.trendStrength > 60) {
        score += 15;
        reasons.push('Strong trend');
      }
      
      if (regime.smaAlignment !== 'mixed') {
        score += 10;
        reasons.push(`SMA ${regime.smaAlignment}`);
      }
      break;
  }
  
  // Common adjustments
  if (regime.confidence > 0.7) {
    score += 10;
    reasons.push('High confidence');
  } else if (regime.confidence < 0.4) {
    score -= 15;
    reasons.push('Low confidence');
  }
  
  score = Math.max(0, Math.min(100, score));
  
  return {
    suitable: score >= 35, // Very permissive for trading
    reason: reasons.length > 0 ? reasons.join(', ') : 'Neutral conditions',
    score
  };
}

/**
 * Get regime summary for logging
 */
export function getRegimeSummary(regime: RegimeSnapshot): string {
  return `${regime.trendBias}/${regime.structure}/${regime.volatility} (str=${regime.trendStrength.toFixed(0)}, conf=${(regime.confidence * 100).toFixed(0)}%)`;
}
