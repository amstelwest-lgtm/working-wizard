-- Trial demo (/try). Sample sessions only. No ledger rows.
-- Apply on your schedule. This file does not run against production by itself.
--
-- Access is service-role only. Row level security is on, and there are no
-- policies for anon or authenticated. Leads are kept. Sessions and usage
-- older than 7 days are deleted by cleanup_expired_trial_rows.

CREATE TABLE IF NOT EXISTS public.trial_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  ip_hash text,
  country text NOT NULL CHECK (country IN ('US', 'ZA')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE TABLE IF NOT EXISTS public.trial_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.trial_sessions(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL,
  country text NOT NULL CHECK (country IN ('US', 'ZA')),
  consent_at timestamptz NOT NULL,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trial_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.trial_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('analyst', 'profitability', 'cash')),
  tokens integer NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trial_sessions_ip_created_idx
  ON public.trial_sessions (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS trial_leads_email_idx
  ON public.trial_leads (email);

CREATE INDEX IF NOT EXISTS trial_usage_session_idx
  ON public.trial_usage (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS trial_usage_kind_created_idx
  ON public.trial_usage (kind, created_at DESC);

ALTER TABLE public.trial_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.trial_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.trial_leads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.trial_usage FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.trial_sessions TO service_role;
GRANT ALL ON TABLE public.trial_leads TO service_role;
GRANT ALL ON TABLE public.trial_usage TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_expired_trial_rows()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.trial_usage
   WHERE created_at < now() - interval '7 days';
  DELETE FROM public.trial_sessions
   WHERE created_at < now() - interval '7 days';
  -- trial_leads are kept. A deleted session sets trial_leads.session_id null.
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_trial_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_trial_rows() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trial-demo-cleanup') THEN
      PERFORM cron.unschedule('trial-demo-cleanup');
    END IF;
    PERFORM cron.schedule(
      'trial-demo-cleanup',
      '30 3 * * *',
      'SELECT public.cleanup_expired_trial_rows();'
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed: schedule public.cleanup_expired_trial_rows() daily';
  END IF;
END $$;
