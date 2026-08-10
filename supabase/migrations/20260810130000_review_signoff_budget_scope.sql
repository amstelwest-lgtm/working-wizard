-- Allow budget review sign-offs alongside financials / cash_forecast.

ALTER TABLE public.client_review_signoffs
  DROP CONSTRAINT IF EXISTS client_review_signoffs_scope_check;

ALTER TABLE public.client_review_signoffs
  ADD CONSTRAINT client_review_signoffs_scope_check
  CHECK (scope IN ('financials', 'cash_forecast', 'budget'));

COMMENT ON COLUMN public.client_review_signoffs.scope IS
  'financials | cash_forecast | budget — staleness vs financials_updated_at / last_forecast_at / budget_updated_at';
