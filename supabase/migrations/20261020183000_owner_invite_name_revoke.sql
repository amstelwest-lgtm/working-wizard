-- Owner invite: optional display name, and a revoke time distinct from expiry.
-- invite_tokens already has RLS on and a deny-all policy for anon and
-- authenticated. This adds columns only. No new policies. No anon grants.
-- No new functions.

ALTER TABLE public.invite_tokens
  ADD COLUMN IF NOT EXISTS invited_name text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

COMMENT ON COLUMN public.invite_tokens.invited_name IS
  'Optional name typed on the owner invite. Shown on the pending row and the join greeting.';

COMMENT ON COLUMN public.invite_tokens.revoked_at IS
  'Set when an accountant revokes the invite. Distinct from a natural expires_at.';
