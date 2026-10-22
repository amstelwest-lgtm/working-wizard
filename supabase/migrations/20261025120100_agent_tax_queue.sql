-- Tax Specialist queue and the firm flag.
-- Chief of Staff applies this after 20261025120000. CI does not.
-- The flag is off when a firm has no row. The seed turns it on for one firm.
-- This file does not activate the dispatch cron and does not call a model.
-- No new function is security definer.

CREATE EXTENSION IF NOT EXISTS pgmq;

DO $$ BEGIN PERFORM pgmq.create('agent_tax'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.agent_firm_flags (
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  flag text NOT NULL CHECK (flag = 'tax_specialist_dispatch'),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firm_id, flag)
);

COMMENT ON TABLE public.agent_firm_flags IS
  'Per-firm agent switches. No row means off. tax_specialist_dispatch starts off.';

COMMENT ON COLUMN public.agent_firm_flags.enabled IS
  'False, or no row, means the dispatch does not enqueue. One firm is seeded on.';

CREATE TABLE IF NOT EXISTS public.agent_tax_enqueued (
  send_id uuid PRIMARY KEY REFERENCES public.client_agent_sends(id) ON DELETE CASCADE,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_tax_enqueued IS
  'One row per completed send placed on agent_tax. A second dispatch does not enqueue it again.';

ALTER TABLE public.agent_firm_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tax_enqueued ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_firm_flags FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agent_tax_enqueued FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_firm_flags TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.agent_tax_enqueued TO service_role;

-- The firm row must already exist. A database without it keeps the flag off.
INSERT INTO public.agent_firm_flags (firm_id, flag, enabled)
SELECT id, 'tax_specialist_dispatch', true
FROM public.firms
WHERE id = 'fca0f102-a597-4ec6-8f45-825c57f78797'
ON CONFLICT (firm_id, flag) DO NOTHING;

CREATE OR REPLACE FUNCTION public.agent_queue_name(p_agent public.agent_key)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_agent
    WHEN 'financial_manager' THEN 'agent_fm'
    WHEN 'analyst' THEN 'agent_analyst'
    WHEN 'advisor' THEN 'agent_advisor'
    WHEN 'tax_specialist' THEN 'agent_tax'
  END;
$$;

CREATE OR REPLACE FUNCTION public.agent_queue_allowed(p_queue text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_queue IN (
    'agent_analyst', 'agent_analyst_dlq',
    'agent_fm', 'agent_fm_dlq',
    'agent_advisor', 'agent_advisor_dlq',
    'agent_tax'
  );
$$;
