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
  { symbol: 'BTCUSD', name: 'Bitcoin', type: 'crypto' },
  { symbol: 'ETHUSD', name: 'Ethereum', type: 'crypto' },
] as const;

export type SupportedSymbol = typeof SUPPORTED_SYMBOLS[number]['symbol'];
