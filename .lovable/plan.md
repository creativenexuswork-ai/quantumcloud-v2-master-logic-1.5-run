# QuantumCloud Recommission — Paper-only Build Cut 1

Scope: Paper only. No live orders. Keep Burst / Scalper / Trend, the current look, the existing layout and the daily-halt removal. Only new UI: a small diagnostics panel.

## Verified in source (this pass)
- Equity fallback chain appears 5 times in `supabase/functions/paper-tick/index.ts` (lines ~901, 963, 1076, 1098) and in `paper-stats/index.ts:113`: `paper_stats_daily.equity_start ?? accounts.equity ?? 10000`, then `+ today's realized P&L`. Nothing found that writes `accounts.equity`. `useUpdateAccountEquity` (`src/hooks/useAccounts.tsx:70`) has no caller. Result: equity resets every day to a stale starting value, so compounding cannot happen.
- Frontend also falls back to `|| 10000` in `useSessionActions.tsx` (77, 158, 241, 379, 507, 591), `useSessionSync.tsx:38` and `useSessionState.tsx:188`. A real 0 or missing value shows as $10,000.
- Accounts are looked up by `user_id + type='paper'` with `maybeSingle()`. Two paper accounts would make this lookup fail. Trades and stats are scoped by user only, not by account.
- Random direction: `paper-tick/index.ts:714`, `Math.random() > 0.5 ? 'long' : 'short'` when the regime is neutral.
- Trailing stop cannot trigger (`paper-tick:619-622`). It needs `pnl >= activation` and `pnl < activation - distance` at the same time, which is impossible. There is no stored peak.
- Mode key mismatch: the frontend maps `scalper -> 'sniper'` (`useSessionActions.tsx:17`, `useSessionState.tsx:32`). The backend only knows `'scalper'` (`paper-tick:56`) and silently falls back to `MODE_PROFILES.scalper` (line 581). `useSessionState.tsx:199` also writes enabled modes `news` and `memory`, which do not exist.
- Risk key mismatch: the frontend sends `maxPerTradeRisk` / `maxDailyDrawdown`, but the backend reads `riskConfig.riskPerTrade || 2` (line 1305). The user's risk setting never reaches the engine.
- Burst: the frontend writes `burst_config.size`. Whether the backend uses size, duration or TP style is still to confirm in step 0.
- The database could not be reached from my tools this session: every query was refused with "Database is possibly not accessible". So the actual rows, real equity values, duplicate accounts and RLS state are **unverified**.

## Stage 0 — Unblock and baseline (read-only)
1. Get database access back (check the backend's status, restart it if needed). Then snapshot `accounts`, `paper_config`, `paper_stats_daily`, `paper_positions` and `paper_trades` for the test user: number of paper accounts, stored equity values, and any rows missing an account.
2. Check whether the backend uses each burst field, each position's own SL/TP values, and the governor fields. Every finding goes into a wiring table, which a test then checks.

## Stage 1 — Canonical equity ledger (highest priority)
Contract: **one source of truth per account**.
- New table `account_ledger` (additive): `id, user_id, account_id, ts, kind (init|realized|fee|slippage|funding|adjust|reset), amount, balance_after, ref_trade_id, session_id null`. Insert only, with a unique `ref_trade_id + kind` so nothing is booked twice.
- `accounts` gets new nullable columns: `balance` (cached ledger total), `initialized_at`, `peak_equity`. `accounts.equity` stays and is marked deprecated in favour of `balance`.
- `paper_trades` and `paper_positions` get new nullable columns: `account_id`, `fees`, `slippage`, `funding`, `gross_pnl`, `peak_pnl_pct` (positions). `realized_pnl` means net.
- New table `equity_snapshots_daily`, or extend `paper_stats_daily` with `account_id`, `equity_end`, `realized`, `unrealized` and `fees`. A snapshot is a record only and is never read back as the starting point.
- Definitions: `balance = sum(ledger)`, `equity = balance + sum(open unrealized net of estimated exit fees)`. Size new trades from `equity`, after subtracting the risk already committed to open positions, so the same money is not counted twice.
- Write path: one shared server function `bookClose(trade)` used by every close (TP, stop, trailing, global close, take-burst-profit, reset). It inserts the trade, adds the ledger rows and updates the cached balance in one database function (`book_trade_close` RPC, security definer, scoped by account).
- Start-up: the first time an account is used, add one `init` ledger row (the user's chosen start, $10k by default) and set `initialized_at`. After that, no code may fall back to 10000. If the value is missing, show an error and an `EQUITY_UNAVAILABLE` diagnostic, and the engine opens no new trades.
- Backfill: for each account, an `init` row from the oldest known `equity_start`, then one `realized` row per past trade (the trade id stops duplicates). Report the difference against the current displayed number.
- Reconciliation: each stats call checks that `cached balance == sum(ledger)` and that the snapshot math agrees. Any gap is logged as `LEDGER_DRIFT`.
- Replace the 5 backend fallback blocks with one `loadAccountEquity(account_id)` helper. Remove the `|| 10000` in the frontend and use `??` with a "not loaded" state.
- Remove the dead `useUpdateAccountEquity`, or leave it unused and marked deprecated. Only the server writes balances.

## Stage 2 — Engine integrity repairs (`paper-tick/index.ts`)
1. **Neutral regime:** no entry (`NO_ENTRY_INSUFFICIENT_EVIDENCE` is logged). Replace the random choice at 714. If the evidence score is below the threshold, skip the entry.
2. **Trailing stop:** keep each position's `peak_pnl_pct` and update it every tick. Once peak ≥ activation, close when `pnl <= peak - distance`, with reason `trailing_stop`.
3. **Position SL/TP:** use the SL/TP prices saved on the position when it was opened. The current mode profile only applies to positions that have none saved (older ones). The mode can change mid-trade without changing that trade's exits.
4. **Mode keys:** one shared map, `burst|scalper|trend` (+ internal `adaptive`). Remove `sniper`, `news` and `memory` from what the frontend writes. The backend accepts `sniper` as an alias for older settings, logs `UNKNOWN_MODE` for anything else, and never falls back silently.
5. **Risk settings:** one shape for `risk_config`: `{ perTradeRiskPct, maxDailyDrawdownPct, maxOpenPositions, maxExposurePct, maxSymbolExposurePct, maxCorrelatedExposurePct }`. The backend reads the new names first and then the old `riskPerTrade`, `maxPerTradeRisk`, `maxDailyDrawdown`. Each tick logs the settings it actually used.
6. **Burst settings:** connect size, duration and TP style end to end, or show them as not used. No hidden or missing settings.

## Stage 3 — Governor (replaces halt, does not bring it back)
- A pure function `governor(state, config) -> { allowEntries, sizeMultiplier, reasons[] }`. It only throttles new entries and never closes positions or stops the session. Inputs: drawdown from peak equity, today's drawdown, open exposure (total, per symbol, correlated BTC/ETH), open position count, cooldown after a stop.
- Graded response: drawdown beyond the soft limit cuts size (e.g. 50%), beyond the hard limit it blocks new entries until equity recovers or the session restarts. Nothing is saved as a "halted" flag. It is worked out fresh each tick from the ledger and positions, so it cannot carry over between accounts.
- Session state: every read and write is scoped by `account_id` and `user_id`. The account is resolved by `accounts.is_active` and not by `maybeSingle` on type.

## Stage 4 — Essential diagnostics only
- A small "Engine diagnostics" card in the current style: balance, equity, ledger check OK/drift, governor decision and reasons, the risk settings in effect, the mode in effect, and the last reason for no entry.

## Tests (Vitest, next to `src/lib/trading`)
Move the engine's core math into pure modules so both the backend and the tests use the same code: `ledger.ts`, `governor.ts`, `management.ts` (stops/TP/trailing), `modes.ts` (key map), `riskConfig.ts` (settings normaliser).
- Replay: a fixed list of ticks gives identical trades and equity on every run, with no randomness (random IDs are injected).
- Accounting rules: balance = init + Σnet; equity = balance + unrealized; booking a close twice changes nothing; fees reduce the net; compounding size grows with equity; no 10000 after start-up.
- Mode mapping: every UI mode reaches a real backend profile; `sniper` maps to scalper; unknown modes are rejected.
- Risk settings: the UI's per-trade risk of X% gives a risk amount of X% of equity in sizing.
- Stop/TP lifecycle: SL, TP, trailing (activate → peak → give-back close), the saved position SL/TP takes priority over the profile.
- No entry on weak evidence: neutral regime gives no entry.
- Governor: soft limit → reduced size, hard limit → no entries, positions untouched, no saved halt.
- Regression: no `trading_halted_for_day`, `sniper` or `|| 10000` left in the engine code paths (a search-based test).

## Migration and rollback
- Everything is additive: new tables and nullable columns, and backfill only through history rows. Nothing is dropped. `accounts.equity` is kept and marked deprecated.
- A feature flag `paper_config.engine_v2` (default off → turned on for the test account, then for everyone). When off, the current paths run unchanged.
- Rollback: turn the flag off. The ledger tables can stay, since they are only added to.

## Acceptance criteria
1. A new paper account starts at its init balance. After closes on 2+ days, the starting equity of day N = ending equity of day N−1 (compounding), and the ledger check passes.
2. Changing per-trade risk in the UI changes the next trade's risk amount exactly.
3. Selecting Scalper runs the scalper profile (seen in logs and diagnostics), with no `sniper` fallback.
4. A neutral regime produces no trades. Trailing stops close winners after activation.
5. Going past the drawdown limit throttles or blocks new entries without closing positions or flagging a halt, and it clears itself when conditions recover.
6. Two accounts under one user share no balance, positions, trades or governor state.
7. All tests pass, and no live order paths are touched.

## Order
Stage 0 → 1 (ledger and equity) → 2 (repairs) → 3 (governor) → 4 (diagnostics), each step behind the flag and confirmed with tests and a live Paper session before moving on.
