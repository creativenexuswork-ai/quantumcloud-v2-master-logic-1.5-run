import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Zap, DollarSign, X, Loader2 } from 'lucide-react';
import { useTradingSession, usePaperStats } from '@/hooks/usePaperTrading';
import { useSession } from '@/lib/state/session';
import { toast } from 'sonner';

export function BurstControlCard() {
  const { triggerBurst, takeBurstProfit, globalClose, tickInFlight } = useTradingSession();
  const { status, setStatus } = useSession();
  const isRunning = status === 'running';
  const { data: paperData, isLoading } = usePaperStats();
  
  const stats = paperData?.stats;
  const burstStatus = stats?.burstStatus || 'idle';
  const isLocked = burstStatus === 'locked';
  const isBurstRunning = burstStatus === 'running';

  const handleStartBurst = () => {
    setStatus('running');
    triggerBurst();
    toast.success('Burst triggered (Paper)');
  };

  const handleGlobalClose = () => {
    globalClose();
    setStatus('idle');
  };

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Burst Control
          </CardTitle>
          {isLocked && (
            <Badge className="bg-success/20 text-success">
              Target Reached
            </Badge>
          )}
          {isBurstRunning && (
            <Badge className="bg-warning/20 text-warning animate-pulse">
              Burst Running
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="metric-label">Burst P&L</p>
            <p className={`metric-value text-lg ${
              (stats?.burstPnlToday || 0) >= 0 ? 'profit-text' : 'loss-text'
            }`}>
              {isLoading ? '—' : `${(stats?.burstPnlToday || 0) >= 0 ? '+' : ''}${(stats?.burstPnlToday || 0).toFixed(2)}%`}
            </p>
          </div>
          <div className="text-center">
            <p className="metric-label">Bursts Today</p>
            <p className="metric-value text-lg">{isLoading ? '—' : stats?.burstsToday || 0}</p>
          </div>
          <div className="text-center">
            <p className="metric-label">Status</p>
            <p className={`text-sm font-medium ${
              isRunning ? 'text-success' :
              isLocked ? 'text-warning' : 'text-muted-foreground'
            }`}>
              {isRunning ? 'Running' : isLocked ? 'Locked' : 'Idle'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={handleStartBurst}
            disabled={isLocked || isRunning || tickInFlight}
            className="gap-2"
            size="sm"
          >
            {tickInFlight ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            Start Burst
          </Button>
          <Button
            onClick={takeBurstProfit}
            disabled={!isRunning || tickInFlight}
            variant="secondary"
            size="sm"
            className="gap-2"
          >
            <DollarSign className="h-4 w-4" />
            Take Profit
          </Button>
        </div>

        <Button
          onClick={handleGlobalClose}
          disabled={tickInFlight}
          variant="destructive"
          size="sm"
          className="w-full gap-2"
        >
          <X className="h-4 w-4" />
          Global Close (All Positions)
        </Button>
      </CardContent>
    </Card>
  );
}
