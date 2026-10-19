-- /try call requests and lead alerts. Sample only. No ledger rows.
-- Apply on your schedule. This file does not run against production by itself.
--
-- Access is service-role only. Row level security is on, and there are no
-- policies for anon or authenticated. Alerts and call requests are kept.

CREATE TABLE IF NOT EXISTS public.trial_lead_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('demo_view', 'trial_start')),
  dedupe_key text NOT NULL,
  country text,
  email text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trial_lead_alerts_kind_dedupe UNIQUE (kind, dedupe_key)
);

CREATE TABLE IF NOT EXISTS public.trial_call_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.trial_sessions(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL,
  country text NOT NULL CHECK (country IN ('US', 'ZA')),
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  visitor_timezone text NOT NULL,
  status text NOT NULL CHECK (status IN ('saved', 'booked')),
  meet_url text,
  calendar_event_id text,
  ip_hash text,
  consent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trial_lead_alerts_kind_created_idx
  ON public.trial_lead_alerts (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS trial_call_requests_ip_created_idx
  ON public.trial_call_requests (ip_hash, created_at DESC);

ALTER TABLE public.trial_lead_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_call_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.trial_lead_alerts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.trial_call_requests FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.trial_lead_alerts TO service_role;
GRANT ALL ON TABLE public.trial_call_requests TO service_role;
