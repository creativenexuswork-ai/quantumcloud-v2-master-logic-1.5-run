import { TrendingUp, TrendingDown, Target, Percent } from 'lucide-react';
import { useFullSessionState } from '@/hooks/useSessionState';
import { cn } from '@/lib/utils';

export function PerformancePanel() {
  const { equity, todayPnl, todayPnlPercent, tradesToday, winRate } = useFullSessionState();

  const avgRR = 1.5; // Placeholder - would come from stats

  // Generate dummy sparkline data
  const sparklineData = Array.from({ length: 20 }, (_, i) => {
    const base = todayPnl * (i / 20);
    const noise = (Math.random() - 0.5) * Math.abs(todayPnl) * 0.3;
    return base + noise;
  });

  const minVal = Math.min(...sparklineData, 0);
  const maxVal = Math.max(...sparklineData, 1);
  const range = maxVal - minVal || 1;

  const sparklinePoints = sparklineData.map((val, i) => {
    const x = (i / (sparklineData.length - 1)) * 100;
    const y = 100 - ((val - minVal) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  const isPositive = todayPnl >= 0;

  return (
    <div className="glass-panel p-4">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">Performance</h3>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            {isPositive ? (
              <TrendingUp className="h-4 w-4 text-success" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )}
            <span className="text-xs uppercase tracking-wider">Today's P&L</span>
          </div>
          <p className={cn(
            "font-mono text-xl font-bold",
            isPositive ? "profit-text" : "loss-text"
          )}>
            {isPositive ? '+' : ''}${todayPnl.toFixed(2)}
          </p>
          <p className={cn(
            "text-xs font-mono",
            isPositive ? "profit-text" : "loss-text"
          )}>
            {isPositive ? '+' : ''}{todayPnlPercent.toFixed(2)}%
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Target className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider">Trades</span>
          </div>
          <p className="font-mono text-xl font-bold text-foreground">{tradesToday}</p>
          <p className="text-xs text-muted-foreground">Today</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Percent className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider">Win Rate</span>
          </div>
          <p className={cn(
            "font-mono text-xl font-bold",
            winRate >= 50 ? "profit-text" : "text-foreground"
          )}>
            {winRate.toFixed(1)}%
          </p>
          <p className="text-xs text-muted-foreground">Overall</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider">Avg R:R</span>
          </div>
          <p className="font-mono text-xl font-bold text-foreground">{avgRR.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">R:R</p>
        </div>
      </div>

      {/* P&L Sparkline */}
      <div className="h-16 rounded-lg bg-muted/20 p-2 relative overflow-hidden">
        <svg className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="pnlGradient" x1="0%" y1="0%" x2="0%" y2="100%">
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
          
          {/* Zero line */}
          <line
            x1="0"
            y1={100 - ((0 - minVal) / range) * 100 + '%'}
            x2="100%"
            y2={100 - ((0 - minVal) / range) * 100 + '%'}
            stroke="hsl(220 30% 25%)"
            strokeWidth="1"
            strokeDasharray="4"
          />
          
          {/* Area fill */}
          <polygon
            points={`0,100 ${sparklinePoints} 100,100`}
            fill="url(#pnlGradient)"
          />
          
          {/* Line */}
          <polyline
            points={sparklinePoints}
            fill="none"
            stroke={isPositive ? "hsl(142 76% 45%)" : "hsl(0 84% 60%)"}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Labels */}
        <div className="absolute top-1 left-2 text-xs text-muted-foreground font-mono">
          P&L over time
        </div>
        <div className="absolute bottom-1 right-2 text-xs font-mono text-foreground">
          ${todayPnl.toFixed(2)}
        </div>
      </div>

      {/* Equity display */}
      <div className="mt-3 p-2.5 rounded-lg bg-muted/20 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Equity</span>
        <span className="font-mono text-sm font-semibold text-foreground">
          ${equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </span>
      </div>
    </div>
  );
}
