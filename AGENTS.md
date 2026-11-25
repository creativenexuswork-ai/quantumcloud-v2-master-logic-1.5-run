# AGENTS.md

- Money-moving engine rules (equity, sizing, exits, governor, mode/risk normalization) live in `supabase/functions/_shared/paper-core.ts` as pure functions; edge functions import them and `tests/` covers them — one implementation, tested as deployed.
- Equity is never defaulted: missing/ambiguous paper account returns `EQUITY_UNAVAILABLE` and blocks new entries; compounding base is opening capital + all realized P&L, daily snapshots are reconciliation-only — prevents fake balances and double counting.
- Daily halt stays removed; drawdown/exposure limits are computed per tick by the governor and only throttle new entries, never persisted — avoids stuck state across accounts.
- Schema changes awaiting verified database access go in `supabase/pending-migrations/` and are applied only through the migration tool after verification.
