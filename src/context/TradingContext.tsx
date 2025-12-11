import { createContext, useContext, useState, ReactNode } from 'react';
import { TradingState, TradingStatus, ModeKey, MarketRegime } from '@/types/trading';

interface TradingContextType {
  tradingState: TradingState;
  setStatus: (status: TradingStatus) => void;
  setActiveMode: (mode: ModeKey | null) => void;
  setActiveSymbol: (symbol: string | null) => void;
  setRegime: (regime: MarketRegime | null) => void;
  startMode: (mode: ModeKey, symbol: string) => void;
  stopMode: () => void;
}

const TradingContext = createContext<TradingContextType | undefined>(undefined);

export function TradingProvider({ children }: { children: ReactNode }) {
  const [tradingState, setTradingState] = useState<TradingState>({
    status: 'idle',
    activeMode: null,
    activeSymbol: 'BTCUSDT',
    regime: null,
  });

  const setStatus = (status: TradingStatus) => {
    setTradingState(prev => ({ ...prev, status }));
  };

  const setActiveMode = (mode: ModeKey | null) => {
    setTradingState(prev => ({ ...prev, activeMode: mode }));
  };

  const setActiveSymbol = (symbol: string | null) => {
    setTradingState(prev => ({ ...prev, activeSymbol: symbol }));
  };

  const setRegime = (regime: MarketRegime | null) => {
    setTradingState(prev => ({ ...prev, regime }));
  };

  const startMode = (mode: ModeKey, symbol: string) => {
    setTradingState({
      status: 'scanning',
      activeMode: mode,
      activeSymbol: symbol,
      regime: null,
    });
  };

  const stopMode = () => {
    setTradingState(prev => ({
      ...prev,
      status: 'idle',
      activeMode: null,
    }));
  };

  return (
    <TradingContext.Provider
      value={{
        tradingState,
        setStatus,
        setActiveMode,
        setActiveSymbol,
        setRegime,
        startMode,
        stopMode,
      }}
    >
      {children}
    </TradingContext.Provider>
  );
}

export function useTrading() {
  const context = useContext(TradingContext);
  if (context === undefined) {
    throw new Error('useTrading must be used within a TradingProvider');
  }
  return context;
}
