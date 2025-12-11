import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { MarketViewPanel } from '@/components/dashboard/MarketViewPanel';
import { CockpitPanel } from '@/components/dashboard/CockpitPanel';
import { ModeSettingsPanel } from '@/components/dashboard/ModeSettingsPanel';
import { PerformancePanel } from '@/components/dashboard/PerformancePanel';
import { ActivityLogPanel } from '@/components/dashboard/ActivityLogPanel';
import { WatchlistPanel } from '@/components/dashboard/WatchlistPanel';
import { LiveTradingPanel } from '@/components/dashboard/LiveTradingPanel';
import { useSession } from '@/lib/state/session';
import { cn } from '@/lib/utils';

type ViewTab = 'trading' | 'live-setup';

export default function Dashboard() {
  const { accountType } = useSession();
  const [activeView, setActiveView] = useState<ViewTab>('trading');

  const showLiveSetup = accountType === 'live' || activeView === 'live-setup';

  return (
    <div className="min-h-screen bg-gradient-terminal">
      <Header />
      
      <main className="container mx-auto px-3 py-3">
        {/* View Tabs (for mobile/tablet) */}
        <div className="md:hidden mb-3 flex gap-2">
          <button
            onClick={() => setActiveView('trading')}
            className={cn(
              "flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors",
              activeView === 'trading' 
                ? "bg-primary text-primary-foreground" 
                : "bg-muted/30 text-muted-foreground"
            )}
          >
            Trading Console
          </button>
          <button
            onClick={() => setActiveView('live-setup')}
            className={cn(
              "flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors",
              activeView === 'live-setup' 
                ? "bg-primary text-primary-foreground" 
                : "bg-muted/30 text-muted-foreground"
            )}
          >
            Live Setup
          </button>
        </div>

        {showLiveSetup ? (
          <div className="max-w-2xl mx-auto animate-fade-in">
            <LiveTradingPanel />
            <button
              onClick={() => setActiveView('trading')}
              className="mt-4 w-full py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to Paper Trading Console
            </button>
          </div>
        ) : (
          <div className="space-y-2 animate-fade-in">
            {/* Cockpit - Compact, fits on mobile viewport */}
            <CockpitPanel />

            {/* Main Grid - Chart & Settings */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-7">
                <MarketViewPanel />
              </div>
              <div className="lg:col-span-5">
                <ModeSettingsPanel />
              </div>
            </div>

            {/* Lower Panels */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-5">
                <PerformancePanel />
              </div>
              <div className="lg:col-span-4">
                <ActivityLogPanel />
              </div>
              <div className="lg:col-span-3">
                <WatchlistPanel />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
