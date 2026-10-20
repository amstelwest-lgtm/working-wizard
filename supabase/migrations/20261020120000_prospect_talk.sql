-- One-agent prospect links (/talk/:agent). Sample chat only. No ledger rows.
-- Apply on your schedule. This file does not run against production by itself.
--
-- Access is service-role only. Row level security is on, and there are no
-- policies for anon or authenticated. Leads stay on trial_leads.
-- No functions. The prospect-talk edge function writes with the service role.

CREATE TABLE IF NOT EXISTS public.prospect_talk_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  agent text NOT NULL CHECK (agent IN ('financial-manager', 'analyst', 'advisor', 'tax-specialist')),
  ip_hash text NOT NULL,
  country text NOT NULL CHECK (country IN ('US', 'ZA')),
  ref text,
  visitor_turns integer NOT NULL DEFAULT 0 CHECK (visitor_turns >= 0),
  lead_email text,
  sample_nonce text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 day')
);

CREATE TABLE IF NOT EXISTS public.prospect_talk_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.prospect_talk_sessions(id) ON DELETE CASCADE,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prospect_talk_sessions_ip_created_idx
  ON public.prospect_talk_sessions (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS prospect_talk_turns_ip_created_idx
  ON public.prospect_talk_turns (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS prospect_talk_turns_created_idx
  ON public.prospect_talk_turns (created_at DESC);

ALTER TABLE public.prospect_talk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_talk_turns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.prospect_talk_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.prospect_talk_turns FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.prospect_talk_sessions TO service_role;
GRANT ALL ON TABLE public.prospect_talk_turns TO service_role;

-- Proof that /talk saved a lead before the sample board opens.
-- /try leaves this null. No new function.
ALTER TABLE public.trial_leads
  ADD COLUMN IF NOT EXISTS sample_nonce text;

CREATE UNIQUE INDEX IF NOT EXISTS trial_leads_sample_nonce_idx
  ON public.trial_leads (sample_nonce)
  WHERE sample_nonce IS NOT NULL;
