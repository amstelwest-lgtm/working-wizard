-- begin_agent_run returns a column named idempotency_key. That OUT name
-- clashes with agent_runs.idempotency_key in ON CONFLICT, which Postgres
-- reports as "column reference idempotency_key is ambiguous".
-- #variable_conflict use_column makes an unqualified SQL name a table column.
-- Assignments to the OUT names (status, idempotency_key, run_id, is_new) stay
-- PL/pgSQL assignments and are unchanged.
--
-- Audit of every PL/pgSQL function in 20261010160000_agent_foundation.sql,
-- plus the RPCs agent-analyst and agent-dispatch call
-- (begin_agent_run, acquire_agent_lease, heartbeat_agent_lease,
-- release_agent_lease, agent_queue_archive, agent_queue_send,
-- agent_queue_dead_letter, promote_due_agent_events, agent_queue_read,
-- agent_invoke):
--   begin_agent_run          RETURNS TABLE includes idempotency_key, used
--                            unqualified in ON CONFLICT. Replaced below.
--   agent_queue_read         RETURNS TABLE (msg_id, read_ct, message). Every
--                            use is qualified (r.msg_id, r.read_ct, r.message).
--   acquire_agent_lease, heartbeat_agent_lease, release_agent_lease,
--   enqueue_agent_event, agent_queue_send, agent_queue_archive,
--   agent_queue_dead_letter, promote_due_agent_events, agent_invoke,
--   agent_dispatch_tick      scalar returns; parameters are p_* and locals
--                            are v_*, so none share a column name.
--   agent_enqueue_on_statement_upload, agent_messages_guard,
--   agent_messages_route     trigger functions; they read NEW.* only.
-- SQL-language helpers (agent_idempotency_key, agent_input_hash,
-- agent_queue_name, agent_queue_allowed) do not have PL/pgSQL variables.
-- No other function in that set has an OUT name used as an unqualified column.

CREATE OR REPLACE FUNCTION public.begin_agent_run(
  p_agent public.agent_key,
  p_client_id uuid,
  p_trigger text,
  p_inputs text,
  p_audience text,
  p_correlation_id uuid,
  p_attempt integer DEFAULT 1
) RETURNS TABLE (run_id uuid, status text, idempotency_key text, is_new boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_key text;
  v_hash text;
  v_firm uuid;
  v_existing public.agent_runs%ROWTYPE;
BEGIN
  IF p_trigger NOT IN ('sync', 'upload', 'schedule', 'on_demand', 'message', 'retry') THEN
    RAISE EXCEPTION 'invalid agent trigger';
  END IF;
  IF p_audience NOT IN ('owner', 'accountant', 'system') THEN
    RAISE EXCEPTION 'invalid agent audience';
  END IF;
  v_key := public.agent_idempotency_key(p_agent, p_client_id, p_trigger, COALESCE(p_inputs, ''));
  v_hash := public.agent_input_hash(COALESCE(p_inputs, ''));
  SELECT firm_id INTO v_firm FROM public.clients WHERE id = p_client_id;

  INSERT INTO public.agent_runs (
    agent, client_id, firm_id, trigger, audience, idempotency_key, input_hash,
    correlation_id, status, attempt
  ) VALUES (
    p_agent, p_client_id, v_firm, p_trigger, p_audience, v_key, v_hash,
    p_correlation_id, 'queued', GREATEST(COALESCE(p_attempt, 1), 1)
  )
  ON CONFLICT (agent, idempotency_key) DO NOTHING
  RETURNING id INTO run_id;

  IF run_id IS NOT NULL THEN
    status := 'queued';
    idempotency_key := v_key;
    is_new := true;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_existing
    FROM public.agent_runs
   WHERE agent = p_agent
     AND agent_runs.idempotency_key = v_key;
  run_id := v_existing.id;
  status := v_existing.status;
  idempotency_key := v_key;
  is_new := false;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.begin_agent_run(public.agent_key, uuid, text, text, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_agent_run(public.agent_key, uuid, text, text, text, uuid, integer) TO service_role;
