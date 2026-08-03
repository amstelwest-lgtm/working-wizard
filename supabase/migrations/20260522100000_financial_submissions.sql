-- ── Financial Submissions ─────────────────────────────────────────────────────
-- Stores every PDF extraction + manual entry submission per client.
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/cujzeoyvnpfokgwfftyd/sql/new

CREATE TABLE IF NOT EXISTS public.financial_submissions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  submitted_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by              UUID REFERENCES auth.users(id),

  -- Period
  period_start              DATE,
  period_end                DATE,
  period_months             INTEGER,
  period_label              TEXT,

  -- Core ratio input fields (typed columns for fast querying)
  revenue                   NUMERIC,
  prior_revenue             NUMERIC,
  cogs                      NUMERIC,
  gross_profit              NUMERIC,
  fixed_costs               NUMERIC,
  labor_cost                NUMERIC,
  ebit                      NUMERIC,
  interest_expense          NUMERIC,
  ebt                       NUMERIC,
  tax                       NUMERIC,
  net_income                NUMERIC,
  total_assets              NUMERIC,
  fixed_assets              NUMERIC,
  current_assets            NUMERIC,
  current_liabilities       NUMERIC,
  total_liabilities         NUMERIC,
  equity                    NUMERIC,
  inventory                 NUMERIC,
  debtors                   NUMERIC,
  creditors                 NUMERIC,
  wip                       NUMERIC,
  cash                      NUMERIC,
  capex                     NUMERIC,
  operating_cash_flow       NUMERIC,
  ebitda                    NUMERIC,
  depreciation              NUMERIC,
  headcount                 INTEGER,

  -- Normalised values (annualised if period != 12 months)
  normalised_values         JSONB,
  normalisation_applied     BOOLEAN DEFAULT false,
  annualisation_factor      NUMERIC,

  -- Full raw AI extraction (everything Gemini returned)
  raw_extraction            JSONB,

  -- Document metadata
  document_type             TEXT,
  financial_statement_type  TEXT,
  extraction_confidence     TEXT,
  extraction_notes          TEXT,
  company_name_extracted    TEXT,

  -- Data quality flags
  gross_profit_reconciles   BOOLEAN,
  balance_sheet_balances    BOOLEAN,
  cash_flow_reconciles      BOOLEAN,

  -- Entry method flags
  manually_entered          BOOLEAN DEFAULT false,
  ai_extracted              BOOLEAN DEFAULT false,
  multi_document_merge      BOOLEAN DEFAULT false,
  document_count            INTEGER DEFAULT 1,

  -- Review flags
  reviewed_by_accountant    BOOLEAN DEFAULT false,
  reviewed_at               TIMESTAMPTZ,
  reviewed_by               UUID REFERENCES auth.users(id)
);

ALTER TABLE public.financial_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accountants can manage submissions"
  ON public.financial_submissions
  FOR ALL
  TO authenticated
  USING (
    submitted_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = financial_submissions.client_id
        AND c.accountant_id = auth.uid()
    )
  );

-- ── Expense Extractions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.expense_extractions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES public.financial_submissions(id) ON DELETE CASCADE,
  rank            INTEGER,
  category        TEXT,
  amount          NUMERIC,
  pct_of_revenue  NUMERIC,
  notes           TEXT
);

ALTER TABLE public.expense_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accountants can manage expense extractions"
  ON public.expense_extractions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.financial_submissions fs
      WHERE fs.id = expense_extractions.submission_id
        AND fs.submitted_by = auth.uid()
    )
  );

-- ── Income Extractions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.income_extractions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES public.financial_submissions(id) ON DELETE CASCADE,
  rank            INTEGER,
  description     TEXT,
  amount          NUMERIC,
  pct_of_total    NUMERIC,
  notes           TEXT
);

ALTER TABLE public.income_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accountants can manage income extractions"
  ON public.income_extractions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.financial_submissions fs
      WHERE fs.id = income_extractions.submission_id
        AND fs.submitted_by = auth.uid()
    )
  );
