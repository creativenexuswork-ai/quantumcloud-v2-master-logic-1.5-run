import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useFullSessionState } from '@/hooks/useSessionState';
import { useSessionStore, STATUS_LABELS, STATUS_COLORS } from '@/lib/state/sessionMachine';
import { useSessionActions } from '@/hooks/useSessionActions';
import { cn } from '@/lib/utils';
import { ModeSelector } from './ModeSelector';
import { AIEngineStrip } from './AIEngineStrip';
import { ControlBar } from './ControlBar';

export function ModesControlPanel() {
  const {
    riskSettings,
    updateRiskSettings,
    modeConfig,
    updateModeConfig,
    todayPnl,
    tradesToday,
  } = useFullSessionState();

  const { status, mode, openCount, pendingAction } = useSessionStore();
  const { buttonStates, activate, holdToggle, takeProfit, closeAll, changeMode } = useSessionActions();

  // Only show controls for the 3 core modes
  const showBurstScalperControls = mode === 'burst' || mode === 'scalper';
  const showTrendControls = mode === 'trend';

  return (
    <div className="glass-panel p-4 space-y-4">
      {/* Mode Selector - 3 Core Modes */}
      <ModeSelector 
        selectedMode={mode} 
        onSelectMode={changeMode}
        status={status}
      />

      {/* AI Engine Strip */}
      <AIEngineStrip 
        selectedMode={mode}
        marketRegime="trending"
      />

      {/* Control Bar */}
      <ControlBar
        status={status}
        openPositionsCount={openCount}
        pendingAction={pendingAction}
        onActivate={activate}
        onTakeProfit={takeProfit}
        onHold={holdToggle}
        onCloseAll={closeAll}
      />

      {/* Session Status */}
      <div className="grid grid-cols-3 gap-3 p-2.5 rounded-xl bg-muted/20 border border-border/30">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Session</p>
          <p className={cn("font-semibold uppercase text-sm", STATUS_COLORS[status])}>
            {STATUS_LABELS[status]}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Today P&L</p>
          <p className={cn(
            "font-mono font-semibold text-sm",
            todayPnl >= 0 ? "profit-text" : "loss-text"
          )}>
            {todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Trades</p>
          <p className="font-semibold text-foreground text-sm">{tradesToday}</p>
        </div>
      </div>

      {/* Mode-Specific Controls */}
      {showBurstScalperControls && (
        <div className="space-y-3 pt-3 border-t border-border/30">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Mode Settings</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Trades per Run</Label>
              <Input
                type="number"
                value={modeConfig.burstTradesPerRun}
                onChange={(e) => updateModeConfig({ burstTradesPerRun: parseInt(e.target.value) || 20 })}
                className="h-8 bg-muted/30 border-border/50 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Max Concurrent</Label>
              <Input
                type="number"
                value={modeConfig.maxConcurrentPositions}
                onChange={(e) => updateModeConfig({ maxConcurrentPositions: parseInt(e.target.value) || 5 })}
                className="h-8 bg-muted/30 border-border/50 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Duration</Label>
              <Select 
                value={modeConfig.burstDuration} 
                onValueChange={(v: 'short' | 'medium' | 'long') => updateModeConfig({ burstDuration: v })}
              >
                <SelectTrigger className="h-8 bg-muted/30 border-border/50 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short">Short</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="long">Long</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">TP Style</Label>
              <Select 
                value={modeConfig.burstTpStyle} 
                onValueChange={(v: 'fast' | 'scaled') => updateModeConfig({ burstTpStyle: v })}
              >
                <SelectTrigger className="h-8 bg-muted/30 border-border/50 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">Fast TP</SelectItem>
                  <SelectItem value="scaled">Scaled TP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {showTrendControls && (
        <div className="space-y-3 pt-3 border-t border-border/30">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Mode Settings</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Timeframe</Label>
              <Select 
                value={modeConfig.trendTimeframe} 
                onValueChange={(v: 'intraday' | 'daily' | 'weekly') => updateModeConfig({ trendTimeframe: v })}
              >
                <SelectTrigger className="h-8 bg-muted/30 border-border/50 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="intraday">Intraday</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Sensitivity</Label>
              <Select 
                value={modeConfig.signalSensitivity} 
                onValueChange={(v: 'low' | 'medium' | 'high') => updateModeConfig({ signalSensitivity: v })}
              >
                <SelectTrigger className="h-8 bg-muted/30 border-border/50 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Risk HUD */}
      <div className="space-y-3 pt-3 border-t border-border/30">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Risk Controls</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground uppercase">Max Drawdown: {riskSettings.maxDailyDrawdown}%</Label>
            <Slider
              value={[riskSettings.maxDailyDrawdown]}
              onValueChange={([v]) => updateRiskSettings({ maxDailyDrawdown: v })}
              min={1}
              max={10}
              step={0.5}
              className="py-1.5"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground uppercase">Per-Trade: {riskSettings.maxPerTradeRisk}%</Label>
            <Slider
              value={[riskSettings.maxPerTradeRisk]}
              onValueChange={([v]) => updateRiskSettings({ maxPerTradeRisk: v })}
              min={0.25}
              max={3}
              step={0.25}
              className="py-1.5"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Position Sizing</Label>
            <Select 
              value={riskSettings.positionSizingMode} 
              onValueChange={(v: 'fixed' | 'percent' | 'volatility') => updateRiskSettings({ positionSizingMode: v })}
            >
              <SelectTrigger className="h-8 bg-muted/30 border-border/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed Size</SelectItem>
                <SelectItem value="percent">% of Equity</SelectItem>
                <SelectItem value="volatility">Vol Adjusted</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground uppercase">Auto TP: {riskSettings.dailyProfitTarget}%</Label>
            <Slider
              value={[riskSettings.dailyProfitTarget]}
              onValueChange={([v]) => updateRiskSettings({ dailyProfitTarget: v })}
              min={0.25}
              max={20}
              step={0.25}
              className="py-1.5"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
