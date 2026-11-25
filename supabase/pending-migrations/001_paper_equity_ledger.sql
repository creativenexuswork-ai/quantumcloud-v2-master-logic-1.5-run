-- PENDING — NOT APPLIED. Apply only after database access returns and Stage 0 is verified.
-- Additive only: no drops, no type changes, no required columns without defaults.

-- 1) Account scoping on paper tables (nullable; backfill only when exactly one paper account exists per user)
ALTER TABLE public.paper_positions ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE public.paper_trades    ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE public.paper_trades    ADD COLUMN IF NOT EXISTS gross_pnl numeric;
ALTER TABLE public.paper_trades    ADD COLUMN IF NOT EXISTS fees numeric DEFAULT 0;
ALTER TABLE public.paper_trades    ADD COLUMN IF NOT EXISTS slippage numeric DEFAULT 0;
ALTER TABLE public.paper_trades    ADD COLUMN IF NOT EXISTS funding numeric DEFAULT 0;
ALTER TABLE public.paper_stats_daily ADD COLUMN IF NOT EXISTS account_id uuid;
CREATE INDEX IF NOT EXISTS paper_trades_account_idx ON public.paper_trades(account_id);
CREATE INDEX IF NOT EXISTS paper_positions_account_idx ON public.paper_positions(account_id);
COMMENT ON COLUMN public.paper_trades.realized_pnl IS 'Net realized P&L (after fees/slippage/funding)';

-- 2) Opening capital must be explicit; no implicit default
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS opening_capital_set_at timestamptz;
COMMENT ON COLUMN public.accounts.equity IS 'Opening capital (explicitly set). Live equity = opening + ledger/realized + unrealized. Never written by the engine.';

-- 3) Append-only ledger
CREATE TABLE IF NOT EXISTS public.account_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('opening','realized','fee','slippage','funding','reconciliation_adjustment')),
  amount numeric NOT NULL,
  ref_trade_id uuid,
  note text,
  created_by text NOT NULL DEFAULT 'engine'
);
CREATE UNIQUE INDEX IF NOT EXISTS account_ledger_ref_kind_uq ON public.account_ledger(ref_trade_id, kind) WHERE ref_trade_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_ledger_one_opening_uq ON public.account_ledger(account_id) WHERE kind = 'opening';
GRANT SELECT ON public.account_ledger TO authenticated;
GRANT ALL ON public.account_ledger TO service_role;
ALTER TABLE public.account_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own ledger" ON public.account_ledger FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_id AND a.user_id = auth.uid()));
-- No client insert/update/delete: only service role (engine) writes.

-- BACKFILL / RECONCILIATION (manual, per account, after verification — do NOT automate from guesses):
--   a) Verify opening capital from an authoritative record (accounts.equity set by the user/creation flow).
--   b) Verify trade history completeness for that account.
--   c) Insert one 'opening' row and one 'realized' row per verified trade (ref_trade_id prevents duplicates).
--   d) If history is incomplete, insert ONE 'reconciliation_adjustment' row with the audited amount and a note
--      describing the evidence. Never derive opening capital from paper_stats_daily.equity_start.
