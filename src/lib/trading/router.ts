// ============= Market Router =============
// Ranks and selects best assets for trading

import type { PriceTick } from './types';
import type { EnvironmentSummary } from './environment';
import type { EdgeSignal } from './edge';

export interface TradeabilityScore {
  symbol: string;
  score: number;
  rank: number;
  components: {
    environmentScore: number;
    edgeScore: number;
    spreadScore: number;
    sessionScore: number;
  };
  isTradeable: boolean;
  reason: string;
}

export interface MarketRouterResult {
  rankings: TradeabilityScore[];
  primaryCandidates: string[];  // Top N symbols for new trades
  suppressedSymbols: string[];  // Symbols with low scores
}

// Session quality by hour (UTC)
function getSessionQuality(symbol: string): number {
  const hour = new Date().getUTCHours();
  
  // Crypto - always tradeable, slight preference for US hours
  if (symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('XRP') ||
      symbol.includes('SOL') || symbol.includes('ADA') || symbol.includes('BNB') ||
      symbol.includes('AVAX')) {
    return hour >= 14 && hour <= 22 ? 1.0 : 0.85;
  }
  
  // FX pairs
  if (symbol.includes('EUR') || symbol.includes('GBP') || symbol.includes('AUD') ||
      symbol.includes('USD') || symbol.includes('JPY') || symbol.includes('CHF')) {
    // London/NY overlap is best
    if (hour >= 13 && hour <= 16) return 1.0;
    // London session
    if (hour >= 7 && hour <= 16) return 0.9;
    // NY session
    if (hour >= 13 && hour <= 22) return 0.85;
    // Asia - okay for JPY
    if (hour >= 0 && hour <= 8) {
      return symbol.includes('JPY') ? 0.8 : 0.6;
    }
    return 0.4; // Off hours
  }
  
  // Stocks - only during market hours
  const stockSymbols = ['TSLA', 'AAPL', 'NVDA', 'META', 'MSFT', 'SPY', 'QQQ'];
  if (stockSymbols.some(s => symbol.includes(s))) {
    // NYSE hours: 14:30 - 21:00 UTC
    if (hour >= 14 && hour <= 21) return 1.0;
    // Pre/post market
    if (hour >= 13 || hour <= 22) return 0.5;
    return 0.1; // Market closed
  }
  
  // Gold (XAUUSD) - trades like FX
  if (symbol.includes('XAU')) {
    if (hour >= 13 && hour <= 16) return 1.0;
    if (hour >= 7 && hour <= 22) return 0.85;
    return 0.6;
  }
  
  return 0.7; // Default
}

function calculateSpreadScore(tick: PriceTick, symbol: string): number {
  const spread = tick.ask - tick.bid;
  const spreadPct = (spread / tick.mid) * 100;
  
  // Expected spreads by asset type (in %)
  const expectedSpreads: Record<string, number> = {
    crypto: 0.1,
    forex: 0.02,
    stock: 0.05,
    gold: 0.03
  };
  
  let expected = expectedSpreads.forex;
  if (symbol.includes('BTC') || symbol.includes('ETH')) expected = expectedSpreads.crypto;
  if (symbol.includes('XAU')) expected = expectedSpreads.gold;
  if (['TSLA', 'AAPL', 'NVDA', 'META', 'MSFT', 'SPY', 'QQQ'].some(s => symbol.includes(s))) {
    expected = expectedSpreads.stock;
  }
  
  // Score: 100 if at or below expected, decreasing as spread widens
  const ratio = spreadPct / expected;
  if (ratio <= 1) return 100;
  if (ratio <= 1.5) return 80;
  if (ratio <= 2) return 60;
  if (ratio <= 3) return 40;
  if (ratio <= 5) return 20;
  return 0; // Unacceptable spread
}

function calculateEnvironmentScore(env: EnvironmentSummary): number {
  let score = env.environmentConfidence * 50; // Base from confidence
  
  // Market state bonus
  switch (env.marketState) {
    case 'trend_clean': score += 30; break;
    case 'range_tradeable': score += 20; break;
    case 'trend_messy': score += 10; break;
    case 'range_trap': score -= 10; break;
    case 'chaos': score -= 30; break;
    case 'dead': score -= 40; break;
  }
  
  // Vol state adjustments
  switch (env.volState) {
    case 'expansion': score += 10; break;
    case 'compression': score += 5; break;
    case 'exhaustion': score -= 5; break;
    case 'spike': score -= 20; break;
  }
  
  // Liquidity
  switch (env.liquidityState) {
    case 'normal': score += 10; break;
    case 'thin': score -= 10; break;
    case 'broken': score -= 50; break;
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate tradeability score for a symbol
 * MORE PERMISSIVE - always returns tradeable unless critical issues
 */
export function calculateTradeability(
  symbol: string,
  tick: PriceTick,
  env: EnvironmentSummary,
  edge: EdgeSignal
): TradeabilityScore {
  const environmentScore = calculateEnvironmentScore(env);
  const edgeScore = edge.edgeScore;
  const spreadScore = calculateSpreadScore(tick, symbol);
  const sessionScore = getSessionQuality(symbol) * 100;
  
  // Weighted average - with minimum baseline
  const weights = {
    environment: 0.25,
    edge: 0.35,
    spread: 0.15,
    session: 0.25
  };
  
  const rawScore = 
    environmentScore * weights.environment +
    edgeScore * weights.edge +
    spreadScore * weights.spread +
    sessionScore * weights.session;
  
  // Add a baseline to ensure scores are never too low
  const score = Math.max(35, rawScore);
  
  // Much more permissive tradeability - only block on critical issues
  let isTradeable = true;
  let reason = 'Tradeable';
  
  // Only block if spread is completely broken (>5x expected)
  if (spreadScore === 0) {
    isTradeable = false;
    reason = 'Spread completely broken';
  } else if (env.liquidityState === 'broken') {
    isTradeable = false;
    reason = 'Liquidity broken';
  }
  // Otherwise, always consider tradeable - let entry logic decide
  
  return {
    symbol,
    score: Math.round(score),
    rank: 0, // Set after sorting
    components: {
      environmentScore: Math.round(environmentScore),
      edgeScore,
      spreadScore: Math.round(spreadScore),
      sessionScore: Math.round(sessionScore)
    },
    isTradeable,
    reason
  };
}

/**
 * Route and rank all markets
 * ALWAYS returns at least some candidates
 */
export function routeMarkets(
  symbols: string[],
  ticks: Record<string, PriceTick>,
  environments: Record<string, EnvironmentSummary>,
  edges: Record<string, EdgeSignal>,
  maxPrimaryCandidates: number = 5
): MarketRouterResult {
  const scores: TradeabilityScore[] = [];
  
  // Ensure we have symbols to work with
  const symbolsToCheck = symbols.length > 0 ? symbols : ['BTCUSDT', 'ETHUSDT', 'EURUSD'];
  
  for (const symbol of symbolsToCheck) {
    const tick = ticks[symbol];
    const env = environments[symbol];
    const edge = edges[symbol];
    
    if (!tick || !env || !edge) {
      // Still add to list but with lower score - don't completely exclude
      scores.push({
        symbol,
        score: 30, // Minimum score instead of 0
        rank: 0,
        components: {
          environmentScore: 30,
          edgeScore: 30,
          spreadScore: 50,
          sessionScore: 50
        },
        isTradeable: true, // Still consider tradeable if we have the symbol
        reason: 'Limited data - using defaults'
      });
      continue;
    }
    
    scores.push(calculateTradeability(symbol, tick, env, edge));
  }
  
  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  
  // Assign ranks
  scores.forEach((s, i) => s.rank = i + 1);
  
  // ALWAYS return at least some candidates
  let primaryCandidates = scores
    .filter(s => s.isTradeable)
    .slice(0, maxPrimaryCandidates)
    .map(s => s.symbol);
  
  // If no tradeable candidates, use top ranked anyway
  if (primaryCandidates.length === 0 && scores.length > 0) {
    primaryCandidates = scores.slice(0, Math.min(3, scores.length)).map(s => s.symbol);
  }
  
  const suppressedSymbols = scores
    .filter(s => !s.isTradeable)
    .map(s => s.symbol);
  
  return {
    rankings: scores,
    primaryCandidates,
    suppressedSymbols
  };
}

/**
 * Check if symbol should be considered for new trades
 */
export function shouldConsiderForEntry(
  symbol: string,
  routerResult: MarketRouterResult
): boolean {
  return routerResult.primaryCandidates.includes(symbol);
}
