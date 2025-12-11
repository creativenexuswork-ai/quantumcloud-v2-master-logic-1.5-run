import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Settings2 } from 'lucide-react';
import { useModeConfigs, MODE_DEFINITIONS, ModeKey } from '@/hooks/useModeConfigs';
import { usePaperStats, usePaperConfig } from '@/hooks/usePaperTrading';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useState, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';

export function ModesTab() {
  const { data: modeConfigs, isLoading } = useModeConfigs();
  const { data: paperData } = usePaperStats();
  const { updateConfig } = usePaperConfig();
  const [enabledModes, setEnabledModes] = useState<string[]>([]);

  useEffect(() => {
    if (paperData?.config?.mode_config?.enabledModes) {
      setEnabledModes(paperData.config.mode_config.enabledModes);
    }
  }, [paperData?.config?.mode_config]);

  const toggleMode = async (modeKey: string, enabled: boolean) => {
    const newEnabledModes = enabled ? [...enabledModes, modeKey] : enabledModes.filter(m => m !== modeKey);
    setEnabledModes(newEnabledModes);
    try {
      await updateConfig.mutateAsync({
        mode_config: { enabledModes: newEnabledModes, modeSettings: paperData?.config?.mode_config?.modeSettings || {} },
      });
    } catch {
      setEnabledModes(enabledModes);
      toast({ title: 'Error', description: 'Failed to update mode.', variant: 'destructive' });
    }
  };

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Loading modes...</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Object.entries(MODE_DEFINITIONS).map(([key, definition]) => {
        const config = modeConfigs?.find(c => c.mode_key === key);
        const isEnabled = enabledModes.includes(key);
        return (
          <ModeCard key={key} modeKey={key as ModeKey} definition={definition} config={config}
            isEnabled={isEnabled} onToggle={(enabled) => toggleMode(key, enabled)} />
        );
      })}
    </div>
  );
}

interface ModeCardProps {
  modeKey: ModeKey;
  definition: typeof MODE_DEFINITIONS[ModeKey];
  config?: { enabled: boolean | null; risk_per_trade_pct: number | null; max_daily_loss_pct: number | null; max_daily_profit_pct: number | null; };
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

function ModeCard({ modeKey, definition, config, isEnabled, onToggle }: ModeCardProps) {
  const [riskPct] = useState(config?.risk_per_trade_pct || 1);

  return (
    <Card className={`glass-card-hover ${isEnabled ? 'ring-1 ring-primary/50' : 'opacity-75'}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{definition.icon}</span>
            <CardTitle className="text-base">{definition.name}</CardTitle>
          </div>
          <Switch checked={isEnabled} onCheckedChange={onToggle} />
        </div>
        <Badge variant="outline" className={`w-fit text-xs ${
          definition.risk === 'Safe' ? 'border-success text-success' :
          definition.risk === 'Aggressive' ? 'border-destructive text-destructive' : 'border-warning text-warning'
        }`}>{definition.risk}</Badge>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-xs mb-4">{definition.description}</CardDescription>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="w-full gap-2"><Settings2 className="h-4 w-4" />Configure</Button>
          </SheetTrigger>
          <SheetContent className="glass-card">
            <SheetHeader><SheetTitle className="flex items-center gap-2"><span>{definition.icon}</span>{definition.name} Settings</SheetTitle></SheetHeader>
            <div className="space-y-6 mt-6">
              <div className="space-y-2">
                <Label className="flex justify-between"><span>Risk per Trade</span><span className="text-muted-foreground">{riskPct}%</span></Label>
                <Slider value={[riskPct]} min={0.1} max={5} step={0.1} disabled />
              </div>
              <div className="space-y-2">
                <Label className="flex justify-between"><span>Max Daily Loss</span><span className="text-muted-foreground">{config?.max_daily_loss_pct || 5}%</span></Label>
                <Slider value={[config?.max_daily_loss_pct || 5]} min={1} max={10} step={0.5} disabled />
              </div>
              <Button className="w-full" disabled>Save Changes (Coming Soon)</Button>
            </div>
          </SheetContent>
        </Sheet>
      </CardContent>
    </Card>
  );
}