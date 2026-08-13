-- Monthly budget actuals — SSOT for budget-vs-actuals variance.
-- One current row per (client_id, month). Sources: pdf | qbo | xero | manual.

CREATE TABLE IF NOT EXISTS public.budget_month_actuals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  source TEXT NOT NULL CHECK (source IN ('pdf', 'qbo', 'xero', 'manual')),
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  period_start DATE,
  period_end DATE,
  confidence NUMERIC,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, month)
);

CREATE INDEX IF NOT EXISTS budget_month_actuals_client_month_idx
  ON public.budget_month_actuals (client_id, month DESC);

COMMENT ON TABLE public.budget_month_actuals IS
  'Month-true P&L actuals keyed YYYY-MM for budget variance. PDF now; QBO/Xero later.';
COMMENT ON COLUMN public.budget_month_actuals.totals IS
  'Taxonomy totals: revenue, cogs, grossProfit, overheads*, depreciation, ebit.';
COMMENT ON COLUMN public.budget_month_actuals.lines IS
  'Optional mapped lines [{ taxonomyKey, amount, rawLabel }].';

ALTER TABLE public.budget_month_actuals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "budget_month_actuals select by access" ON public.budget_month_actuals;
DROP POLICY IF EXISTS "budget_month_actuals insert by writer" ON public.budget_month_actuals;
DROP POLICY IF EXISTS "budget_month_actuals update by writer" ON public.budget_month_actuals;
DROP POLICY IF EXISTS "budget_month_actuals delete by writer" ON public.budget_month_actuals;

CREATE POLICY "budget_month_actuals select by access"
  ON public.budget_month_actuals FOR SELECT
  TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "budget_month_actuals insert by writer"
  ON public.budget_month_actuals FOR INSERT
  TO authenticated
  WITH CHECK (public.is_client_writer(auth.uid(), client_id));

CREATE POLICY "budget_month_actuals update by writer"
  ON public.budget_month_actuals FOR UPDATE
  TO authenticated
  USING (public.is_client_writer(auth.uid(), client_id))
  WITH CHECK (public.is_client_writer(auth.uid(), client_id));

CREATE POLICY "budget_month_actuals delete by writer"
  ON public.budget_month_actuals FOR DELETE
  TO authenticated
  USING (public.is_client_writer(auth.uid(), client_id));
