import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useSymbols, usePaperConfig, usePaperStats } from '@/hooks/usePaperTrading';
import { useSession } from '@/lib/state/session';
import { useState, useEffect } from 'react';

const typeColors: Record<string, string> = {
  crypto: 'bg-chart-1/20 text-chart-1',
  forex: 'bg-chart-2/20 text-chart-2',
  index: 'bg-chart-3/20 text-chart-3',
  metal: 'bg-chart-4/20 text-chart-4',
};

export function MarketsTab() {
  const { selectedSymbol, setSymbol } = useSession();
  const { data: symbols, isLoading } = useSymbols();
  const { data: paperData } = usePaperStats();
  const { updateConfig } = usePaperConfig();
  
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [typeFilters, setTypeFilters] = useState<Record<string, boolean>>({
    crypto: true, forex: true, index: true, metal: true,
  });

  useEffect(() => {
    if (paperData?.config?.market_config) {
      const mc = paperData.config.market_config;
      if (mc.selectedSymbols) setSelectedSymbols(mc.selectedSymbols);
      if (mc.typeFilters) setTypeFilters(mc.typeFilters);
    }
  }, [paperData?.config?.market_config]);

  const handleSymbolToggle = (symbol: string) => {
    const newSelected = selectedSymbols.includes(symbol)
      ? selectedSymbols.filter(s => s !== symbol)
      : [...selectedSymbols, symbol];
    setSelectedSymbols(newSelected);
    updateConfig.mutate({ market_config: { selectedSymbols: newSelected, typeFilters } });
  };

  const handleTypeFilterToggle = (type: string) => {
    const newFilters = { ...typeFilters, [type]: !typeFilters[type] };
    setTypeFilters(newFilters);
    updateConfig.mutate({ market_config: { selectedSymbols, typeFilters: newFilters } });
  };

  const handleSelectSymbol = (symbol: string) => {
    setSymbol(symbol);
  };

  const filteredSymbols = symbols?.filter(s => typeFilters[s.type]) || [];

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Loading markets...</div>;

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Market Watchlist</CardTitle>
          <div className="flex gap-2">
            {Object.entries(typeFilters).map(([type, enabled]) => (
              <Badge key={type} variant={enabled ? 'default' : 'outline'}
                className={`cursor-pointer ${enabled ? typeColors[type] : ''}`}
                onClick={() => handleTypeFilterToggle(type)}>
                {type.toUpperCase()}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Trade</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSymbols.map((market) => (
              <TableRow key={market.id} className={selectedSymbol === market.symbol ? 'bg-primary/5' : ''}>
                <TableCell>
                  <Checkbox checked={selectedSymbols.includes(market.symbol)} onCheckedChange={() => handleSymbolToggle(market.symbol)} />
                </TableCell>
                <TableCell className="font-mono font-medium">{market.symbol}</TableCell>
                <TableCell>{market.name}</TableCell>
                <TableCell><Badge className={typeColors[market.type]}>{market.type.toUpperCase()}</Badge></TableCell>
                <TableCell>
                  <Button size="sm" variant={selectedSymbol === market.symbol ? 'secondary' : 'outline'}
                    onClick={() => handleSelectSymbol(market.symbol)}>
                    {selectedSymbol === market.symbol ? 'Active' : 'Select'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
