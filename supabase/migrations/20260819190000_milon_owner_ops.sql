-- ============================================================================
-- Milōn platform-owner ops (founder console)
-- Access is NOT granted by RLS to normal users — server functions use
-- service role after checking MILON_OWNER_EMAILS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.milon_ops_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.milon_ops_settings IS
  'Platform-owner feature flags and knobs. Deny-all RLS; service role only.';

CREATE TABLE IF NOT EXISTS public.milon_ops_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paid_at date NOT NULL DEFAULT (CURRENT_DATE),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'ZAR',
  payer_label text,
  plan_code text,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'pending', 'refunded')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS milon_ops_payments_paid_at_idx
  ON public.milon_ops_payments (paid_at DESC);

COMMENT ON TABLE public.milon_ops_payments IS
  'Manual revenue / payment ledger until Stripe (or similar) is live.';

-- Placeholder CRM for the future AI sales / email system
CREATE TABLE IF NOT EXISTS public.milon_ops_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text,
  company text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost', 'nurture')),
  source text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS milon_ops_leads_status_idx
  ON public.milon_ops_leads (status, created_at DESC);

COMMENT ON TABLE public.milon_ops_leads IS
  'Placeholder lead pipe for founder AI sales / email outreach (future build).';

ALTER TABLE public.milon_ops_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milon_ops_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milon_ops_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "milon_ops_settings deny all" ON public.milon_ops_settings;
CREATE POLICY "milon_ops_settings deny all"
  ON public.milon_ops_settings
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "milon_ops_payments deny all" ON public.milon_ops_payments;
CREATE POLICY "milon_ops_payments deny all"
  ON public.milon_ops_payments
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "milon_ops_leads deny all" ON public.milon_ops_leads;
CREATE POLICY "milon_ops_leads deny all"
  ON public.milon_ops_leads
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- Seed default feature flags (idempotent)
INSERT INTO public.milon_ops_settings (key, value) VALUES
  ('feature_flags', '{
    "maintenance_mode": false,
    "signup_open": true,
    "ask_ai_enabled": true,
    "qbo_enabled": true,
    "landing_waitlist_orbit": true,
    "show_pricing": true
  }'::jsonb),
  ('pilot_notes', '{"text":"First-pilot watchlist — edit me from Ops."}'::jsonb)
ON CONFLICT (key) DO NOTHING;
