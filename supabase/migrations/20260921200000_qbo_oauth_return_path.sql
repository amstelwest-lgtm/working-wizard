-- QuickBooks OAuth return path.
-- Additive. Existing qbo_* tables stay service-role only: RLS is already
-- enabled with no policies. This column does not add a policy.

ALTER TABLE public.qbo_oauth_states
  ADD COLUMN IF NOT EXISTS return_path TEXT;

COMMENT ON COLUMN public.qbo_oauth_states.return_path IS
  'In-app path after OAuth: /app (owner) or /clients/<id> (accountant). Service-role only.';
