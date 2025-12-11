export type TradingStatus = 'idle' | 'scanning' | 'in_trade' | 'burst_running' | 'risk_paused' | 'error';

export type MarketRegime = 'trend' | 'range' | 'high_vol' | 'low_vol' | 'news_risk';

export type ModeKey = 'sniper' | 'quantum' | 'burst' | 'trend' | 'swing' | 'news' | 'stealth' | 'memory';

export interface MarketData {
  symbol: string;
  currentPrice: number;
  change24h: number;
  volume24h: number;
  spread: number;
  regime: MarketRegime;
}

export interface TradingState {
  status: TradingStatus;
  activeMode: ModeKey | null;
  activeSymbol: string | null;
  regime: MarketRegime | null;
}

export const SUPPORTED_SYMBOLS = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', type: 'crypto' },
  { symbol: 'ETHUSDT', name: 'Ethereum', type: 'crypto' },
  { symbol: 'EURUSD', name: 'EUR/USD', type: 'forex' },
  { symbol: 'GBPUSD', name: 'GBP/USD', type: 'forex' },
  { symbol: 'NAS100', name: 'Nasdaq 100', type: 'index' },
  { symbol: 'SPX500', name: 'S&P 500', type: 'index' },
  { symbol: 'XAUUSD', name: 'Gold', type: 'metal' },
] as const;

export type SupportedSymbol = typeof SUPPORTED_SYMBOLS[number]['symbol'];
