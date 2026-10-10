-- Refresh a repeated analyst finding instead of inserting it again.
-- last_seen is the dedupe clock. Existing rows start at created_at.

ALTER TABLE public.agent_findings
  ADD COLUMN IF NOT EXISTS last_seen timestamptz;

UPDATE public.agent_findings
   SET last_seen = created_at
 WHERE last_seen IS NULL;

ALTER TABLE public.agent_findings
  ALTER COLUMN last_seen SET DEFAULT now();

ALTER TABLE public.agent_findings
  ALTER COLUMN last_seen SET NOT NULL;

CREATE INDEX IF NOT EXISTS agent_findings_recent_idx
  ON public.agent_findings (client_id, agent, last_seen DESC);
