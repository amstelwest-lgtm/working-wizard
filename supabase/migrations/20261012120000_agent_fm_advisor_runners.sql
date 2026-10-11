-- Financial Manager and Advisor runners.
-- Own queues, own dead-letter queues, own agent_settings flags (default false).
-- A finding or other message addressed to either bot enqueues one run.
-- The idempotency key is agent + client + trigger + inputs, same as begin_agent_run.
-- Does not flip any flag and does not activate the dispatch cron.
--
-- Flip (do not run on apply):
--   UPDATE public.agent_settings
--      SET value = 'true'::jsonb, updated_at = now()
--    WHERE key = 'financial_manager_enabled';
--   UPDATE public.agent_settings
--      SET value = 'true'::jsonb, updated_at = now()
--    WHERE key = 'advisor_enabled';
-- The analyst flag stays key 'enabled'. The cron job stays inactive until
-- cron.alter_job is run by hand, as in 20261010160000_agent_foundation.sql.

INSERT INTO public.agent_settings (key, value)
VALUES
  ('financial_manager_enabled', 'false'::jsonb),
  ('advisor_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

DO $$ BEGIN PERFORM pgmq.create('agent_advisor'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('agent_fm_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('agent_advisor_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.agent_queue_allowed(p_queue text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_queue IN (
    'agent_analyst', 'agent_analyst_dlq',
    'agent_fm', 'agent_fm_dlq',
    'agent_advisor', 'agent_advisor_dlq'
  );
$$;

CREATE OR REPLACE FUNCTION public.agent_queue_read(
  p_queue text,
  p_vt integer,
  p_qty integer
) RETURNS TABLE (msg_id bigint, read_ct integer, message jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_queue NOT IN ('agent_analyst', 'agent_fm', 'agent_advisor') THEN
    RAISE EXCEPTION 'queue not allowed';
  END IF;
  RETURN QUERY
    SELECT r.msg_id, r.read_ct, r.message
      FROM pgmq.read(p_queue, p_vt, LEAST(GREATEST(p_qty, 1), 5)) r;
END $$;

DROP FUNCTION IF EXISTS public.agent_queue_dead_letter(bigint, jsonb);
DROP FUNCTION IF EXISTS public.agent_queue_dead_letter(bigint, jsonb, text);

CREATE FUNCTION public.agent_queue_dead_letter(
  p_msg_id bigint,
  p_payload jsonb,
  p_queue text DEFAULT 'agent_analyst'
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
  v_dlq text;
  v_id bigint;
BEGIN
  v_source := COALESCE(NULLIF(p_queue, ''), 'agent_analyst');
  IF v_source NOT IN ('agent_analyst', 'agent_fm', 'agent_advisor') THEN
    RAISE EXCEPTION 'queue not allowed';
  END IF;
  v_dlq := CASE v_source
    WHEN 'agent_fm' THEN 'agent_fm_dlq'
    WHEN 'agent_advisor' THEN 'agent_advisor_dlq'
    ELSE 'agent_analyst_dlq'
  END;
  v_id := pgmq.send(v_dlq, p_payload, 0);
  PERFORM pgmq.archive(v_source, p_msg_id);
  RETURN v_id;
END $$;

-- Messages to a bot enqueue that bot's run. Same message id is one run.
CREATE OR REPLACE FUNCTION public.agent_messages_route()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue text;
  v_queues text[] := ARRAY[]::text[];
  v_payload jsonb;
  v_sent boolean := false;
  v_agent public.agent_key;
  v_inputs text;
  v_run_key text;
BEGIN
  IF NEW.to_agent IS NOT NULL THEN
    v_queues := array_append(v_queues, public.agent_queue_name(NEW.to_agent));
  END IF;
  IF NEW.type = 'finding' AND NEW.from_agent <> 'financial_manager' THEN
    IF NOT ('agent_fm' = ANY (v_queues)) THEN
      v_queues := array_append(v_queues, 'agent_fm');
    END IF;
  END IF;

  FOREACH v_queue IN ARRAY v_queues LOOP
    BEGIN
      IF EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name = v_queue) THEN
        v_agent := CASE v_queue
          WHEN 'agent_fm' THEN 'financial_manager'::public.agent_key
          WHEN 'agent_advisor' THEN 'advisor'::public.agent_key
          WHEN 'agent_analyst' THEN 'analyst'::public.agent_key
          ELSE NULL
        END;
        IF v_agent IS NOT NULL THEN
          v_inputs := 'message:' || NEW.id::text;
          v_run_key := public.agent_idempotency_key(v_agent, NEW.client_id, 'message', v_inputs);
          IF NOT EXISTS (
            SELECT 1
              FROM public.agent_runs
             WHERE agent_runs.agent = v_agent
               AND agent_runs.idempotency_key = v_run_key
          ) THEN
            v_payload := jsonb_build_object(
              'client_id', NEW.client_id,
              'trigger', 'message',
              'inputs', v_inputs,
              'attempt', 1,
              'correlation_id', NEW.correlation_id
            );
            PERFORM pgmq.send(v_queue, v_payload, 0);
          END IF;
          v_sent := true;
        END IF;
      END IF;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END LOOP;

  IF v_sent THEN
    UPDATE public.agent_messages
       SET status = 'delivered',
           delivered_at = now()
     WHERE id = NEW.id
       AND status = 'pending';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.agent_invoke(p_function text, p_body jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_url text;
  v_setting text;
BEGIN
  v_setting := CASE p_function
    WHEN 'agent-analyst' THEN 'enabled'
    WHEN 'agent-financial-manager' THEN 'financial_manager_enabled'
    WHEN 'agent-advisor' THEN 'advisor_enabled'
    ELSE NULL
  END;
  IF v_setting IS NULL THEN
    RAISE EXCEPTION 'function not allowed';
  END IF;
  IF NOT COALESCE(
    (SELECT (value #>> '{}')::boolean FROM public.agent_settings WHERE key = v_setting),
    false
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'email_queue_service_role_key'
   LIMIT 1;
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'supabase_project_url'
   LIMIT 1;
  IF v_key IS NULL OR v_url IS NULL THEN
    RAISE NOTICE 'agent_invoke skipped: vault secrets missing';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/' || p_function,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := COALESCE(p_body, '{}'::jsonb),
    timeout_milliseconds := 60000
  );
END $$;

-- The tick runs when any runner flag is on. A false flag still skips that queue
-- inside the edge function. The cron job itself stays inactive.
CREATE OR REPLACE FUNCTION public.agent_dispatch_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_url text;
BEGIN
  IF NOT (
    COALESCE((SELECT (value #>> '{}')::boolean FROM public.agent_settings WHERE key = 'enabled'), false)
    OR COALESCE((SELECT (value #>> '{}')::boolean FROM public.agent_settings WHERE key = 'financial_manager_enabled'), false)
    OR COALESCE((SELECT (value #>> '{}')::boolean FROM public.agent_settings WHERE key = 'advisor_enabled'), false)
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'email_queue_service_role_key'
   LIMIT 1;
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'supabase_project_url'
   LIMIT 1;
  IF v_key IS NULL OR v_url IS NULL THEN
    RAISE NOTICE 'agent_dispatch_tick skipped: vault secrets missing';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/agent-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb
  );
END $$;

REVOKE ALL ON FUNCTION public.agent_queue_read(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_queue_dead_letter(bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_invoke(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_dispatch_tick() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agent_queue_read(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_queue_dead_letter(bigint, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_invoke(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_dispatch_tick() TO service_role;
