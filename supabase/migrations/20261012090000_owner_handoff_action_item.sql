-- Owner hand-off records which action a queued run belongs to.
-- Writes stay service_role only. Authenticated clients still cannot insert agent_runs.

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS action_item_id uuid REFERENCES public.action_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agent_runs_action_item_idx
  ON public.agent_runs (action_item_id)
  WHERE action_item_id IS NOT NULL;

COMMENT ON COLUMN public.agent_runs.action_item_id IS
  'Set when an owner hands an action to a bot. Service role writes only.';

REVOKE ALL ON public.agent_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_runs TO authenticated;
