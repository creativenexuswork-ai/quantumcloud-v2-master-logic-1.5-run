import { Brain, TrendingUp, Target, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessionStore, SessionStatus } from '@/lib/state/sessionMachine';

interface AIEngineStripProps {
  selectedMode?: string;
  marketRegime?: string;
  targetPct?: string;
  confidencePct?: number;
}

export function AIEngineStrip({ 
  marketRegime = 'analysing',
  targetPct,
  confidencePct,
}: AIEngineStripProps) {
  const { status } = useSessionStore();
  
  const regime = marketRegime.toLowerCase();
  const suggestedTp = targetPct || (regime === 'trending' ? '+2.5%' : regime === 'volatile' ? '+1.2%' : '+1.8%');
  const confidence = confidencePct ?? 78;

  const getStatusBadge = (s: SessionStatus) => {
    switch (s) {
      case 'running':
        return { label: 'Active', className: 'bg-emerald-500/20 text-emerald-300' };
      case 'holding':
        return { label: 'Holding', className: 'bg-amber-500/20 text-amber-300' };
      case 'error':
        return { label: 'Error', className: 'bg-red-500/20 text-red-300' };
      default:
        return { label: 'Idle', className: 'bg-slate-700/50 text-slate-400' };
    }
  };

  const statusBadge = getStatusBadge(status);

  return (
    <div className="flex items-center justify-between gap-2 text-xs text-slate-300 py-1 px-1">
      {/* Left: AI Engine + Status */}
      <div className="flex items-center gap-1.5">
        <Brain className="h-3.5 w-3.5 text-blue-400" />
        <span className="text-slate-400 text-[10px] font-medium">AI Engine</span>
        <span className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
          statusBadge.className
        )}>
          {statusBadge.label}
        </span>
      </div>

      {/* Center: Regime */}
      <div className="flex items-center gap-1">
        <TrendingUp className="h-3 w-3 text-slate-500" />
        <span className="text-slate-500 text-[10px]">Regime:</span>
        <span className="text-slate-200 text-[10px] font-medium capitalize">
          {regime === 'analysing' ? 'Analysing...' : regime}
        </span>
      </div>

      {/* Right: Target + Confidence */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Target className="h-3 w-3 text-slate-500" />
          <span className="text-emerald-400 text-[10px] font-mono font-medium">{suggestedTp}</span>
        </div>
        <div className="hidden sm:flex items-center gap-1">
          <Gauge className="h-3 w-3 text-slate-500" />
          <span className="text-slate-200 text-[10px] font-medium">{confidence}%</span>
        </div>
      </div>
    </div>
  );
}
