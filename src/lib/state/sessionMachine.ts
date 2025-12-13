import { create } from 'zustand';

// ============== Session State Types ==============
export type SessionStatus = 'idle' | 'running' | 'holding' | 'stopped' | 'error';
export type TradingMode = 'burst' | 'scalper' | 'trend';
export type AccountType = 'paper' | 'live';

// pendingAction is set ONLY during explicit user actions, NOT during polling
export type PendingAction = 'activate' | 'hold' | 'takeProfit' | 'closeAll' | 'restart' | null;

// Auto-TP mode types (only 3: off, percent, cash)
export type AutoTpMode = 'off' | 'percent' | 'cash';

export interface SessionState {
  status: SessionStatus;
  mode: TradingMode;
  accountType: AccountType;
  hasPositions: boolean;
  openCount: number;
  pnlToday: number;
  tradesToday: number;
  winRate: number;
  equity: number;
  lastError: string | null;
  // pendingAction: set only during user-initiated transitions (not polling)
  pendingAction: PendingAction;
  
  // ============== Run Lifecycle State ==============
  // These control the run lifecycle and Auto-TP behavior
  runId: string | null;           // Unique identifier for current run (timestamp-based)
  runActive: boolean;             // Whether a run is currently active (controls trade entry)
  autoTpFired: boolean;           // Whether Auto-TP has fired for this run (one-shot)
  autoTpBaselineEquity: number | null;  // Equity at run start (baseline for TP calculation)
  autoTpTargetEquity: number | null;    // Target equity for Auto-TP trigger
  
  // ============== Auto-TP Configuration ==============
  autoTpMode: AutoTpMode;         // 'off' | 'percent' | 'cash'
  autoTpValue: number | null;     // For percent: % value (e.g. 1 = 1%). For cash: currency amount
  autoTpStopAfterHit: boolean;    // true = stop after TP, false = infinite mode (auto restart)
}

export interface ButtonStates {
  canActivate: boolean;
  canHold: boolean;
  canTakeProfit: boolean;
  canCloseAll: boolean;
  canChangeMode: boolean;
  showSpinner: boolean;
}

// ============== Pure Helper Functions ==============

export function getInitialSessionState(): SessionState {
  return {
    status: 'idle',
    mode: 'burst',
    accountType: 'paper',
    hasPositions: false,
    openCount: 0,
    pnlToday: 0,
    tradesToday: 0,
    winRate: 0,
    equity: 10000,
    lastError: null,
    pendingAction: null,
    // Run lifecycle - all reset
    runId: null,
    runActive: false,
    autoTpFired: false,
    autoTpBaselineEquity: null,
    autoTpTargetEquity: null,
    // Auto-TP configuration - defaults to percent mode with 1% target, infinite mode
    autoTpMode: 'percent',
    autoTpValue: 1, // Default 1% target
    autoTpStopAfterHit: false, // Infinite mode by default
  };
}

export function getButtonStates(session: SessionState): ButtonStates {
  const { status, hasPositions, pendingAction, openCount } = session;
  
  // CRITICAL: When ANY action is in progress, ALL control buttons are disabled
  // This prevents flashing/re-triggering during TP or CloseAll operations
  const isActionInProgress = pendingAction !== null;
  const showSpinner = isActionInProgress;
  
  return {
    // ACTIVATE: when idle, stopped, OR holding (acts as Resume from holding)
    // Disabled if ANY action is pending
    canActivate: (status === 'idle' || status === 'stopped' || status === 'holding') && !isActionInProgress,
    
    // HOLD: only when running, disabled if ANY action is pending
    canHold: status === 'running' && !isActionInProgress,
    
    // TAKE PROFIT: when running or holding AND has positions
    // Disabled if ANY action is pending
    canTakeProfit: (status === 'running' || status === 'holding') && !isActionInProgress && (hasPositions || openCount > 0),
    
    // CLOSE ALL: any active state (closes all, goes to idle)
    // Disabled if ANY action is pending
    canCloseAll: (status === 'running' || status === 'holding') && !isActionInProgress,
    
    // MODE CHANGE: only when idle or stopped
    canChangeMode: (status === 'idle' || status === 'stopped') && !isActionInProgress,
    
    // Spinner shows during any user-initiated action
    showSpinner,
  };
}

export type SessionAction = 
  | { type: 'ACTIVATE' }
  | { type: 'HOLD' }
  | { type: 'TAKE_PROFIT' }
  | { type: 'CLOSE_ALL' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' }
  | { type: 'SET_MODE'; mode: TradingMode }
  | { type: 'SYNC_POSITIONS'; hasPositions: boolean; openCount: number }
  | { type: 'SYNC_PNL'; pnlToday: number; tradesToday: number; winRate: number; equity: number }
  | { type: 'SET_PENDING_ACTION'; pendingAction: PendingAction }
  | { type: 'SYNC_STATUS'; status: SessionStatus }
  // Run lifecycle actions
  | { type: 'START_RUN'; runId: string; baselineEquity: number; targetEquity: number | null }
  | { type: 'END_RUN'; reason: 'auto_tp' | 'manual_stop' | 'close_all' }
  | { type: 'SET_AUTO_TP_FIRED' }
  // Auto-TP configuration actions
  | { type: 'SET_AUTO_TP_MODE'; mode: AutoTpMode }
  | { type: 'SET_AUTO_TP_VALUE'; value: number | null }
  | { type: 'SET_AUTO_TP_STOP_AFTER_HIT'; stopAfterHit: boolean };

export function transitionSession(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'ACTIVATE':
      // Can activate from idle, stopped, OR holding (Resume)
      if (state.status !== 'idle' && state.status !== 'stopped' && state.status !== 'holding') {
        return state;
      }
      return { ...state, status: 'running', lastError: null };
    
    case 'HOLD':
      // Only from running → holding (not a toggle)
      if (state.status === 'running') {
        return { ...state, status: 'holding' };
      }
      return state;
    
    case 'TAKE_PROFIT':
      // Close all positions, stay running (auto-resume from flat state)
      // User must explicitly press HOLD to pause - TP just banks profits
      return { 
        ...state, 
        hasPositions: false, 
        openCount: 0 
        // status stays the same - 'running' continues running
      };
    
    case 'CLOSE_ALL':
      // Close all and go to idle (full kill switch)
      return { 
        ...state, 
        status: 'idle', 
        hasPositions: false, 
        openCount: 0 
      };
    
    case 'ERROR':
      return { 
        ...state, 
        status: 'error', 
        lastError: action.error 
      };
    
    case 'RESET':
      return getInitialSessionState();
    
    case 'SET_MODE':
      // Only allow mode change when idle or stopped
      if (state.status !== 'idle' && state.status !== 'stopped') {
        return state;
      }
      return { ...state, mode: action.mode };
    
    case 'SYNC_POSITIONS':
      return { 
        ...state, 
        hasPositions: action.hasPositions, 
        openCount: action.openCount 
      };
    
    case 'SYNC_PNL':
      return { 
        ...state, 
        pnlToday: action.pnlToday,
        tradesToday: action.tradesToday,
        winRate: action.winRate,
        equity: action.equity,
      };
    
    case 'SET_PENDING_ACTION':
      return { ...state, pendingAction: action.pendingAction };
    
    case 'SYNC_STATUS':
      // Only sync if it's a valid backend status
      const validStatuses: SessionStatus[] = ['idle', 'running', 'holding', 'stopped', 'error'];
      if (!validStatuses.includes(action.status)) {
        return state;
      }
      return { ...state, status: action.status };
    
    // ============== Run Lifecycle Actions ==============
    case 'START_RUN':
      // Initialize a new run with Auto-TP parameters
      return {
        ...state,
        runId: action.runId,
        runActive: true,
        autoTpFired: false,
        autoTpBaselineEquity: action.baselineEquity,
        autoTpTargetEquity: action.targetEquity,
      };
    
    case 'END_RUN':
      // End current run - no new trades allowed until next START_RUN
      return {
        ...state,
        runActive: false,
        // Clear run ID only on close_all (full reset)
        runId: action.reason === 'close_all' ? null : state.runId,
        // Set status to idle for manual_stop and close_all
        status: action.reason === 'auto_tp' ? state.status : 'idle',
      };
    
    case 'SET_AUTO_TP_FIRED':
      // Mark Auto-TP as fired (one-shot per run)
      // Note: runActive control is handled by the action handler based on autoTpStopAfterHit
      return {
        ...state,
        autoTpFired: true,
      };
    
    // ============== Auto-TP Configuration Actions ==============
    case 'SET_AUTO_TP_MODE':
      return { ...state, autoTpMode: action.mode };
    
    case 'SET_AUTO_TP_VALUE':
      return { ...state, autoTpValue: action.value };
    
    case 'SET_AUTO_TP_STOP_AFTER_HIT':
      return { ...state, autoTpStopAfterHit: action.stopAfterHit };
    
    default:
      return state;
  }
}

// ============== Zustand Store ==============
interface SessionStore extends SessionState {
  dispatch: (action: SessionAction) => void;
  getButtonStates: () => ButtonStates;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...getInitialSessionState(),
  
  dispatch: (action: SessionAction) => {
    set((state) => transitionSession(state, action));
  },
  
  getButtonStates: () => {
    const state = get();
    return getButtonStates(state);
  },
}));

// ============== Status Display Helpers ==============
export const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: 'IDLE',
  running: 'RUNNING',
  holding: 'HOLDING',
  stopped: 'STOPPED',
  error: 'ERROR',
};

export const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: 'text-slate-400',
  running: 'text-emerald-400',
  holding: 'text-amber-300',
  stopped: 'text-slate-400',
  error: 'text-red-400',
};
