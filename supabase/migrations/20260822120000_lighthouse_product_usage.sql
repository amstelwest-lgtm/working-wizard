-- ============================================================================
-- Milōn Lighthouse — product usage (what firms / founders / customers use)
--
-- Authenticated users may INSERT their own rows. Nobody can SELECT via RLS;
-- the Lighthouse console reads via service role after MILON_OWNER_EMAILS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lighthouse_product_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  persona text NOT NULL CHECK (persona IN ('firm', 'founder', 'customer')),
  surface text NOT NULL CHECK (
    surface IN ('owner_app', 'accountant_portal', 'reports', 'other')
  ),
  event_name text NOT NULL,
  feature_key text NOT NULL,
  firm_id uuid,
  client_id uuid,
  session_id text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lighthouse_product_usage_occurred_idx
  ON public.lighthouse_product_usage (occurred_at DESC);

CREATE INDEX IF NOT EXISTS lighthouse_product_usage_feature_idx
  ON public.lighthouse_product_usage (persona, feature_key, occurred_at DESC);

CREATE INDEX IF NOT EXISTS lighthouse_product_usage_user_idx
  ON public.lighthouse_product_usage (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS lighthouse_product_usage_firm_idx
  ON public.lighthouse_product_usage (firm_id, occurred_at DESC)
  WHERE firm_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lighthouse_product_usage_client_idx
  ON public.lighthouse_product_usage (client_id, occurred_at DESC)
  WHERE client_id IS NOT NULL;

COMMENT ON TABLE public.lighthouse_product_usage IS
  'In-app movement and feature use for Lighthouse: firms (practice), founders (owners), customers (members).';

ALTER TABLE public.lighthouse_product_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lighthouse_product_usage insert own"
  ON public.lighthouse_product_usage;
CREATE POLICY "lighthouse_product_usage insert own"
  ON public.lighthouse_product_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "lighthouse_product_usage deny select"
  ON public.lighthouse_product_usage;
CREATE POLICY "lighthouse_product_usage deny select"
  ON public.lighthouse_product_usage
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS "lighthouse_product_usage deny update"
  ON public.lighthouse_product_usage;
CREATE POLICY "lighthouse_product_usage deny update"
  ON public.lighthouse_product_usage
  FOR UPDATE
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "lighthouse_product_usage deny delete"
  ON public.lighthouse_product_usage;
CREATE POLICY "lighthouse_product_usage deny delete"
  ON public.lighthouse_product_usage
  FOR DELETE
  TO authenticated, anon
  USING (false);

GRANT INSERT ON public.lighthouse_product_usage TO authenticated;
