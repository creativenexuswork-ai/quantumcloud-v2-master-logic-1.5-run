import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePaperStats } from '@/hooks/usePaperTrading';

export function EquityCard() {
  const [range, setRange] = useState<'7d' | '30d'>('7d');
  const { data: paperData, isLoading } = usePaperStats();

  const stats = paperData?.stats;
  const historicalStats = paperData?.historicalStats || [];

  // Filter based on range
  const daysToShow = range === '7d' ? 7 : 30;
  const filteredHistory = historicalStats.slice(-daysToShow);

  const chartData = filteredHistory.map(s => ({
    date: new Date(s.trade_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    equity: s.equity_end,
  }));

  // Add current equity if no history
  if (chartData.length === 0 && stats) {
    chartData.push({
      date: 'Now',
      equity: stats.equity,
    });
  }

  return (
    <Card className="glass-card col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold">Equity & Performance</CardTitle>
        <Tabs value={range} onValueChange={(v) => setRange(v as '7d' | '30d')}>
          <TabsList className="h-8">
            <TabsTrigger value="7d" className="text-xs px-3">7D</TabsTrigger>
            <TabsTrigger value="30d" className="text-xs px-3">30D</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <div className="h-48 mb-4">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Loading chart...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="date" 
                  axisLine={false} 
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: 'hsl(var(--card-foreground))' }}
                  formatter={(value: number) => [`$${value.toLocaleString()}`, 'Equity']}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#equityGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div>
            <p className="metric-label">Today</p>
            <p className={`metric-value text-lg ${(stats?.todayPnlPercent || 0) >= 0 ? 'profit-text' : 'loss-text'}`}>
              {(stats?.todayPnlPercent || 0) >= 0 ? '+' : ''}{(stats?.todayPnlPercent || 0).toFixed(2)}%
            </p>
          </div>
          <div>
            <p className="metric-label">Win Rate</p>
            <p className="metric-value text-lg">{(stats?.winRate || 0).toFixed(1)}%</p>
          </div>
          <div>
            <p className="metric-label">Avg R:R</p>
            <p className="metric-value text-lg">{(stats?.avgRR || 1.5).toFixed(1)}</p>
          </div>
          <div>
            <p className="metric-label">Trades Today</p>
            <p className="metric-value text-lg">{stats?.tradesToday || 0}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}