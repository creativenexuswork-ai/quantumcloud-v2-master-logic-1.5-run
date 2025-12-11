import { TrendingUp, TrendingDown, Activity, DollarSign, Target, Percent } from 'lucide-react';
import { useFullSessionState } from '@/hooks/useSessionState';
import { cn } from '@/lib/utils';

export function MarketViewPanel() {
  const { equity, todayPnl, todayPnlPercent, tradesToday, winRate } = useFullSessionState();

  const formatCurrency = (value: number) => {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const isPositive = todayPnl >= 0;

  // Generate equity series data based on current stats
  // This simulates equity progression over the session
  const equitySeriesData = Array.from({ length: 30 }, (_, i) => {
    const progress = i / 29;
    const baseEquity = equity - todayPnl; // Starting equity before today's P&L
    const currentPnl = todayPnl * progress;
    const noise = (Math.random() - 0.5) * Math.abs(todayPnl) * 0.15;
    return baseEquity + currentPnl + noise;
  });

  // Calculate chart bounds
  const minEquity = Math.min(...equitySeriesData);
  const maxEquity = Math.max(...equitySeriesData);
  const range = maxEquity - minEquity || 1;

  // Build SVG points for the equity line
  const chartPoints = equitySeriesData.map((val, i) => {
    const x = (i / (equitySeriesData.length - 1)) * 100;
    const y = 100 - ((val - minEquity) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  const areaPoints = `0,100 ${chartPoints} 100,100`;

  return (
    <div className="glass-panel p-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Performance</h3>
        
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Equity:</span>
            <span className="font-mono font-medium text-foreground">
              ${formatCurrency(equity)}
            </span>
          </div>
          <div className={cn(
            "flex items-center gap-1 font-mono font-medium",
            isPositive ? "text-success" : "text-destructive"
          )}>
            {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {isPositive ? '+' : ''}{todayPnlPercent.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Chart Area */}
      <div className="flex-1 min-h-[200px] rounded-lg bg-muted/20 chart-grid relative overflow-hidden">
        <div className="absolute inset-0 p-4">
          {/* Equity line visualization */}
          <svg className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="equityGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop 
                  offset="0%" 
                  stopColor={isPositive ? "hsl(142 76% 45%)" : "hsl(0 84% 60%)"} 
                  stopOpacity="0.3" 
                />
                <stop 
                  offset="100%" 
                  stopColor={isPositive ? "hsl(142 76% 45%)" : "hsl(0 84% 60%)"} 
                  stopOpacity="0" 
                />
              </linearGradient>
            </defs>
            
            {/* Area fill */}
            <polygon
              points={areaPoints}
              fill="url(#equityGradient)"
            />
            
            {/* Main equity line */}
            <polyline
              points={chartPoints}
              fill="none"
              stroke={isPositive ? "hsl(142 76% 45%)" : "hsl(0 84% 60%)"}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Chart labels */}
          <div className="absolute top-2 left-2 text-xs text-muted-foreground font-mono">
            Max: ${formatCurrency(maxEquity)}
          </div>
          <div className="absolute bottom-2 left-2 text-xs text-muted-foreground font-mono">
            Min: ${formatCurrency(minEquity)}
          </div>
          <div className="absolute top-2 right-2 text-xs text-muted-foreground">
            Equity Over Time
          </div>
        </div>
      </div>

      {/* Bottom Stats */}
      <div className="mt-3 grid grid-cols-4 gap-3">
        <div>
          <p className="metric-label">Today P&L</p>
          <p className={cn(
            "font-mono text-sm font-semibold",
            isPositive ? "profit-text" : "loss-text"
          )}>
            {isPositive ? '+' : ''}${formatCurrency(todayPnl)}
          </p>
        </div>
        <div>
          <p className="metric-label">Equity</p>
          <p className="font-mono text-sm font-medium text-foreground">
            ${formatCurrency(equity)}
          </p>
        </div>
        <div>
          <p className="metric-label">Win Rate</p>
          <p className={cn(
            "font-mono text-sm font-medium",
            winRate >= 50 ? "profit-text" : "text-muted-foreground"
          )}>
            {winRate.toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="metric-label">Trades</p>
          <p className="font-mono text-sm font-medium text-muted-foreground">
            {tradesToday}
          </p>
        </div>
      </div>
    </div>
  );
}
