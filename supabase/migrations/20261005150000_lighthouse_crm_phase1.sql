-- ============================================================================
-- Lighthouse CRM Phase 1 — empty firm / contact / activity / campaign shape.
--
-- Additive only. Does not ALTER, DROP, or TRUNCATE:
--   milon_ops_leads, lighthouse_touches, lighthouse_inbound,
--   lighthouse_sequences, lighthouse_assets.
-- No INSERT, no backfill, no seed. The console keeps writing milon_ops_leads.
-- Does not read or write RESEND_FROM_EMAIL, auto_send, or the send path.
--
-- Deny-all RLS matches lighthouse_touches / lighthouse_inbound. No GRANT to
-- authenticated or anon. Access stays on the service role, after the
-- owner-console check, in a later phase.
--
-- Spec E16 cadence columns on lighthouse_contacts are nullable and have no
-- writer here. signing_rule defaults to team_only.
-- ============================================================================

-- ── firms ───────────────────────────────────────────────────────────────────
-- legacy_lead_id has no FK until Phase 2, so a lead delete cannot cascade here.
CREATE TABLE IF NOT EXISTS public.lighthouse_firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_lead_id uuid UNIQUE,
  name text,
  country text
    CHECK (country IN ('US', 'SA', 'OTHER')),
  website text,
  size_band text,
  stack text
    CHECK (stack IN ('xero', 'qbo', 'other', 'unknown')),
  icp_score numeric,
  source text,
  owner_label text,
  stage text
    CHECK (stage IN (
      'new', 'researched', 'warmed', 'outreached', 'replied',
      'meeting', 'pilot', 'customer', 'nurture', 'closed_lost', 'suppressed'
    )),
  legacy_stage text,
  next_action_at timestamptz,
  next_action text,
  notes text,
  suppress_reason text,
  campaign_tags text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lighthouse_firms IS
  'CRM firm (prospect). Empty in Phase 1. Not public.firms.';

COMMENT ON COLUMN public.lighthouse_firms.legacy_lead_id IS
  'Lead this firm was copied from. No FK in Phase 1. Phase 2 adds REFERENCES milon_ops_leads(id) ON DELETE SET NULL.';

COMMENT ON COLUMN public.lighthouse_firms.owner_label IS
  'Display name of the human who owns the record. Not an auth.users FK.';

COMMENT ON COLUMN public.lighthouse_firms.campaign_tags IS
  'App-enforced tags (warmup, campaign). No element CHECK until the tag list is stable.';

-- ── contacts ────────────────────────────────────────────────────────────────
-- Email is not unique: live leads can repeat an address.
CREATE TABLE IF NOT EXISTS public.lighthouse_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.lighthouse_firms(id) ON DELETE RESTRICT,
  legacy_lead_id uuid UNIQUE,
  name text,
  email text,
  role text,
  bounce_status text NOT NULL DEFAULT 'none'
    CHECK (bounce_status IN ('none', 'soft', 'hard')),
  suppress boolean NOT NULL DEFAULT false,
  -- Spec E16. Nullable until a later writer. last_engagement is a status
  -- signal, not a timestamp (the time is last_touch_at).
  last_touch_at timestamptz,
  last_delivery_status text,
  last_engagement text,
  next_follow_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lighthouse_contacts IS
  'CRM contact under a firm. Email is not unique. Empty in Phase 1.';

COMMENT ON COLUMN public.lighthouse_contacts.last_delivery_status IS
  'Spec E16. Free-text delivery signal. No CHECK until a vocabulary is fixed.';

COMMENT ON COLUMN public.lighthouse_contacts.last_engagement IS
  'Spec E16. Status or signal, not a timestamp.';

CREATE INDEX IF NOT EXISTS lighthouse_contacts_firm_idx
  ON public.lighthouse_contacts (firm_id);

-- ── activities ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lighthouse_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.lighthouse_firms(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES public.lighthouse_contacts(id) ON DELETE RESTRICT,
  legacy_touch_id uuid UNIQUE,
  legacy_inbound_id uuid UNIQUE,
  type text
    CHECK (type IN (
      'email_out', 'email_in', 'call', 'note', 'meeting',
      'signup', 'opt_out', 'warmup'
    )),
  -- Indexed, not UNIQUE. lighthouse_touches still owns the webhook key.
  provider_message_id text,
  created_by_kind text
    CHECK (created_by_kind IN ('agent', 'human', 'webhook')),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at timestamptz,
  subject text,
  body text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lighthouse_activities IS
  'CRM activity stream. Empty in Phase 1. Send pipeline still edits lighthouse_touches.';

CREATE INDEX IF NOT EXISTS lighthouse_activities_firm_idx
  ON public.lighthouse_activities (firm_id);

CREATE INDEX IF NOT EXISTS lighthouse_activities_contact_idx
  ON public.lighthouse_activities (contact_id);

CREATE INDEX IF NOT EXISTS lighthouse_activities_provider_message_idx
  ON public.lighthouse_activities (provider_message_id);

CREATE INDEX IF NOT EXISTS lighthouse_activities_created_by_user_idx
  ON public.lighthouse_activities (created_by_user_id);

-- ── campaigns ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lighthouse_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_sequence_key text UNIQUE,
  name text,
  geo text
    CHECK (geo IN ('US', 'SA', 'OTHER')),
  daily_send_cap integer
    CHECK (daily_send_cap >= 0),
  status text
    CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  -- NULL until a campaign is armed. When set, only team@trymilon.com.
  from_address text
    CHECK (from_address = 'team@trymilon.com'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lighthouse_campaigns IS
  'CRM campaign. from_address, when set, is only team@trymilon.com. Empty in Phase 1.';

-- ── cadence steps ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lighthouse_cadence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.lighthouse_campaigns(id) ON DELETE RESTRICT,
  legacy_sequence_key text,
  step_no integer NOT NULL,
  day_offset integer NOT NULL,
  template_subject text,
  template_body text,
  signing_rule text NOT NULL DEFAULT 'team_only'
    CHECK (signing_rule IN ('theo_us', 'team_only')),
  asset_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, step_no)
);

COMMENT ON TABLE public.lighthouse_cadence_steps IS
  'One row per campaign step. signing_rule defaults to team_only. Template subject and body stay NULL until deliberately published.';

COMMENT ON COLUMN public.lighthouse_cadence_steps.asset_key IS
  'Sequence-step asset key. Still resolved against lighthouse_assets.';

COMMENT ON COLUMN public.lighthouse_cadence_steps.signing_rule IS
  'team_only unless a later US campaign explicitly sets theo_us.';

-- ── RLS: deny authenticated and anon. No grants. ────────────────────────────
ALTER TABLE public.lighthouse_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lighthouse_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lighthouse_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lighthouse_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lighthouse_cadence_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lighthouse_firms deny all" ON public.lighthouse_firms;
CREATE POLICY "lighthouse_firms deny all" ON public.lighthouse_firms
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "lighthouse_contacts deny all" ON public.lighthouse_contacts;
CREATE POLICY "lighthouse_contacts deny all" ON public.lighthouse_contacts
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "lighthouse_activities deny all" ON public.lighthouse_activities;
CREATE POLICY "lighthouse_activities deny all" ON public.lighthouse_activities
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "lighthouse_campaigns deny all" ON public.lighthouse_campaigns;
CREATE POLICY "lighthouse_campaigns deny all" ON public.lighthouse_campaigns
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "lighthouse_cadence_steps deny all" ON public.lighthouse_cadence_steps;
CREATE POLICY "lighthouse_cadence_steps deny all" ON public.lighthouse_cadence_steps
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
