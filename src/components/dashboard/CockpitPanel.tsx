import { useState } from 'react';
import { Zap, Crosshair, TrendingUp, Brain, Loader2, Power, DollarSign, Pause, XCircle, Play, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  useSessionStore, 
  TradingMode,
  STATUS_LABELS,
  STATUS_COLORS 
} from '@/lib/state/sessionMachine';
import { useSessionActions } from '@/hooks/useSessionActions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const MODES: { key: TradingMode; label: string; icon: typeof Zap }[] = [
  { key: 'burst', label: 'Burst', icon: Zap },
  { key: 'scalper', label: 'Scalper', icon: Crosshair },
  { key: 'trend', label: 'Trend', icon: TrendingUp },
];

// Status badge colors
const STATUS_BG: Record<string, string> = {
  idle: 'bg-muted/50 text-muted-foreground',
  running: 'bg-emerald-500/20 text-emerald-400',
  holding: 'bg-amber-500/20 text-amber-300',
  stopped: 'bg-muted/50 text-muted-foreground',
  error: 'bg-destructive/20 text-destructive',
};

export function CockpitPanel() {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  
  const { 
    status, 
    mode, 
    pnlToday, 
    tradesToday, 
    openCount, 
    pendingAction,
    lastError,
  } = useSessionStore();
  
  const { buttonStates, activate, holdToggle, takeProfit, closeAll, changeMode, resetSession } = useSessionActions();
  const { canActivate, canHold, canTakeProfit, canCloseAll, canChangeMode, showSpinner } = buttonStates;
  
  const isHolding = status === 'holding';
  const isRunning = status === 'running';
  const isIdle = status === 'idle' || status === 'stopped';
  const isResetPending = pendingAction === ('reset' as any);
  const canReset = isIdle && !pendingAction;
  
  const handleResetConfirm = async () => {
    setShowResetConfirm(false);
    await resetSession();
  };

  return (
    <div className="glass-panel p-3 space-y-3">
      {/* ROW 1: Status + AI + Mini Stats */}
      <div className="flex items-center justify-between gap-2">
        {/* Left: Status + AI */}
        <div className="flex items-center gap-2">
          <span className={cn(
            "px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wide",
            STATUS_BG[status]
          )}>
            {STATUS_LABELS[status]}
          </span>
          
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Brain className="h-3 w-3" />
            <span>AI:</span>
            <span className={cn(
              "font-medium",
              isRunning || isHolding ? "text-emerald-400" : "text-muted-foreground"
            )}>
              {isRunning || isHolding ? 'active' : 'idle'}
            </span>
          </div>
        </div>
        
        {/* Right: Mini Stats */}
        <div className="flex items-center gap-3 text-[11px]">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">P&L:</span>
            <span className={cn(
              "font-mono font-semibold",
              pnlToday >= 0 ? "text-success" : "text-destructive"
            )}>
              {pnlToday >= 0 ? '+' : ''}${pnlToday.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Trades:</span>
            <span className="font-mono font-medium text-foreground">{tradesToday}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Open:</span>
            <span className="font-mono font-medium text-foreground">{openCount}</span>
          </div>
        </div>
      </div>

      {/* ROW 2: Mode Pills */}
      <div className="flex items-center gap-2">
        {MODES.map(({ key, label, icon: Icon }) => {
          const isSelected = mode === key;
          const isLocked = !canChangeMode;
          return (
            <button
              key={key}
              onClick={() => changeMode(key)}
              disabled={isLocked && !isSelected}
              className={cn(
                "flex-1 py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 text-xs font-medium transition-all border",
                isSelected 
                  ? "bg-primary/20 border-primary/50 text-primary" 
                  : "bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50",
                (isLocked && !isSelected) && "opacity-50 cursor-not-allowed"
              )}
            >
              <Icon className="h-3 w-3" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* ROW 3: Control Buttons - 5 in a row */}
      <div className="grid grid-cols-5 gap-2">
        {/* ACTIVATE */}
        <button
          onClick={activate}
          disabled={!canActivate}
          className={cn(
            "h-9 rounded-lg flex items-center justify-center gap-1 text-[11px] font-semibold transition-all",
            canActivate
              ? "bg-primary hover:bg-primary/90 text-primary-foreground" 
              : "bg-muted/30 text-muted-foreground cursor-not-allowed"
          )}
        >
          {pendingAction === 'activate' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Power className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">Activate</span>
        </button>

        {/* HOLD */}
        <button
          onClick={holdToggle}
          disabled={!canHold}
          className={cn(
            "h-9 rounded-lg flex items-center justify-center gap-1 text-[11px] font-semibold transition-all border",
            !canHold
              ? "bg-muted/20 border-transparent text-muted-foreground cursor-not-allowed" 
              : isHolding 
                ? "bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30" 
                : "bg-muted/30 border-transparent text-foreground hover:bg-muted/50"
          )}
        >
          {pendingAction === 'hold' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isHolding ? (
            <Play className="h-3 w-3" />
          ) : (
            <Pause className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">{isHolding ? 'Resume' : 'Hold'}</span>
        </button>

        {/* TAKE PROFIT */}
        <button
          onClick={takeProfit}
          disabled={!canTakeProfit}
          className={cn(
            "h-9 rounded-lg flex items-center justify-center gap-1 text-[11px] font-semibold transition-all",
            canTakeProfit
              ? "bg-success hover:bg-success/90 text-white" 
              : "bg-muted/30 text-muted-foreground cursor-not-allowed"
          )}
        >
          {pendingAction === 'takeProfit' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <DollarSign className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">Take Profit</span>
        </button>

        {/* CLOSE ALL */}
        <button
          onClick={closeAll}
          disabled={!canCloseAll}
          className={cn(
            "h-9 rounded-lg flex items-center justify-center gap-1 text-[11px] font-semibold transition-all",
            canCloseAll
              ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" 
              : "bg-muted/30 text-muted-foreground cursor-not-allowed"
          )}
        >
          {pendingAction === 'closeAll' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">Close All</span>
        </button>

        {/* RESTART SESSION */}
        <button
          onClick={() => setShowResetConfirm(true)}
          disabled={!canReset}
          className={cn(
            "h-9 rounded-lg flex items-center justify-center gap-1 text-[11px] font-semibold transition-all border",
            canReset
              ? "bg-muted/30 border-border/50 text-foreground hover:bg-muted/50" 
              : "bg-muted/20 border-transparent text-muted-foreground cursor-not-allowed"
          )}
        >
          {isResetPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">Restart</span>
        </button>
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart Session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset today's P&L tracking and archive current trades. You'll start with a clean slate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetConfirm}>
              Restart Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Error message if present */}
      {lastError && status === 'error' && (
        <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5 text-center">
          {lastError}
        </div>
      )}
    </div>
  );
}
