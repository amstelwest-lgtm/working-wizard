-- Starter is a 14-day trial, not a forever-free plan.
-- Existing firms stay exempt so this deploy does not lock pilots.
-- New inserts default to enforced. The app fails open when this column
-- is missing. Flip a firm on with:
--   UPDATE public.firms SET starter_trial_enforced = true WHERE id = '...';
--
-- Read-only list of firms still exempt. firms.created_at is the only
-- stored timestamp. The live gate uses the Stripe subscription start
-- (start_date, else created) plus 14 days, not this column.
--
-- SELECT f.name,
--        f.created_at AS start_date,
--        floor(extract(epoch FROM (now() - f.created_at)) / 86400)::int AS days_since
-- FROM public.firms f
-- WHERE f.starter_trial_enforced = false
-- ORDER BY f.created_at;

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS starter_trial_enforced boolean;

UPDATE public.firms
SET starter_trial_enforced = false
WHERE starter_trial_enforced IS NULL;

ALTER TABLE public.firms
  ALTER COLUMN starter_trial_enforced SET DEFAULT true;

ALTER TABLE public.firms
  ALTER COLUMN starter_trial_enforced SET NOT NULL;
