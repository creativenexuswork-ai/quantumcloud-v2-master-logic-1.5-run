import { TradingStatus } from '@/types/trading';
import { cn } from '@/lib/utils';

interface StatusPillProps {
  status: TradingStatus;
  className?: string;
}

const statusConfig: Record<TradingStatus, { label: string; className: string }> = {
  idle: { label: 'Idle', className: 'status-idle' },
  scanning: { label: 'Scanning', className: 'status-scanning' },
  in_trade: { label: 'In Trade', className: 'status-active' },
  burst_running: { label: 'Burst Running', className: 'status-active' },
  risk_paused: { label: 'Risk Paused', className: 'status-paused' },
  error: { label: 'Error', className: 'status-error' },
};

export function StatusPill({ status, className }: StatusPillProps) {
  const config = statusConfig[status];

  return (
    <span className={cn('status-pill', config.className, className)}>
      {status === 'scanning' && (
        <span className="inline-block w-2 h-2 rounded-full bg-primary mr-2 animate-pulse" />
      )}
      {config.label}
    </span>
  );
}
