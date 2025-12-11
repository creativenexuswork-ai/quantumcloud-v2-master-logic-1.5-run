import { Zap, Crosshair, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TradingMode, SessionStatus } from '@/lib/state/sessionMachine';
import { toast } from '@/hooks/use-toast';

interface ModeSelectorProps {
  selectedMode: TradingMode;
  onSelectMode: (mode: TradingMode) => void;
  status: SessionStatus;
}

const CORE_MODES: { key: TradingMode; label: string; icon: typeof Zap; description: string }[] = [
  { 
    key: 'burst', 
    label: 'BURST', 
    icon: Zap,
    description: 'Rapid micro-trades for quick profits'
  },
  { 
    key: 'scalper', 
    label: 'SCALPER', 
    icon: Crosshair,
    description: 'Precision entries with tight stops'
  },
  { 
    key: 'trend', 
    label: 'TREND', 
    icon: TrendingUp,
    description: 'Follow momentum for larger gains'
  },
];

export function ModeSelector({ selectedMode, onSelectMode, status }: ModeSelectorProps) {
  // Can only change mode when idle or stopped
  const canChangeMode = status === 'idle' || status === 'stopped';

  const handleModeChange = (mode: TradingMode) => {
    if (!canChangeMode) {
      toast({
        title: 'Mode Locked',
        description: 'Stop the engine before changing mode.',
        variant: 'default',
      });
      return;
    }
    onSelectMode(mode);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Trading Mode
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {CORE_MODES.map(({ key, label, icon: Icon, description }) => {
          const isSelected = selectedMode === key;
          return (
            <button
              key={key}
              onClick={() => handleModeChange(key)}
              disabled={!canChangeMode && !isSelected}
              className={cn(
                "mode-card group relative",
                isSelected && "mode-card-active",
                !canChangeMode && !isSelected && "opacity-50 cursor-not-allowed"
              )}
            >
              {isSelected && (
                <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary/20 text-primary">
                  ACTIVE
                </span>
              )}
              <Icon className={cn(
                "h-5 w-5 mb-2 transition-colors",
                isSelected ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
              )} />
              <span className={cn(
                "text-sm font-semibold tracking-wide",
                isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
              )}>
                {label}
              </span>
              <span className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                {description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
