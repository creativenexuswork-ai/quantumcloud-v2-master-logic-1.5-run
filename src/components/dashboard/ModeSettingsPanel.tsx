import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useFullSessionState } from '@/hooks/useSessionState';
import { useSessionStore, AutoTpMode } from '@/lib/state/sessionMachine';
import { cn } from '@/lib/utils';

export function ModeSettingsPanel() {
  const {
    selectedMode,
    riskSettings,
    updateRiskSettings,
    modeConfig,
    updateModeConfig,
  } = useFullSessionState();
  
  // Get Auto-TP state from session store
  const autoTpMode = useSessionStore((s) => s.autoTpMode);
  const autoTpValue = useSessionStore((s) => s.autoTpValue);
  const autoTpStopAfterHit = useSessionStore((s) => s.autoTpStopAfterHit);
  const dispatch = useSessionStore((s) => s.dispatch);

  const showBurstScalperControls = selectedMode === 'burst' || selectedMode === 'scalper';
  const showTrendControls = selectedMode === 'trend';
  
  // Handle Auto-TP mode change
  const handleAutoTpModeChange = (mode: AutoTpMode) => {
    dispatch({ type: 'SET_AUTO_TP_MODE', mode });
    // Set default value when switching modes
    if (mode === 'percent' && (autoTpValue === null || autoTpValue <= 0)) {
      dispatch({ type: 'SET_AUTO_TP_VALUE', value: 1 }); // Default 1%
    } else if (mode === 'cash' && (autoTpValue === null || autoTpValue <= 0)) {
      dispatch({ type: 'SET_AUTO_TP_VALUE', value: 20 }); // Default $20
    }
  };

  return (
    <div className="glass-panel p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
        Mode Settings
      </h3>

      {/* Mode-Specific Controls */}
      {showBurstScalperControls && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Trades/Run</Label>
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
      )}

      {showTrendControls && (
        <div className="grid grid-cols-2 gap-3">
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
      )}

      {/* Risk Controls */}
      <div className="space-y-3 pt-3 border-t border-border/30">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Risk</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground uppercase">Max DD: {riskSettings.maxDailyDrawdown}%</Label>
            <Slider
              value={[riskSettings.maxDailyDrawdown]}
              onValueChange={([v]) => updateRiskSettings({ maxDailyDrawdown: v })}
              min={1}
              max={10}
              step={0.5}
              className="py-1"
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
              className="py-1"
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
        </div>
      </div>
      
      {/* Auto-TP Controls */}
      <div className="space-y-3 pt-3 border-t border-border/30">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Auto Take Profit</h4>
        
        <div className="grid grid-cols-2 gap-3">
          {/* Auto-TP Mode Selector */}
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Mode</Label>
            <Select 
              value={autoTpMode} 
              onValueChange={(v: AutoTpMode) => handleAutoTpModeChange(v)}
            >
              <SelectTrigger className="h-8 bg-muted/30 border-border/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="percent">% of Equity</SelectItem>
                <SelectItem value="cash">Cash Amount</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Auto-TP Value - Percent Slider or Cash Input */}
          {autoTpMode === 'percent' && (
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground uppercase">Target: {autoTpValue || 1}%</Label>
              <Slider
                value={[autoTpValue || 1]}
                onValueChange={([v]) => dispatch({ type: 'SET_AUTO_TP_VALUE', value: v })}
                min={0.25}
                max={20}
                step={0.25}
                className="py-1"
              />
            </div>
          )}
          
          {autoTpMode === 'cash' && (
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Target ($)</Label>
              <Input
                type="number"
                value={autoTpValue || 20}
                onChange={(e) => dispatch({ type: 'SET_AUTO_TP_VALUE', value: parseFloat(e.target.value) || 0 })}
                className="h-8 bg-muted/30 border-border/50 text-sm"
                placeholder="20"
                min={1}
              />
            </div>
          )}
          
          {autoTpMode === 'off' && (
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Target</Label>
              <div className="h-8 flex items-center text-xs text-muted-foreground">Disabled</div>
            </div>
          )}
        </div>
        
        {/* Stop After TP Toggle - hidden when mode is off */}
        {autoTpMode !== 'off' && (
          <div className="flex items-center justify-between py-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Stop After TP</Label>
            <Switch
              checked={autoTpStopAfterHit}
              onCheckedChange={(checked) => dispatch({ type: 'SET_AUTO_TP_STOP_AFTER_HIT', stopAfterHit: checked })}
            />
          </div>
        )}
        
        {/* Helper text - conditional based on mode and stopAfterHit */}
        {autoTpMode === 'off' && (
          <p className="text-[9px] text-muted-foreground/70">
            Auto-TP is disabled for this run.
          </p>
        )}
        {autoTpMode !== 'off' && autoTpStopAfterHit && (
          <p className="text-[9px] text-muted-foreground/70">
            Stops the run after one Auto-TP hit at the selected target.
          </p>
        )}
        {autoTpMode !== 'off' && !autoTpStopAfterHit && (
          <p className="text-[9px] text-muted-foreground/70">
            Continuous mode: after each Auto-TP hit, the bot resets the baseline and continues trading.
          </p>
        )}
      </div>
    </div>
  );
}
