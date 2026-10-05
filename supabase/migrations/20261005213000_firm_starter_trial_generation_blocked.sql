-- Mirror of the Vercel Starter-trial work gate for edge functions.
-- Null until checkout return, entitlement resolve, or the billing webhook
-- writes it. Edges treat null as allowed, so a paying firm is not blocked
-- before the first sync. Do not backfill.

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS starter_trial_generation_blocked boolean;

COMMENT ON COLUMN public.firms.starter_trial_generation_blocked IS
  'Null until a Vercel billing sync writes it. True only when an enforced Starter trial has ended. Edge generation checks fail open on null.';
