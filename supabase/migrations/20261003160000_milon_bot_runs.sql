-- Milonbot objective runs.
-- bot_tool_calls stays an audit of tool name + args hash. It has no room for
-- an objective, a stop reason, outstanding questions, or a verified trace.
-- This table is that record. Writes are service-role only (the edge function).

CREATE TABLE IF NOT EXISTS public.milon_bot_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  audience              text NOT NULL CHECK (audience IN ('owner', 'accountant')),
  objective             text NOT NULL,
  status                text NOT NULL CHECK (status IN (
                          'objective_complete',
                          'no_further_action',
                          'insufficient_information',
                          'tool_blocked',
                          'needs_human',
                          'safety_limit'
                        )),
  summary               text NOT NULL DEFAULT '',
  escalation_reason     text,
  outstanding_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS milon_bot_runs_client_idx
  ON public.milon_bot_runs (client_id, created_at DESC);

COMMENT ON TABLE public.milon_bot_runs IS
  'One Milonbot objective: status, escalation, and the verified tool trace. No invite tokens.';

ALTER TABLE public.milon_bot_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "milon bot runs read by access" ON public.milon_bot_runs;
CREATE POLICY "milon bot runs read by access"
  ON public.milon_bot_runs FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));
