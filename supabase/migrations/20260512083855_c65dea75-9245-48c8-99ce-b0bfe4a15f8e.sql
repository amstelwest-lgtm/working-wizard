ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS financials jsonb,
  ADD COLUMN IF NOT EXISTS cashflow jsonb;