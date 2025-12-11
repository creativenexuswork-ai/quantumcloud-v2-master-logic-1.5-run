import { useState, useEffect, useMemo } from 'react';
import { useSession } from '@/lib/state/session';

/**
 * Market Data Hook
 * 
 * ARCHITECTURE NOTE:
 * This hook currently returns dummy/static data for UI development.
 * 
 * FUTURE INTEGRATION:
 * - Option A: Read from `price_history` table populated by `price-feed` Edge Function
 * - Option B: Call an Edge Function that proxies external market API (Binance, etc.)
 * 
 * The hook interface will remain the same, only the data source changes.
 */

export interface OHLC {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketTick {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  lastUpdate: Date;
}

export interface MarketDataResult {
  symbol: string;
  tick: MarketTick | null;
  ohlcData: OHLC[];
  isLoading: boolean;
  error: string | null;
}

// Generate dummy OHLC data for chart
function generateDummyOHLC(basePrice: number, periods: number = 50): OHLC[] {
  const data: OHLC[] = [];
  let price = basePrice;
  const now = Date.now();
  
  for (let i = periods; i > 0; i--) {
    const volatility = 0.02;
    const change = (Math.random() - 0.5) * 2 * volatility * price;
    
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    const volume = Math.floor(Math.random() * 1000000) + 100000;
    
    data.push({
      time: now - i * 60000, // 1-minute candles
      open,
      high,
      low,
      close,
      volume,
    });
    
    price = close;
  }
  
  return data;
}

// Dummy market data for different symbols
const DUMMY_MARKETS: Record<string, { price: number; change: number }> = {
  'BTCUSDT': { price: 67432.50, change: 2.45 },
  'ETHUSDT': { price: 3521.80, change: 1.82 },
  'BNBUSDT': { price: 612.40, change: -0.65 },
  'SOLUSDT': { price: 178.25, change: 5.12 },
  'XRPUSDT': { price: 0.5234, change: -1.23 },
  'EURUSD': { price: 1.0892, change: 0.15 },
  'GBPUSD': { price: 1.2745, change: -0.22 },
  'USDJPY': { price: 154.32, change: 0.45 },
  'XAUUSD': { price: 2345.60, change: 0.85 },
};

export function useMarketData(symbolOverride?: string): MarketDataResult {
  const { selectedSymbol } = useSession();
  const symbol = symbolOverride || selectedSymbol || 'BTCUSDT';
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Simulate loading
  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => setIsLoading(false), 500);
    return () => clearTimeout(timer);
  }, [symbol]);

  // Generate market data
  const marketData = useMemo(() => {
    const baseData = DUMMY_MARKETS[symbol] || { price: 100, change: 0 };
    
    // Add slight randomness to simulate live data
    const jitter = (Math.random() - 0.5) * 0.001 * baseData.price;
    const price = baseData.price + jitter;
    const change = baseData.change;
    
    const tick: MarketTick = {
      symbol,
      price,
      change24h: price * (change / 100),
      changePercent24h: change,
      high24h: price * 1.025,
      low24h: price * 0.975,
      volume24h: Math.floor(Math.random() * 10000000000) + 1000000000,
      lastUpdate: new Date(),
    };
    
    const ohlcData = generateDummyOHLC(price);
    
    return { tick, ohlcData };
  }, [symbol]);

  return {
    symbol,
    tick: isLoading ? null : marketData.tick,
    ohlcData: isLoading ? [] : marketData.ohlcData,
    isLoading,
    error,
  };
}

// Hook to get all available markets for watchlist
export function useWatchlistMarkets() {
  const markets = useMemo(() => {
    return Object.entries(DUMMY_MARKETS).map(([symbol, data]) => ({
      symbol,
      price: data.price,
      change24h: data.change,
    }));
  }, []);
  
  return { markets, isLoading: false };
}
