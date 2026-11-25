import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  normalizeModeKey, normalizeEnabledModes, normalizeRiskConfig, resolveAccountEquity,
  decideDirection, evaluateExit, governor, sizeFromRisk, netClosePnl, positionRisk,
  executionPrice, canAddSymbolExposure,
} from '../supabase/functions/_shared/paper-core';

const profile = { defaultStopPercent: 0.4, defaultTPMultiplier: 1.5, trailingStopActivation: 0.4, trailingStopDistance: 0.2, cutLoserThreshold: -5, maxHoldMinutes: 60 };
const now = Date.parse('2026-01-01T00:10:00Z');
const opened = '2026-01-01T00:00:00Z';
const verifiedAcct = { id: 'a', equity: 5000, opening_capital_set_at: '2026-01-01T00:00:00Z' };
const configuredCost = { takerFeeBps: 5, slippageBps: 2, fillAssumption: 'bid_ask' as const };

describe('equity contract', () => {
  it('compounds: verified opening + account-scoped realized + unrealized', () => {
    const r = resolveAccountEquity(
      [verifiedAcct],
      [{ realized_pnl: 100, account_id: 'a' }, { realized_pnl: -40, account_id: 'a' }, { realized_pnl: 25, account_id: 'a' }],
      [10],
    );
    expect(r.ok && r.balance).toBe(5085);
    expect(r.ok && r.equity).toBe(5095);
  });
  it('never invents 10000 when uninitialized', () => {
    const r = resolveAccountEquity([{ id: 'a', equity: null, opening_capital_set_at: '2026-01-01T00:00:00Z' }], [], []);
    expect(r).toMatchObject({ ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'ACCOUNT_NOT_INITIALIZED' });
  });
  it('blocks when opening capital baseline is not verified', () => {
    const r = resolveAccountEquity([{ id: 'a', equity: 5000 }], [], []);
    expect(r).toMatchObject({ ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'BASELINE_UNVERIFIED' });
  });
  it('blocks on unscoped historical trades missing account_id', () => {
    const r = resolveAccountEquity([verifiedAcct], [{ realized_pnl: 100, account_id: null }], []);
    expect(r).toMatchObject({ ok: false, code: 'EQUITY_UNAVAILABLE', reason: 'UNSCOPED_TRADE_HISTORY' });
  });
  it('isolates account equity from other accounts trades', () => {
    const r = resolveAccountEquity(
      [verifiedAcct],
      [{ realized_pnl: 100, account_id: 'a' }, { realized_pnl: -999, account_id: 'other-account' }],
      [],
    );
    expect(r.ok && r.balance).toBe(5100);
  });
  it('no active paper account -> unavailable', () => {
    expect(resolveAccountEquity([], [], [])).toMatchObject({ ok: false, reason: 'NO_ACTIVE_PAPER_ACCOUNT' });
  });
  it('multiple active paper accounts -> ambiguous, not merged', () => {
    expect(resolveAccountEquity([{ id: 'a', equity: 1 }, { id: 'b', equity: 1 }], [], [])).toMatchObject({ ok: false, reason: 'ACCOUNT_AMBIGUOUS' });
  });
  it('fees reduce net realized P&L', () => {
    const r = netClosePnl('long', 100, 110, 2, 10); // fees = (100+110)*2*10/10000 = 0.42
    expect(r.gross).toBe(20);
    expect(r.net).toBeCloseTo(19.58, 10);
  });
});

describe('mode keys', () => {
  it('maps legacy sniper to scalper', () => expect(normalizeModeKey('sniper')).toBe('scalper'));
  it('keeps the three modes', () => expect(['burst', 'scalper', 'trend'].map(normalizeModeKey)).toEqual(['burst', 'scalper', 'trend']));
  it('drops unknown modes and reports them', () => {
    expect(normalizeEnabledModes(['sniper', 'news', 'memory', 'trend', 'scalper'])).toEqual({ modes: ['scalper', 'trend'], unknown: ['news', 'memory'] });
  });
});

describe('risk config wiring', () => {
  it('UI key maxPerTradeRiskPercent reaches the engine', () => {
    const cfg = normalizeRiskConfig({ maxPerTradeRiskPercent: 0.5 });
    expect(cfg.perTradeRiskPct).toBe(0.5);
    expect(cfg.sources.perTradeRiskPct).toBe('maxPerTradeRiskPercent');
  });
  it('UI key maxPerTradeRisk reaches the engine', () => {
    expect(normalizeRiskConfig({ maxPerTradeRisk: 0.5, riskPerTrade: 2 }).perTradeRiskPct).toBe(0.5);
  });
  it('UI maxDailyDrawdown reaches the governor', () => {
    expect(normalizeRiskConfig({ maxDailyDrawdown: 3 }).maxDailyDrawdownPct).toBe(3);
  });
  it('maxPerSymbolExposure is percent of equity, not position count', () => {
    const cfg = normalizeRiskConfig({ maxPerSymbolExposure: 30 });
    expect(cfg.maxPerSymbolExposurePct).toBe(30);
    expect(canAddSymbolExposure(10000, 2000, 1000, cfg.maxPerSymbolExposurePct)).toBe(true);  // 30%
    expect(canAddSymbolExposure(10000, 2000, 1001, cfg.maxPerSymbolExposurePct)).toBe(false); // 30.01%
  });
  it('sizing risks exactly perTradeRisk % of current equity', () => {
    const size = sizeFromRisk(12000, 1, 100, 99);
    expect(size * 1).toBeCloseTo(120, 10); // risk = size * stop distance
  });
  it('compounding: larger equity -> larger size', () => {
    expect(sizeFromRisk(11000, 1, 100, 99)).toBeGreaterThan(sizeFromRisk(10000, 1, 100, 99));
  });
});

describe('cost model', () => {
  it('unconfigured cost model blocks entries in governor', () => {
    const risk = normalizeRiskConfig({ maxDailyDrawdown: 5 });
    expect(risk.costModel.configured).toBe(false);
    const g = governor({ equity: 10000, dayStartEquity: 10000, openRiskAmount: 0, openCount: 0, risk });
    expect(g.allowEntries).toBe(false);
    expect(g.reasons).toContain('COST_MODEL_UNCONFIGURED');
  });
  it('applies bid/ask spread + slippage symmetrically on entry and exit', () => {
    const tick = { bid: 99.9, ask: 100.1, mid: 100 };
    const entry = executionPrice('long', 'entry', tick, { fillAssumption: 'bid_ask', slippageBps: 5 });
    const exit = executionPrice('long', 'exit', tick, { fillAssumption: 'bid_ask', slippageBps: 5 });
    expect(entry).toBeCloseTo(100.1 * 1.0005, 8);
    expect(exit).toBeCloseTo(99.9 * 0.9995, 8);
    const pnl = netClosePnl('long', entry, exit, 1, { takerFeeBps: 5 });
    expect(pnl.net).toBeLessThan(0); // instant round-trip loses spread + slippage + fees
  });
});

describe('entries', () => {
  it('neutral regime gives no entry', () => expect(decideDirection('neutral', 0.9)).toBeNull());
  it('weak bull evidence gives no entry', () => expect(decideDirection('bull', 0.2)).toBeNull());
  it('confident bear gives short', () => expect(decideDirection('bear', 0.6)).toBe('short'));
});

describe('stop / TP lifecycle', () => {
  const pos = { side: 'long' as const, entry_price: 100, sl: 99, tp: 105, opened_at: opened };
  it('uses the position stored SL, not the profile', () => {
    expect(evaluateExit(pos, 99.5, profile, now)).toEqual({ action: 'hold' }); // profile stop would be 99.6
    expect(evaluateExit(pos, 99, profile, now)).toEqual({ action: 'close', reason: 'position_sl' });
  });
  it('uses the stored TP', () => {
    expect(evaluateExit(pos, 105, profile, now)).toEqual({ action: 'close', reason: 'position_tp' });
  });
  it('trailing stop arms, ratchets and then fires', () => {
    const d1 = evaluateExit(pos, 101, profile, now);
    expect(d1.action).toBe('move_sl');
    const newSl = (d1 as { sl: number }).sl;
    expect(newSl).toBeCloseTo(100.798, 6);
    // price falls back below ratcheted stop -> trailing_stop
    expect(evaluateExit({ ...pos, sl: newSl }, 100.7, profile, now)).toEqual({ action: 'close', reason: 'trailing_stop' });
  });
  it('stop never loosens', () => {
    expect(evaluateExit({ ...pos, sl: 100.9 }, 101, profile, now)).toEqual({ action: 'hold' });
  });
  it('short side mirrors', () => {
    const s = { side: 'short' as const, entry_price: 100, sl: 101, tp: 95, opened_at: opened };
    expect(evaluateExit(s, 101, profile, now)).toEqual({ action: 'close', reason: 'position_sl' });
  });
});

describe('governor (no halt flag)', () => {
  const risk = normalizeRiskConfig({ maxDailyDrawdown: 4, maxOpenTrades: 5, maxConcurrentRiskPercent: 10, costModel: configuredCost });
  it('soft drawdown halves size', () => {
    const g = governor({ equity: 9750, dayStartEquity: 10000, openRiskAmount: 0, openCount: 0, risk });
    expect(g).toMatchObject({ allowEntries: true, sizeMultiplier: 0.5 });
  });
  it('hard drawdown blocks new entries only', () => {
    const g = governor({ equity: 9600, dayStartEquity: 10000, openRiskAmount: 0, openCount: 0, risk });
    expect(g.allowEntries).toBe(false);
    expect(g.reasons).toContain('DRAWDOWN_HARD');
  });
  it('recovers automatically when equity recovers', () => {
    expect(governor({ equity: 9900, dayStartEquity: 10000, openRiskAmount: 0, openCount: 0, risk }).allowEntries).toBe(true);
  });
  it('concurrent risk cap uses stored SLs', () => {
    const openRisk = positionRisk({ entry_price: 100, sl: 99, size: 1000 }); // 1000
    expect(governor({ equity: 10000, dayStartEquity: 10000, openRiskAmount: openRisk, openCount: 1, risk }).reasons).toContain('MAX_CONCURRENT_RISK');
  });
});

describe('replay determinism', () => {
  it('same tick sequence gives identical decisions', () => {
    const run = () => {
      let p = { side: 'long' as const, entry_price: 100, sl: 99 as number | null, tp: 105 as number | null, opened_at: opened };
      const out: string[] = [];
      for (const px of [100.2, 100.6, 101.1, 100.9, 100.85, 100.7]) {
        const d = evaluateExit(p, px, profile, now);
        out.push(d.action === 'close' ? d.reason : d.action);
        if (d.action === 'move_sl') p = { ...p, sl: d.sl };
        if (d.action === 'close') break;
      }
      return out;
    };
    expect(run()).toEqual(run());
    const r = run(); expect(r[r.length - 1]).toBe('trailing_stop');
  });
});

describe('regression guards', () => {
  const tick = readFileSync('supabase/functions/paper-tick/index.ts', 'utf8');
  const stats = readFileSync('supabase/functions/paper-stats/index.ts', 'utf8');
  it('no hardcoded 10000 equity fallback in engine', () => {
    expect(tick).not.toMatch(/\?\? *10000/);
    expect(stats).not.toMatch(/\?\? *10000/);
  });
  it('no random direction fallback', () => expect(tick).not.toMatch(/Math\.random\(\) > 0\.5 \? 'long'/));
  it('daily halt stays removed', () => expect(tick + stats).not.toMatch(/trading_halted_for_day/));
  it('entry fill uses executionPrice, not raw tick.mid', () => {
    expect(tick).toMatch(/executionPrice\(direction,\s*'entry'/);
    expect(tick).not.toMatch(/entryPrice:\s*tick\.mid/);
  });
  it('all close paths share buildCloseRecord', () => {
    expect((tick.match(/buildCloseRecord\(/g) || []).length).toBeGreaterThanOrEqual(5); // 1 def + 4 call sites
  });
});
