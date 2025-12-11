// ============= Edge Engine =============
// Scores "reasons to trade" for each asset and direction

import type { PriceTick, Side } from './types';
import { getHistory, type EnvironmentSummary } from './environment';

export interface EdgeSignal {
  edgeScore: number;        // 0-100
  edgeDirection: Side | 'neutral';
  edgeConfidence: number;   // 0-1
  reasons: string[];
  structureEdge: number;
  volatilityEdge: number;
  sessionEdge: number;
  correlationEdge: number;
}

interface SwingLevel {
  price: number;
  type: 'high' | 'low';
  strength: number;
}

// Session timing (UTC hours)
const SESSIONS = {
  asiaStart: 0,
  asiaEnd: 8,
  londonStart: 7,
  londonEnd: 16,
  nyStart: 13,
  nyEnd: 22,
  overlap: { start: 13, end: 16 } // London/NY overlap
};

function getCurrentSession(): { name: string; quality: number } {
  const hour = new Date().getUTCHours();
  
  // London/NY overlap - best liquidity
  if (hour >= SESSIONS.overlap.start && hour < SESSIONS.overlap.end) {
    return { name: 'overlap', quality: 1.0 };
  }
  
  // NY session
  if (hour >= SESSIONS.nyStart && hour < SESSIONS.nyEnd) {
    return { name: 'ny', quality: 0.85 };
  }
  
  // London session
  if (hour >= SESSIONS.londonStart && hour < SESSIONS.londonEnd) {
    return { name: 'london', quality: 0.9 };
  }
  
  // Asia session - lower quality for most pairs
  if (hour >= SESSIONS.asiaStart && hour < SESSIONS.asiaEnd) {
    return { name: 'asia', quality: 0.6 };
  }
  
  // Off hours
  return { name: 'off', quality: 0.3 };
}

function findSwingLevels(history: PriceTick[]): SwingLevel[] {
  if (history.length < 15) return [];
  
  const levels: SwingLevel[] = [];
  
  for (let i = 3; i < history.length - 3; i++) {
    const h = history[i].ask;
    const l = history[i].bid;
    
    // Swing high detection
    let isHigh = true;
    let highStrength = 0;
    for (let j = -3; j <= 3; j++) {
      if (j === 0) continue;
      if (history[i + j].ask >= h) {
        isHigh = false;
        break;
      }
      highStrength += (h - history[i + j].ask);
    }
    if (isHigh) {
      levels.push({ price: h, type: 'high', strength: highStrength });
    }
    
    // Swing low detection
    let isLow = true;
    let lowStrength = 0;
    for (let j = -3; j <= 3; j++) {
      if (j === 0) continue;
      if (history[i + j].bid <= l) {
        isLow = false;
        break;
      }
      lowStrength += (history[i + j].bid - l);
    }
    if (isLow) {
      levels.push({ price: l, type: 'low', strength: lowStrength });
    }
  }
  
  return levels.slice(-10); // Keep recent levels
}

function detectBreakOfStructure(
  history: PriceTick[],
  currentTick: PriceTick
): { direction: Side | 'neutral'; strength: number } {
  const levels = findSwingLevels(history);
  if (levels.length < 2) return { direction: 'neutral', strength: 0 };
  
  const recentHighs = levels.filter(l => l.type === 'high').slice(-3);
  const recentLows = levels.filter(l => l.type === 'low').slice(-3);
  
  // Check for break above recent highs
  for (const high of recentHighs) {
    if (currentTick.bid > high.price * 1.001) { // 0.1% above
      return { direction: 'long', strength: Math.min(1, high.strength * 10) };
    }
  }
  
  // Check for break below recent lows
  for (const low of recentLows) {
    if (currentTick.ask < low.price * 0.999) { // 0.1% below
      return { direction: 'short', strength: Math.min(1, low.strength * 10) };
    }
  }
  
  return { direction: 'neutral', strength: 0 };
}

function detectLiquiditySweep(
  history: PriceTick[],
  currentTick: PriceTick
): { direction: Side | 'neutral'; strength: number } {
  if (history.length < 20) return { direction: 'neutral', strength: 0 };
  
  const levels = findSwingLevels(history);
  const recentHistory = history.slice(-10);
  
  // Find equal highs/lows (liquidity pools)
  const equalHighs: number[] = [];
  const equalLows: number[] = [];
  
  const highLevels = levels.filter(l => l.type === 'high');
  const lowLevels = levels.filter(l => l.type === 'low');
  
  for (let i = 0; i < highLevels.length - 1; i++) {
    for (let j = i + 1; j < highLevels.length; j++) {
      const diff = Math.abs(highLevels[i].price - highLevels[j].price);
      if (diff < highLevels[i].price * 0.002) {
        equalHighs.push((highLevels[i].price + highLevels[j].price) / 2);
      }
    }
  }
  
  for (let i = 0; i < lowLevels.length - 1; i++) {
    for (let j = i + 1; j < lowLevels.length; j++) {
      const diff = Math.abs(lowLevels[i].price - lowLevels[j].price);
      if (diff < lowLevels[i].price * 0.002) {
        equalLows.push((lowLevels[i].price + lowLevels[j].price) / 2);
      }
    }
  }
  
  // Check for sweep and rejection
  const maxRecent = Math.max(...recentHistory.map(t => t.ask));
  const minRecent = Math.min(...recentHistory.map(t => t.bid));
  
  for (const eqHigh of equalHighs) {
    // Price swept above equal highs then came back below
    if (maxRecent > eqHigh && currentTick.bid < eqHigh * 0.998) {
      return { direction: 'short', strength: 0.7 };
    }
  }
  
  for (const eqLow of equalLows) {
    // Price swept below equal lows then came back above
    if (minRecent < eqLow && currentTick.ask > eqLow * 1.002) {
      return { direction: 'long', strength: 0.7 };
    }
  }
  
  return { direction: 'neutral', strength: 0 };
}

function detectFairValueGap(
  history: PriceTick[]
): { direction: Side | 'neutral'; gapPrice: number; strength: number } {
  if (history.length < 10) return { direction: 'neutral', gapPrice: 0, strength: 0 };
  
  const recent = history.slice(-10);
  
  // Look for FVG patterns (3 candle imbalance)
  for (let i = 2; i < recent.length; i++) {
    const candle1 = recent[i - 2];
    const candle2 = recent[i - 1];
    const candle3 = recent[i];
    
    // Bullish FVG: candle 1 high < candle 3 low (gap up)
    if (candle1.ask < candle3.bid && candle2.ask - candle2.bid > (candle3.ask - candle3.bid) * 0.5) {
      const gapMid = (candle1.ask + candle3.bid) / 2;
      const currentTick = history[history.length - 1];
      
      // Price returned to fill gap
      if (currentTick.bid <= gapMid && currentTick.ask >= candle1.ask) {
        return { direction: 'long', gapPrice: gapMid, strength: 0.6 };
      }
    }
    
    // Bearish FVG: candle 1 low > candle 3 high (gap down)
    if (candle1.bid > candle3.ask && candle2.ask - candle2.bid > (candle3.ask - candle3.bid) * 0.5) {
      const gapMid = (candle1.bid + candle3.ask) / 2;
      const currentTick = history[history.length - 1];
      
      // Price returned to fill gap
      if (currentTick.ask >= gapMid && currentTick.bid <= candle1.bid) {
        return { direction: 'short', gapPrice: gapMid, strength: 0.6 };
      }
    }
  }
  
  return { direction: 'neutral', gapPrice: 0, strength: 0 };
}

function calculateVolatilityEdge(env: EnvironmentSummary): { score: number; direction: Side | 'neutral' } {
  let score = 0;
  
  // Compression is good for breakout anticipation
  if (env.volState === 'compression') {
    score += 15;
  }
  
  // Controlled expansion is ideal
  if (env.volState === 'expansion' && env.volatilityRatio < 2) {
    score += 25;
  }
  
  // Spike is dangerous
  if (env.volState === 'spike') {
    score -= 20;
  }
  
  // Exhaustion can offer reversal opportunities
  if (env.volState === 'exhaustion') {
    score += 10;
  }
  
  // Use trend for direction in expansion
  let direction: Side | 'neutral' = 'neutral';
  if (env.trendStrength > 0.5 && env.volState === 'expansion') {
    direction = env.trendStrength > 0 ? 'long' : 'short';
  }
  
  return { score: Math.max(0, score), direction };
}

function calculateSessionEdge(symbol: string): { score: number; quality: number } {
  const session = getCurrentSession();
  let score = session.quality * 20;
  
  // Crypto is 24/7, boost slightly during low activity
  if (symbol.includes('USD') && (symbol.includes('BTC') || symbol.includes('ETH'))) {
    score = Math.max(score, 15);
  }
  
  // FX pairs benefit from overlap
  if (session.name === 'overlap') {
    score += 10;
  }
  
  return { score, quality: session.quality };
}

function calculateCorrelationEdge(
  symbol: string,
  allTicks: Record<string, PriceTick>
): { score: number; agreement: boolean } {
  // Define correlation groups
  const groups: Record<string, string[]> = {
    crypto: ['BTCUSD', 'ETHUSD', 'XRPUSD', 'SOLUSD', 'ADAUSD', 'BNBUSD', 'AVAXUSD'],
    usdMajors: ['EURUSD', 'GBPUSD', 'AUDUSD'],
    usdCrosses: ['USDJPY', 'USDCHF'],
    indices: ['SPY', 'QQQ'],
    tech: ['TSLA', 'AAPL', 'NVDA', 'META', 'MSFT']
  };
  
  // Find which group this symbol belongs to
  let myGroup: string[] = [];
  for (const [, members] of Object.entries(groups)) {
    if (members.some(m => symbol.includes(m.replace('USD', '')))) {
      myGroup = members.filter(m => m !== symbol);
      break;
    }
  }
  
  if (myGroup.length === 0) return { score: 0, agreement: true };
  
  // Check agreement with correlated assets
  let agreementCount = 0;
  let totalChecked = 0;
  
  for (const correlated of myGroup) {
    const tick = allTicks[correlated];
    if (!tick) continue;
    
    const history = getHistory(correlated);
    if (history.length < 5) continue;
    
    const recent = history.slice(-5);
    const direction = recent[recent.length - 1].mid > recent[0].mid ? 'up' : 'down';
    
    const myHistory = getHistory(symbol);
    if (myHistory.length < 5) continue;
    
    const myRecent = myHistory.slice(-5);
    const myDirection = myRecent[myRecent.length - 1].mid > myRecent[0].mid ? 'up' : 'down';
    
    totalChecked++;
    if (direction === myDirection) agreementCount++;
  }
  
  if (totalChecked === 0) return { score: 0, agreement: true };
  
  const agreementRatio = agreementCount / totalChecked;
  const agreement = agreementRatio > 0.5;
  const score = agreement ? agreementRatio * 15 : -10;
  
  return { score, agreement };
}

/**
 * Calculate edge score for a symbol
 * MORE PERMISSIVE - ensures trades can fire
 */
export function calculateEdge(
  symbol: string,
  tick: PriceTick,
  env: EnvironmentSummary,
  allTicks: Record<string, PriceTick>
): EdgeSignal {
  const history = getHistory(symbol);
  const reasons: string[] = [];
  
  // BASE SCORE - Start with something reasonable so trades can fire
  let baseScore = 30; // Minimum baseline to ensure activity
  
  // Structure-based edges
  const bos = detectBreakOfStructure(history, tick);
  const sweep = detectLiquiditySweep(history, tick);
  const fvg = detectFairValueGap(history);
  
  let structureScore = 0;
  let primaryDirection: Side | 'neutral' = 'neutral';
  
  if (bos.direction !== 'neutral') {
    structureScore += bos.strength * 30;
    primaryDirection = bos.direction;
    reasons.push(`Break of structure ${bos.direction}`);
  }
  
  if (sweep.direction !== 'neutral') {
    structureScore += sweep.strength * 25;
    if (primaryDirection === 'neutral') primaryDirection = sweep.direction;
    else if (primaryDirection !== sweep.direction) {
      structureScore -= 5; // Smaller penalty for conflicting signals
    } else {
      reasons.push(`Liquidity sweep ${sweep.direction}`);
    }
  }
  
  if (fvg.direction !== 'neutral') {
    structureScore += fvg.strength * 20;
    if (primaryDirection === 'neutral') primaryDirection = fvg.direction;
    reasons.push(`FVG fill ${fvg.direction}`);
  }
  
  // If no clear structure, use price movement as direction
  if (primaryDirection === 'neutral' && history.length >= 3) {
    const recentMoves = history.slice(-5);
    if (recentMoves.length >= 2) {
      const first = recentMoves[0].mid;
      const last = recentMoves[recentMoves.length - 1].mid;
      const change = (last - first) / first;
      
      if (Math.abs(change) > 0.0005) {
        primaryDirection = change > 0 ? 'long' : 'short';
        structureScore += 15;
        reasons.push(`Price momentum ${primaryDirection}`);
      }
    }
  }
  
  // If still neutral, just pick a direction based on tick spread
  if (primaryDirection === 'neutral') {
    // Use volatility/mid price movement for direction
    const spreadBias = tick.ask - tick.mid > tick.mid - tick.bid;
    primaryDirection = spreadBias ? 'short' : 'long';
    structureScore += 10;
    reasons.push('Default direction from spread');
  }
  
  // Volatility edge
  const volEdge = calculateVolatilityEdge(env);
  if (volEdge.score > 10) {
    reasons.push(`Vol state: ${env.volState}`);
  }
  
  // Session edge
  const sessionEdge = calculateSessionEdge(symbol);
  if (sessionEdge.quality > 0.8) {
    reasons.push('Good session timing');
  }
  
  // Correlation edge
  const corrEdge = calculateCorrelationEdge(symbol, allTicks);
  if (corrEdge.agreement && corrEdge.score > 5) {
    reasons.push('Correlated assets agree');
  }
  
  // Combine scores - ensure minimum of 30
  const rawScore = baseScore + structureScore + volEdge.score + sessionEdge.score + corrEdge.score;
  const totalScore = Math.min(100, Math.max(30, rawScore));
  
  // Calculate confidence based on agreement of signals
  let confidence = 0.5;
  if (reasons.length >= 2) confidence += 0.15;
  if (reasons.length >= 3) confidence += 0.15;
  if (reasons.length >= 4) confidence += 0.1;
  if (env.environmentConfidence > 0.5) confidence += 0.1;
  if (corrEdge.agreement) confidence += 0.05;
  confidence = Math.min(1, Math.max(0.4, confidence)); // Minimum 0.4 confidence
  
  // Final direction - always return a direction, never neutral
  // primaryDirection is now always a Side ('long' | 'short') due to earlier logic
  let finalDirection: Side = primaryDirection;
  if (volEdge.direction !== 'neutral' && volEdge.direction) {
    finalDirection = volEdge.direction;
  }
  
  return {
    edgeScore: Math.round(totalScore),
    edgeDirection: finalDirection,
    edgeConfidence: confidence,
    reasons: reasons.length > 0 ? reasons : ['Base trading conditions'],
    structureEdge: structureScore,
    volatilityEdge: volEdge.score,
    sessionEdge: sessionEdge.score,
    correlationEdge: corrEdge.score
  };
}
