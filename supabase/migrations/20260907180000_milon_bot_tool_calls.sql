-- ── Milōn bot tool-call audit ────────────────────────────────────────────────
-- Metadata only (no chat text, no invite tokens). RLS via has_client_access.
-- Writes come from the milon-bot edge function (service role).

CREATE TABLE IF NOT EXISTS public.bot_tool_calls (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool           text NOT NULL,
  args_hash      text,
  args_summary   text,
  result_status  text NOT NULL DEFAULT 'ok'
                   CHECK (result_status IN ('ok', 'empty', 'error')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_tool_calls_client_idx
  ON public.bot_tool_calls (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bot_tool_calls_user_idx
  ON public.bot_tool_calls (user_id, created_at DESC);

COMMENT ON TABLE public.bot_tool_calls IS
  'Audit of in-app Milōn bot tool calls. Args are hashed/summarised — no chat or secrets.';

ALTER TABLE public.bot_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot tool calls read by access" ON public.bot_tool_calls;
CREATE POLICY "bot tool calls read by access"
  ON public.bot_tool_calls FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- Writes are service-role only (milon-bot edge function). No insert/update/delete policies.
