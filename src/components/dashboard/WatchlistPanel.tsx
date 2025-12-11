import { TrendingUp, TrendingDown, Star } from 'lucide-react';
import { useSession } from '@/lib/state/session';
import { useWatchlistMarkets } from '@/hooks/useMarketData';
import { cn } from '@/lib/utils';

export function WatchlistPanel() {
  const { selectedSymbol, setSymbol } = useSession();
  const { markets } = useWatchlistMarkets();

  const formatPrice = (price: number) => {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };

  return (
    <div className="glass-panel p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Watchlist</h3>
        <Star className="h-3.5 w-3.5 text-muted-foreground" />
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar space-y-1">
        {markets.map((market) => {
          const isSelected = selectedSymbol === market.symbol;
          const isPositive = market.change24h >= 0;

          return (
            <button
              key={market.symbol}
              onClick={() => setSymbol(market.symbol)}
              className={cn(
                "w-full flex items-center justify-between p-3 rounded-lg transition-all",
                isSelected 
                  ? "bg-primary/10 border border-primary/30" 
                  : "bg-muted/20 hover:bg-muted/30 border border-transparent"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  isPositive ? "bg-success" : "bg-destructive"
                )} />
                <span className={cn(
                  "font-mono font-medium",
                  isSelected ? "text-foreground" : "text-muted-foreground"
                )}>
                  {market.symbol}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <span className="font-mono text-sm text-foreground">
                  ${formatPrice(market.price)}
                </span>
                <span className={cn(
                  "flex items-center gap-1 font-mono text-sm",
                  isPositive ? "profit-text" : "loss-text"
                )}>
                  {isPositive ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {isPositive ? '+' : ''}{market.change24h.toFixed(2)}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-border/30 text-xs text-muted-foreground text-center">
        Click to select active market
      </div>
    </div>
  );
}
