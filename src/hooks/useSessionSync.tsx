import { useEffect, useRef } from 'react';
import { usePaperStats } from './usePaperTrading';
import { useSessionStore } from '@/lib/state/sessionMachine';

/**
 * Hook to sync session data from backend paper-stats polling.
 * Syncs P&L, positions, stats.
 * Also syncs session status from backend IF it's a "terminal" state (idle/stopped)
 * to ensure Close All and Take Profit state changes are reflected.
 */
export function useSessionSync() {
  const { data: paperData, refetch } = usePaperStats();
  const dispatch = useSessionStore((state) => state.dispatch);
  const currentStatus = useSessionStore((state) => state.status);
  const lastStatusRef = useRef(currentStatus);

  useEffect(() => {
    if (!paperData) return;

    const { stats } = paperData;

    // Sync position data - this is purely informational
    if (stats) {
      const hasPositions = (stats.openPositionsCount || 0) > 0;
      const openCount = stats.openPositionsCount || 0;
      
      dispatch({ 
        type: 'SYNC_POSITIONS', 
        hasPositions, 
        openCount 
      });

      dispatch({
        type: 'SYNC_PNL',
        pnlToday: stats.todayPnl || 0,
        tradesToday: stats.tradesToday || 0,
        winRate: stats.winRate || 0,
        equity: stats.equity || 10000,
      });
    }

    // Sync session status from backend ONLY for terminal states (idle/stopped)
    // This ensures Close All properly stops the engine
    // Don't auto-start if backend says 'running' but frontend is idle
    const backendStatus = paperData.sessionStatus;
    if (backendStatus === 'idle' || backendStatus === 'stopped') {
      // If backend is idle/stopped, respect it (Close All was triggered)
      if (currentStatus === 'running' || currentStatus === 'holding') {
        console.log(`[SessionSync] Backend says ${backendStatus}, syncing from ${currentStatus}`);
        dispatch({ type: 'SYNC_STATUS', status: backendStatus });
      }
    }

    lastStatusRef.current = currentStatus;
  }, [paperData, dispatch, currentStatus]);

  return { paperData, refetch };
}
