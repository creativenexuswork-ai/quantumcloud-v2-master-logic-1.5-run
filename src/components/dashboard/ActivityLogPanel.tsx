import { Clock, TrendingUp, TrendingDown, AlertCircle, PlayCircle, StopCircle } from 'lucide-react';
import { usePaperStats } from '@/hooks/usePaperTrading';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface LogEntry {
  id: string;
  time: Date;
  mode: string;
  action: string;
  result?: number;
  level: 'info' | 'warn' | 'error';
}

export function ActivityLogPanel() {
  const { data: paperData } = usePaperStats();
  
  // Convert system logs to display format
  const logs: LogEntry[] = (paperData?.logs || []).slice(0, 20).map((log) => ({
    id: log.id,
    time: new Date(log.created_at),
    mode: log.source || 'system',
    action: log.message,
    level: log.level as 'info' | 'warn' | 'error',
  }));

  // If no logs, show placeholder entries
  const displayLogs = logs.length > 0 ? logs : [
    { id: '1', time: new Date(), mode: 'system', action: 'Waiting for trading activity...', level: 'info' as const },
  ];

  const getIcon = (action: string, level: string) => {
    if (level === 'error') return <AlertCircle className="h-4 w-4 text-destructive" />;
    if (level === 'warn') return <AlertCircle className="h-4 w-4 text-warning" />;
    if (action.toLowerCase().includes('start')) return <PlayCircle className="h-4 w-4 text-success" />;
    if (action.toLowerCase().includes('stop') || action.toLowerCase().includes('close')) return <StopCircle className="h-4 w-4 text-destructive" />;
    if (action.toLowerCase().includes('profit') || action.toLowerCase().includes('win')) return <TrendingUp className="h-4 w-4 text-success" />;
    if (action.toLowerCase().includes('loss')) return <TrendingDown className="h-4 w-4 text-destructive" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <div className="glass-panel p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">Activity Log</h3>

      <div className="flex-1 overflow-auto custom-scrollbar space-y-2">
        {displayLogs.map((entry) => (
          <div
            key={entry.id}
            className={cn(
              "flex items-start gap-3 p-3 rounded-lg transition-colors",
              "bg-muted/20 hover:bg-muted/30"
            )}
          >
            {getIcon(entry.action, entry.level)}
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {entry.mode}
                </span>
                <span className="text-xs text-muted-foreground/50">
                  {format(entry.time, 'HH:mm:ss')}
                </span>
              </div>
              <p className="text-sm text-foreground truncate">{entry.action}</p>
            </div>

            {entry.result !== undefined && (
              <span className={cn(
                "font-mono text-sm font-medium shrink-0",
                entry.result >= 0 ? "profit-text" : "loss-text"
              )}>
                {entry.result >= 0 ? '+' : ''}${entry.result.toFixed(2)}
              </span>
            )}
          </div>
        ))}
      </div>

      {logs.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No activity yet. Start a trading session to see logs.</p>
        </div>
      )}
    </div>
  );
}
