// ============= PAPER CORE — pure, deterministic engine contracts =============
// No imports, no I/O, no randomness. Shared by paper-tick, paper-stats and the
// Vitest suite so the rules that move money are tested exactly as deployed.

export type Side = 'long' | 'short';
export type ModeKey = 'burst' | 'scalper' | 'trend' | 'adaptive';

// ---------------- Mode keys ----------------
const MODE_ALIASES: Record<string, ModeKey> = {
  burst: 'burst',
  scalper: 'scalper',
  sniper: 'scalper', // legacy frontend key
  trend: 'trend',
  adaptive: 'adaptive',
};

export function normalizeModeKey(raw: unknown): ModeKey | null {
  if (typeof raw !== 'string') return null;
  return MODE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function normalizeEnabledModes(raw: unknown): { modes: ModeKey[]; unknown: string[] } {
  const list = Array.isArray(raw) ? raw : [];
  const modes: ModeKey[] = [];
  const unknown: string[] = [];
  for (const m of list) {
    const k = normalizeModeKey(m);
    if (k) { if (!modes.includes(k)) modes.push(k); }
    else unknown.push(String(m));
  }
  return { modes, unknown };
}

// ---------------- Risk config contract ----------------
export interface RiskConfig {
  perTradeRiskPct: number;
  maxDailyDrawdownPct: number;
  maxOpenTrades: number;
  maxConcurrentRiskPct: number;
  maxPerSymbolOpen: number;
  feeBps: number;
  sources: Record<string, string>;
}

function pick(raw: Record<string, unknown>, keys: string[], fallback: number, sources: Record<string, string>, name: string): number {
  for (const k of keys) {
    const v = Number(raw[k]);
    if (raw[k] !== undefined && raw[k] !== null && Number.isFinite(v)) { sources[name] = k; return v; }
  }
  sources[name] = 'default';
  return fallback;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Accepts canonical keys first, then every legacy key the UI or old rows used. */
export function normalizeRiskConfig(input: unknown): RiskConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const sources: Record<string, string> = {};
  return {
    perTradeRiskPct: clamp(pick(raw, ['perTradeRiskPct', 'maxPerTradeRisk', 'riskPerTrade'], 2, sources, 'perTradeRiskPct'), 0.01, 10),
    maxDailyDrawdownPct: clamp(pick(raw, ['maxDailyDrawdownPct', 'maxDailyDrawdown', 'maxDailyLossPercent'], 5, sources, 'maxDailyDrawdownPct'), 0.1, 100),
    maxOpenTrades: Math.round(clamp(pick(raw, ['maxOpenTrades', 'maxConcurrentPositions'], 20, sources, 'maxOpenTrades'), 1, 200)),
    maxConcurrentRiskPct: clamp(pick(raw, ['maxConcurrentRiskPct', 'maxConcurrentRiskPercent'], 10, sources, 'maxConcurrentRiskPct'), 0.1, 100),
    maxPerSymbolOpen: Math.round(clamp(pick(raw, ['maxPerSymbolOpen', 'maxPerSymbolExposure'], 10, sources, 'maxPerSymbolOpen'), 1, 100)),
    feeBps: clamp(pick(raw, ['feeBps'], 0, sources, 'feeBps'), 0, 100),
    sources,
  };
}

// ---------------- Account equity contract ----------------
export interface AccountRow { id: string; equity: number | null; type?: string; is_active?: boolean | null }

export type EquityResult =
  | { ok: true; accountId: string; openingCapital: number; realizedAllTime: number; balance: number; unrealized: number; equity: number }
  | { ok: false; code: 'EQUITY_UNAVAILABLE'; reason: 'NO_ACTIVE_PAPER_ACCOUNT' | 'ACCOUNT_AMBIGUOUS' | 'ACCOUNT_NOT_INITIALIZED' | 'LOAD_FAILED'; detail?: string };

/**
 * Canonical equity (pre-ledger): opening capital is accounts.equity, which no code
 * path writes during trading, so it is the explicitly-set starting capital.
 * balance = opening + all realized net P&L (compounds across days; daily snapshots
 * are never used as a base, so nothing is counted twice). equity = balance + unrealized.
 * Never invents a balance: missing/zero/ambiguous -> EQUITY_UNAVAILABLE.
 */
export function resolveAccountEquity(accounts: AccountRow[] | null | undefined, realizedPnls: number[], unrealizedPnls: number[]): EquityResult {
  const list = accounts ?? [];
  if (list.length === 0) return { ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'NO_ACTIVE_PAPER_ACCOUNT' };
  if (list.length > 1) return { ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'ACCOUNT_AMBIGUOUS', detail: `${list.length} active paper accounts` };
  const acct = list[0];
  const opening = acct.equity === null || acct.equity === undefined ? NaN : Number(acct.equity);
  if (!Number.isFinite(opening) || opening <= 0) return { ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'ACCOUNT_NOT_INITIALIZED' };
  const realized = sum(realizedPnls);
  const unrealized = sum(unrealizedPnls);
  const balance = opening + realized;
  return { ok: true, accountId: acct.id, openingCapital: opening, realizedAllTime: realized, balance, unrealized, equity: balance + unrealized };
}

export function sum(values: Array<number | string | null | undefined>): number {
  let s = 0;
  for (const v of values) { const n = Number(v); if (Number.isFinite(n)) s += n; }
  return s;
}

// ---------------- P&L ----------------
export function grossPnl(side: Side, entry: number, exit: number, size: number): number {
  return (side === 'long' ? exit - entry : entry - exit) * size;
}

/** Net realized P&L after round-trip fees (feeBps per side on notional). */
export function netClosePnl(side: Side, entry: number, exit: number, size: number, feeBps = 0): { gross: number; fees: number; net: number } {
  const gross = grossPnl(side, entry, exit, size);
  const fees = ((entry + exit) * size * feeBps) / 10000;
  return { gross, fees, net: gross - fees };
}

// ---------------- Entry direction (no random fallback) ----------------
export function decideDirection(trendBias: 'bull' | 'bear' | 'neutral', confidence: number, minConfidence = 0.35): Side | null {
  if (trendBias === 'bull' && confidence > minConfidence) return 'long';
  if (trendBias === 'bear' && confidence > minConfidence) return 'short';
  return null; // insufficient evidence -> no entry
}

// ---------------- Sizing ----------------
export function sizeFromRisk(equity: number, riskPct: number, entry: number, sl: number): number {
  const dist = Math.abs(entry - sl);
  if (!(equity > 0) || !(riskPct > 0) || !(dist > 0)) return 0;
  return (equity * riskPct / 100) / dist;
}

// ---------------- Exit management ----------------
export interface ExitProfile {
  defaultStopPercent: number;
  defaultTPMultiplier: number;
  trailingStopActivation: number; // % gain at which trailing arms
  trailingStopDistance: number;   // % give-back from best price
  cutLoserThreshold: number;      // negative %
  maxHoldMinutes: number;
}

export interface ManagedPosition { side: Side; entry_price: number; sl: number | null; tp: number | null; opened_at: string }

export type ExitDecision =
  | { action: 'close'; reason: 'position_sl' | 'trailing_stop' | 'position_tp' | 'cut_loser' | 'age_limit' }
  | { action: 'move_sl'; sl: number }
  | { action: 'hold' };

/**
 * Uses the position's own stored SL/TP prices; profile only fills in when the
 * position has none. Trailing ratchets the stored SL toward price (never back),
 * so the peak is persisted in `sl` and the stop is reachable.
 */
export function evaluateExit(pos: ManagedPosition, price: number, profile: ExitProfile, nowMs: number): ExitDecision {
  const entry = Number(pos.entry_price);
  const long = pos.side === 'long';
  const stopPct = profile.defaultStopPercent / 100;
  const sl = pos.sl != null && Number(pos.sl) > 0 ? Number(pos.sl) : (long ? entry * (1 - stopPct) : entry * (1 + stopPct));
  const tp = pos.tp != null && Number(pos.tp) > 0 ? Number(pos.tp) : (long ? entry * (1 + stopPct * profile.defaultTPMultiplier) : entry * (1 - stopPct * profile.defaultTPMultiplier));
  const slInProfit = long ? sl > entry : sl < entry;

  if (long ? price <= sl : price >= sl) return { action: 'close', reason: slInProfit ? 'trailing_stop' : 'position_sl' };
  if (long ? price >= tp : price <= tp) return { action: 'close', reason: 'position_tp' };

  const pnlPct = entry > 0 ? ((long ? price - entry : entry - price) / entry) * 100 : 0;
  if (pnlPct <= profile.cutLoserThreshold) return { action: 'close', reason: 'cut_loser' };

  const ageMin = (nowMs - new Date(pos.opened_at).getTime()) / 60000;
  if (ageMin > profile.maxHoldMinutes) return { action: 'close', reason: 'age_limit' };

  if (pnlPct >= profile.trailingStopActivation) {
    const d = profile.trailingStopDistance / 100;
    const trail = long ? price * (1 - d) : price * (1 + d);
    if (long ? trail > sl : trail < sl) return { action: 'move_sl', sl: trail };
  }
  return { action: 'hold' };
}

// ---------------- Governor (replaces daily halt; never persisted, never closes) ----------------
export interface GovernorInput {
  equity: number;
  dayStartEquity: number;
  openRiskAmount: number; // sum |entry - sl| * size of open positions
  openCount: number;
  risk: RiskConfig;
}
export interface GovernorDecision { allowEntries: boolean; sizeMultiplier: number; reasons: string[]; dayDrawdownPct: number; openRiskPct: number }

export function governor(g: GovernorInput): GovernorDecision {
  const reasons: string[] = [];
  const dayDrawdownPct = g.dayStartEquity > 0 ? Math.max(0, (g.dayStartEquity - g.equity) / g.dayStartEquity * 100) : 0;
  const openRiskPct = g.equity > 0 ? (g.openRiskAmount / g.equity) * 100 : 0;
  let allow = true;
  let mult = 1;
  if (!(g.equity > 0)) { allow = false; reasons.push('NO_EQUITY'); }
  if (dayDrawdownPct >= g.risk.maxDailyDrawdownPct) { allow = false; reasons.push('DRAWDOWN_HARD'); }
  else if (dayDrawdownPct >= g.risk.maxDailyDrawdownPct * 0.5) { mult = 0.5; reasons.push('DRAWDOWN_SOFT'); }
  if (g.openCount >= g.risk.maxOpenTrades) { allow = false; reasons.push('MAX_OPEN_TRADES'); }
  if (openRiskPct >= g.risk.maxConcurrentRiskPct) { allow = false; reasons.push('MAX_CONCURRENT_RISK'); }
  return { allowEntries: allow, sizeMultiplier: allow ? mult : 0, reasons, dayDrawdownPct, openRiskPct };
}

export function positionRisk(p: { entry_price: number; sl: number | null; size: number }): number {
  if (p.sl == null) return 0;
  return Math.abs(Number(p.entry_price) - Number(p.sl)) * Number(p.size);
}
