import { AlertTriangle, Link2Off, Server, Key, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function LiveTradingPanel() {
  return (
    <div className="glass-panel p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-warning/10">
          <AlertTriangle className="h-5 w-5 text-warning" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">Live Trading Setup</h3>
          <p className="text-sm text-muted-foreground">Configure broker connection</p>
        </div>
      </div>

      {/* Not Connected Banner */}
      <div className="p-4 rounded-lg bg-muted/30 border border-border/50 flex items-start gap-3">
        <Link2Off className="h-5 w-5 text-muted-foreground mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">Live Trading Not Connected</p>
          <p className="text-sm text-muted-foreground mt-1">
            In a future update, this panel will allow you to connect a broker 
            (API keys, account selection, etc.) to enable real live trading.
          </p>
        </div>
      </div>

      {/* Broker Selection (Disabled) */}
      <div className="space-y-4 opacity-50">
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Server className="h-4 w-4" />
            Broker
          </Label>
          <Select disabled>
            <SelectTrigger className="bg-muted/30 border-border/50">
              <SelectValue placeholder="Select broker..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="binance">Binance</SelectItem>
              <SelectItem value="bybit">Bybit</SelectItem>
              <SelectItem value="oanda">Oanda</SelectItem>
              <SelectItem value="interactive">Interactive Brokers</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Key className="h-4 w-4" />
            API Key
          </Label>
          <Input 
            type="password" 
            placeholder="Enter API key..." 
            disabled
            className="bg-muted/30 border-border/50"
          />
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="h-4 w-4" />
            Secret Key
          </Label>
          <Input 
            type="password" 
            placeholder="Enter secret key..." 
            disabled
            className="bg-muted/30 border-border/50"
          />
        </div>

        <Button disabled className="w-full">
          Connect Broker
        </Button>
      </div>

      {/* Future Feature Note */}
      <div className="text-center py-4">
        <p className="text-xs text-muted-foreground">
          🚧 Future feature — Paper trading is fully functional
        </p>
      </div>
    </div>
  );
}
