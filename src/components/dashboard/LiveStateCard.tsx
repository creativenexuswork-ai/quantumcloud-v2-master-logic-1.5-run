import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Square, Loader2 } from 'lucide-react';
import { useTradingSession, usePaperStats } from '@/hooks/usePaperTrading';
import { useSession } from '@/lib/state/session';

const regimeColors: Record<string, string> = {
  trend: 'bg-success/20 text-success',
  range: 'bg-warning/20 text-warning',
  high_vol: 'bg-destructive/20 text-destructive',
  low_vol: 'bg-muted text-muted-foreground',
  news_risk: 'bg-primary/20 text-primary',
};

export function LiveStateCard() {
  const { startSession, stopSession, halted, tickInFlight } = useTradingSession();
  const { status } = useSession();
  const isRunning = status === 'running';
  const { data: paperData } = usePaperStats();
  
  const config = paperData?.config;
  const enabledModes = config?.mode_config?.enabledModes || [];
  const selectedSymbols = config?.market_config?.selectedSymbols || [];
  const openPositions = paperData?.stats?.openPositionsCount || 0;

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Live State & Mode</CardTitle>
          {halted && (
            <Badge variant="destructive">Trading Halted</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {enabledModes.length > 0 ? (
              <div>
                <p className="font-medium capitalize">{enabledModes.join(', ')}</p>
                <Badge variant="outline" className="text-xs">
                  {enabledModes.length} mode(s) enabled
                </Badge>
              </div>
            ) : (
              <p className="text-muted-foreground">No modes enabled</p>
            )}
          </div>
          {isRunning && (
            <Badge className="bg-success/20 text-success animate-pulse">
              {tickInFlight ? 'Ticking...' : 'Session Active'}
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Symbols</span>
            <span className="font-mono font-medium text-sm">
              {selectedSymbols.length > 0 ? selectedSymbols.slice(0, 3).join(', ') : 'None'}
              {selectedSymbols.length > 3 && ` +${selectedSymbols.length - 3}`}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Open Positions</span>
            <span className="font-medium">{openPositions}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Status</span>
            <span className={`text-sm font-medium ${
              isRunning ? 'text-success animate-pulse' :
              halted ? 'text-destructive' :
              'text-muted-foreground'
            }`}>
              {halted ? 'HALTED' : isRunning ? 'RUNNING' : 'IDLE'}
            </span>
          </div>
        </div>

        {enabledModes.length > 0 && isRunning && (
          <p className="text-xs text-muted-foreground">
            Engine running {enabledModes.length} mode(s) on {selectedSymbols.length} symbol(s)
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <Button 
            onClick={startSession}
            disabled={isRunning || halted || enabledModes.length === 0}
            className="flex-1 gap-2"
          >
            {tickInFlight ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isRunning ? 'Running...' : 'Start Session'}
          </Button>
          <Button 
            onClick={stopSession}
            disabled={!isRunning}
            variant="destructive"
            className="flex-1 gap-2"
          >
            <Square className="h-4 w-4" />
            Stop Session
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
