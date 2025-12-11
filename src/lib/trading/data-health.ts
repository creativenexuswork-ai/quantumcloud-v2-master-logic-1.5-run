// ============= DATA HEALTH MONITOR v1.5 =============
// Market data source health tracking and failover management

export type DataSourceStatus = 'healthy' | 'degraded' | 'failed' | 'unknown';

export interface DataSourceHealth {
  source: 'finnhub' | 'twelvedata' | 'simulation';
  status: DataSourceStatus;
  lastSuccessTime: string | null;
  lastFailureTime: string | null;
  consecutiveFailures: number;
  averageLatencyMs: number;
  symbolsCovered: number;
}

export interface MarketDataHealth {
  overallStatus: DataSourceStatus;
  primarySource: DataSourceHealth;
  failoverSource: DataSourceHealth;
  simulationEnabled: boolean;
  shouldPauseTrading: boolean;
  message: string;
  lastCheckTime: string;
}

// Health state
const healthState: {
  finnhub: DataSourceHealth;
  twelvedata: DataSourceHealth;
  simulation: DataSourceHealth;
  latencyHistory: number[];
} = {
  finnhub: {
    source: 'finnhub',
    status: 'unknown',
    lastSuccessTime: null,
    lastFailureTime: null,
    consecutiveFailures: 0,
    averageLatencyMs: 0,
    symbolsCovered: 0
  },
  twelvedata: {
    source: 'twelvedata',
    status: 'unknown',
    lastSuccessTime: null,
    lastFailureTime: null,
    consecutiveFailures: 0,
    averageLatencyMs: 0,
    symbolsCovered: 0
  },
  simulation: {
    source: 'simulation',
    status: 'healthy', // Simulation is always available if enabled
    lastSuccessTime: null,
    lastFailureTime: null,
    consecutiveFailures: 0,
    averageLatencyMs: 0,
    symbolsCovered: 0
  },
  latencyHistory: []
};

const MAX_CONSECUTIVE_FAILURES = 5;
const DEGRADED_THRESHOLD = 2;
const MAX_LATENCY_HISTORY = 20;

/**
 * Record a successful data fetch from a source
 */
export function recordSuccess(
  source: 'finnhub' | 'twelvedata',
  latencyMs: number,
  symbolCount: number
): void {
  const health = healthState[source];
  health.lastSuccessTime = new Date().toISOString();
  health.consecutiveFailures = 0;
  health.status = 'healthy';
  health.symbolsCovered = symbolCount;
  
  // Update latency average
  healthState.latencyHistory.push(latencyMs);
  if (healthState.latencyHistory.length > MAX_LATENCY_HISTORY) {
    healthState.latencyHistory.shift();
  }
  health.averageLatencyMs = healthState.latencyHistory.reduce((a, b) => a + b, 0) / healthState.latencyHistory.length;
}

/**
 * Record a failed data fetch from a source
 */
export function recordFailure(
  source: 'finnhub' | 'twelvedata',
  errorMessage: string
): void {
  const health = healthState[source];
  health.lastFailureTime = new Date().toISOString();
  health.consecutiveFailures++;
  
  if (health.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    health.status = 'failed';
  } else if (health.consecutiveFailures >= DEGRADED_THRESHOLD) {
    health.status = 'degraded';
  }
  
  console.error(`[DATA_HEALTH] ${source} failure #${health.consecutiveFailures}: ${errorMessage}`);
}

/**
 * Check if a source should be used
 */
export function shouldUseSource(source: 'finnhub' | 'twelvedata'): boolean {
  const health = healthState[source];
  
  // Always try if unknown or healthy
  if (health.status === 'unknown' || health.status === 'healthy') {
    return true;
  }
  
  // Try degraded sources but be prepared for failover
  if (health.status === 'degraded') {
    return true;
  }
  
  // Failed sources - wait a bit before retrying
  if (health.status === 'failed' && health.lastFailureTime) {
    const timeSinceFailure = Date.now() - new Date(health.lastFailureTime).getTime();
    const retryAfterMs = 60000; // 1 minute
    return timeSinceFailure > retryAfterMs;
  }
  
  return false;
}

/**
 * Get the current market data health status
 */
export function getMarketDataHealth(simulationEnabled: boolean): MarketDataHealth {
  const finnhub = healthState.finnhub;
  const twelvedata = healthState.twelvedata;
  
  // Determine overall status
  let overallStatus: DataSourceStatus;
  let shouldPauseTrading = false;
  let message: string;
  
  if (finnhub.status === 'healthy' || twelvedata.status === 'healthy') {
    overallStatus = 'healthy';
    message = finnhub.status === 'healthy' 
      ? 'Live data from Finnhub' 
      : 'Live data from TwelveData (failover)';
  } else if (finnhub.status === 'degraded' || twelvedata.status === 'degraded') {
    overallStatus = 'degraded';
    message = 'Live data sources experiencing issues - trading with caution';
  } else if (simulationEnabled) {
    overallStatus = 'degraded';
    message = 'Using simulated prices (user-enabled simulation mode)';
  } else {
    overallStatus = 'failed';
    shouldPauseTrading = true;
    message = 'No live data available. Trading paused. Check API keys / provider status.';
  }
  
  return {
    overallStatus,
    primarySource: finnhub,
    failoverSource: twelvedata,
    simulationEnabled,
    shouldPauseTrading,
    message,
    lastCheckTime: new Date().toISOString()
  };
}

/**
 * Get preferred data source order
 */
export function getSourceOrder(): ('finnhub' | 'twelvedata')[] {
  const finnhubUsable = shouldUseSource('finnhub');
  const twelvedataUsable = shouldUseSource('twelvedata');
  
  // Prefer finnhub if both available
  if (finnhubUsable && twelvedataUsable) {
    const finnhubBetter = healthState.finnhub.status === 'healthy' ||
      (healthState.finnhub.status === 'degraded' && healthState.twelvedata.status !== 'healthy');
    
    return finnhubBetter ? ['finnhub', 'twelvedata'] : ['twelvedata', 'finnhub'];
  }
  
  if (finnhubUsable) return ['finnhub'];
  if (twelvedataUsable) return ['twelvedata'];
  
  return [];
}

/**
 * Reset health status for testing
 */
export function resetHealthState(): void {
  healthState.finnhub.status = 'unknown';
  healthState.finnhub.consecutiveFailures = 0;
  healthState.finnhub.lastSuccessTime = null;
  healthState.finnhub.lastFailureTime = null;
  
  healthState.twelvedata.status = 'unknown';
  healthState.twelvedata.consecutiveFailures = 0;
  healthState.twelvedata.lastSuccessTime = null;
  healthState.twelvedata.lastFailureTime = null;
  
  healthState.latencyHistory = [];
}

/**
 * Get health summary for logging
 */
export function getHealthSummary(): string {
  const finnhub = healthState.finnhub;
  const twelvedata = healthState.twelvedata;
  
  return `Finnhub: ${finnhub.status} (${finnhub.consecutiveFailures} fails) | TwelveData: ${twelvedata.status} (${twelvedata.consecutiveFailures} fails)`;
}
