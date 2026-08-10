-- Budgeting tab Phase 1: persist living FY budget on the client row.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS budget JSONB,
  ADD COLUMN IF NOT EXISTS budget_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS financial_year_start_month INT DEFAULT 3
    CHECK (financial_year_start_month IS NULL OR (financial_year_start_month BETWEEN 1 AND 12));

COMMENT ON COLUMN public.clients.budget IS
  'Living FY budget document (qualification, drivers, scenarios, WC, capex). Shape owned by app BudgetDocument.';
COMMENT ON COLUMN public.clients.budget_updated_at IS
  'Last time clients.budget was saved — for staleness / future sign-off.';
COMMENT ON COLUMN public.clients.financial_year_start_month IS
  '1–12 month when the client FY starts (default 3 = March, common SA).';
