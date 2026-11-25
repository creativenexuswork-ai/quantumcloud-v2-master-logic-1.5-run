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
export type FillAssumption = 'bid_ask' | 'mid_plus_slippage';

export interface CostModelConfig {
  makerFeeBps: number | null;
  takerFeeBps: number | null;
  slippageBps: number | null;
  fillAssumption: FillAssumption;
  isEstimate: boolean;
  configured: boolean;
  sources: Record<string, string>;
}

export interface RiskConfig {
  perTradeRiskPct: number;
  maxDailyDrawdownPct: number;
  maxOpenTrades: number;
  maxConcurrentRiskPct: number;
  maxPerSymbolExposurePct: number;
  maxPerSymbolOpen: number;
  feeBps: number;
  costModel: CostModelConfig;
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

function pickNullable(raw: Record<string, unknown>, keys: string[], sources: Record<string, string>, name: string): number | null {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') {
      const v = Number(raw[k]);
      if (Number.isFinite(v)) { sources[name] = k; return v; }
    }
  }
  sources[name] = 'unconfigured';
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function normalizeCostModel(input: unknown): CostModelConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const nested = (raw.costModel && typeof raw.costModel === 'object' ? raw.costModel : {}) as Record<string, unknown>;
  const merged = { ...raw, ...nested };
  const sources: Record<string, string> = {};
  const rawMaker = pickNullable(merged, ['makerFeeBps'], sources, 'makerFeeBps');
  const rawTaker = pickNullable(merged, ['takerFeeBps', 'feeBps'], sources, 'takerFeeBps');
  const rawSlip = pickNullable(merged, ['slippageBps'], sources, 'slippageBps');
  const makerFeeBps = rawMaker === null ? null : clamp(rawMaker, 0, 500);
  const takerFeeBps = rawTaker === null ? null : clamp(rawTaker, 0, 500);
  const slippageBps = rawSlip === null ? null : clamp(rawSlip, 0, 500);
  const fillAssumption: FillAssumption = merged.fillAssumption === 'mid_plus_slippage' ? 'mid_plus_slippage' : 'bid_ask';
  const isEstimate = merged.isEstimate !== false;
  const configured = takerFeeBps !== null && slippageBps !== null;
  return { makerFeeBps, takerFeeBps, slippageBps, fillAssumption, isEstimate, configured, sources };
}

/** Accepts canonical keys first, then every legacy key the UI or old rows used. */
export function normalizeRiskConfig(input: unknown): RiskConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const sources: Record<string, string> = {};
  const costModel = normalizeCostModel(raw);
  return {
    perTradeRiskPct: clamp(pick(raw, ['perTradeRiskPct', 'maxPerTradeRiskPercent', 'maxPerTradeRisk', 'riskPerTrade'], 2, sources, 'perTradeRiskPct'), 0.01, 10),
    maxDailyDrawdownPct: clamp(pick(raw, ['maxDailyDrawdownPct', 'maxDailyDrawdown', 'maxDailyLossPercent'], 5, sources, 'maxDailyDrawdownPct'), 0.1, 100),
    maxOpenTrades: Math.round(clamp(pick(raw, ['maxOpenTrades', 'maxConcurrentPositions'], 20, sources, 'maxOpenTrades'), 1, 200)),
    maxConcurrentRiskPct: clamp(pick(raw, ['maxConcurrentRiskPct', 'maxConcurrentRiskPercent'], 10, sources, 'maxConcurrentRiskPct'), 0.1, 100),
    maxPerSymbolExposurePct: clamp(pick(raw, ['maxPerSymbolExposurePct', 'maxPerSymbolExposure'], 30, sources, 'maxPerSymbolExposurePct'), 1, 100),
    maxPerSymbolOpen: Math.round(clamp(pick(raw, ['maxPerSymbolOpen'], 10, sources, 'maxPerSymbolOpen'), 1, 100)),
    feeBps: costModel.takerFeeBps ?? 0,
    costModel,
    sources,
  };
}

// ---------------- Account equity contract ----------------
export interface AccountRow {
  id: string;
  equity: number | null;
  type?: string;
  is_active?: boolean | null;
  opening_capital_set_at?: string | null;
  baseline_verified_at?: string | null;
}

export interface RealizedTradeRef {
  realized_pnl: number | string | null | undefined;
  account_id?: string | null;
}

export type EquityUnavailableReason =
  | 'NO_ACTIVE_PAPER_ACCOUNT'
  | 'ACCOUNT_AMBIGUOUS'
  | 'ACCOUNT_NOT_INITIALIZED'
  | 'BASELINE_UNVERIFIED'
  | 'UNSCOPED_TRADE_HISTORY'
  | 'LOAD_FAILED';

export type EquityResult =
  | { ok: true; accountId: string; openingCapital: number; realizedAllTime: number; balance: number; unrealized: number; equity: number }
  | { ok: false; code: 'EQUITY_UNAVAILABLE'; reason: EquityUnavailableReason; detail?: string };

/**
 * Canonical equity (pre-ledger): requires an explicitly verified opening-capital
 * baseline (opening_capital_set_at or baseline_verified_at) AND account-scoped
 * trade history (every realized trade must carry account_id). Never infers
 * accounts.equity as opening capital without verification and never mixes
 * unscoped user-wide historical trades into an active account.
 */
export function resolveAccountEquity(
  accounts: AccountRow[] | null | undefined,
  realizedTrades: RealizedTradeRef[] | null | undefined,
  unrealizedPnls: number[],
): EquityResult {
  const list = accounts ?? [];
  if (list.length === 0) return { ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'NO_ACTIVE_PAPER_ACCOUNT' };
  if (list.length > 1) return { ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'ACCOUNT_AMBIGUOUS', detail: `${list.length} active paper accounts` };
  const acct = list[0];
  const opening = acct.equity === null || acct.equity === undefined ? NaN : Number(acct.equity);
  if (!Number.isFinite(opening) || opening <= 0) return { ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'ACCOUNT_NOT_INITIALIZED' };
  const verifiedAt = acct.baseline_verified_at || acct.opening_capital_set_at;
  if (!verifiedAt || typeof verifiedAt !== 'string' || verifiedAt.trim() === '') {
    return { ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'BASELINE_UNVERIFIED', detail: 'Opening capital baseline has not been verified' };
  }
  const trades = realizedTrades ?? [];
  const unscoped = trades.filter(t => !t.account_id || typeof t.account_id !== 'string' || t.account_id.trim() === '');
  if (unscoped.length > 0) {
    return { ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'UNSCOPED_TRADE_HISTORY', detail: `${unscoped.length} trade(s) missing account_id` };
  }
  const accountTrades = trades.filter(t => t.account_id === acct.id);
  const realized = sum(accountTrades.map(t => t.realized_pnl));
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
export interface QuoteTick { bid: number; ask: number; mid: number }

/** Consistent entry/exit fill pricing with spread and slippage. */
export function executionPrice(side: Side, action: 'entry' | 'exit', tick: QuoteTick, cost: Pick<CostModelConfig, 'fillAssumption' | 'slippageBps'>): number {
  const slip = (cost.slippageBps ?? 0) / 10000;
  const isBuy = (side === 'long' && action === 'entry') || (side === 'short' && action === 'exit');
  const base = cost.fillAssumption === 'mid_plus_slippage' ? tick.mid : (isBuy ? tick.ask : tick.bid);
  return isBuy ? base * (1 + slip) : base * (1 - slip);
}

export function grossPnl(side: Side, entry: number, exit: number, size: number): number {
  return (side === 'long' ? exit - entry : entry - exit) * size;
}

/** Net realized P&L after round-trip fees (feeBps per side on notional). */
export function netClosePnl(
  side: Side,
  entry: number,
  exit: number,
  size: number,
  costOrFeeBps: number | Pick<CostModelConfig, 'takerFeeBps'> = 0,
): { gross: number; fees: number; net: number } {
  const feeBps = typeof costOrFeeBps === 'number' ? costOrFeeBps : (costOrFeeBps.takerFeeBps ?? 0);
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
  if (!g.risk.costModel.configured) { allow = false; reasons.push('COST_MODEL_UNCONFIGURED'); }
  if (dayDrawdownPct >= g.risk.maxDailyDrawdownPct) { allow = false; reasons.push('DRAWDOWN_HARD'); }
  else if (dayDrawdownPct >= g.risk.maxDailyDrawdownPct * 0.5) { mult = 0.5; reasons.push('DRAWDOWN_SOFT'); }
  if (g.openCount >= g.risk.maxOpenTrades) { allow = false; reasons.push('MAX_OPEN_TRADES'); }
  if (openRiskPct >= g.risk.maxConcurrentRiskPct) { allow = false; reasons.push('MAX_CONCURRENT_RISK'); }
  return { allowEntries: allow, sizeMultiplier: allow ? mult : 0, reasons, dayDrawdownPct, openRiskPct };
}

export function canAddSymbolExposure(
  equity: number,
  currentSymbolNotional: number,
  newOrderNotional: number,
  maxPerSymbolExposurePct: number,
): boolean {
  if (!(equity > 0) || !(maxPerSymbolExposurePct > 0)) return false;
  return ((currentSymbolNotional + newOrderNotional) / equity) * 100 <= maxPerSymbolExposurePct;
}

export function positionRisk(p: { entry_price: number; sl: number | null; size: number }): number {
  if (p.sl == null) return 0;
  return Math.abs(Number(p.entry_price) - Number(p.sl)) * Number(p.size);
}
