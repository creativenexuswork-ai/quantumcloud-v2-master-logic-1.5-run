import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePaperStats } from '@/hooks/usePaperTrading';

const modeColors: Record<string, string> = {
  sniper: 'bg-chart-1/20 text-chart-1',
  burst: 'bg-chart-2/20 text-chart-2',
  trend: 'bg-chart-3/20 text-chart-3',
  swing: 'bg-chart-4/20 text-chart-4',
  memory: 'bg-chart-5/20 text-chart-5',
  stealth: 'bg-primary/20 text-primary',
  news: 'bg-warning/20 text-warning',
  hybrid: 'bg-muted text-muted-foreground',
};

export function TradesTab() {
  const { data: paperData, isLoading } = usePaperStats();
  
  const positions = paperData?.positions || [];
  const trades = paperData?.trades || [];

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle>Trades & Positions</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="positions">
          <TabsList className="mb-4">
            <TabsTrigger value="positions">
              Open Positions ({positions.length})
            </TabsTrigger>
            <TabsTrigger value="history">
              Trade History ({trades.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="positions">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : positions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No open positions</div>
            ) : (
              <div className="max-h-[500px] overflow-auto scrollbar-hide">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">SL</TableHead>
                      <TableHead className="text-right">TP</TableHead>
                      <TableHead className="text-right">Unrealized P&L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((pos) => (
                      <TableRow key={pos.id}>
                        <TableCell className="font-mono font-medium">{pos.symbol}</TableCell>
                        <TableCell>
                          <Badge className={modeColors[pos.mode] || modeColors.hybrid}>
                            {pos.mode}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={pos.side === 'long' ? 'default' : 'destructive'}>
                            {pos.side.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{pos.size}</TableCell>
                        <TableCell className="text-right font-mono">${pos.entry_price.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono text-destructive">
                          ${pos.sl?.toFixed(2) || '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-success">
                          ${pos.tp?.toFixed(2) || '—'}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${
                          pos.unrealized_pnl >= 0 ? 'profit-text' : 'loss-text'
                        }`}>
                          {pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : trades.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No trade history</div>
            ) : (
              <div className="max-h-[500px] overflow-auto scrollbar-hide">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Closed At</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Exit</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(trade.closed_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono font-medium">{trade.symbol}</TableCell>
                        <TableCell>
                          <Badge className={modeColors[trade.mode] || modeColors.hybrid}>
                            {trade.mode}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={trade.side === 'long' ? 'default' : 'destructive'}>
                            {trade.side.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">${trade.entry_price.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono">${trade.exit_price.toFixed(2)}</TableCell>
                        <TableCell className={`text-right font-mono ${
                          trade.realized_pnl >= 0 ? 'profit-text' : 'loss-text'
                        }`}>
                          {trade.realized_pnl >= 0 ? '+' : ''}${trade.realized_pnl.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {trade.reason || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}