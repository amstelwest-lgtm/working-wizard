-- Agent foundation (step 1).
-- Tables, leases, the analyst queue, and a dispatch cron that is created
-- INACTIVE. Nothing calls an edge function until both statements in the
-- flip block at the bottom of this file are run, after the functions deploy.
--
-- Safe to re-run: CREATE IF NOT EXISTS, CREATE OR REPLACE, DROP IF EXISTS.
--
-- Flip (do not run on apply):
--   UPDATE public.agent_settings
--      SET value = 'true'::jsonb, updated_at = now()
--    WHERE key = 'enabled';
--   SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'agent-dispatch'), active := true);

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgmq;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_key' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.agent_key AS ENUM ('financial_manager', 'analyst', 'advisor');
  END IF;
END $$;

GRANT USAGE ON TYPE public.agent_key TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Runs, messages, findings, memory, leases, settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent              public.agent_key NOT NULL,
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id            uuid REFERENCES public.firms(id) ON DELETE SET NULL,
  trigger            text NOT NULL CHECK (trigger IN ('sync', 'upload', 'schedule', 'on_demand', 'message', 'retry')),
  audience           text NOT NULL CHECK (audience IN ('owner', 'accountant', 'system')),
  idempotency_key    text NOT NULL,
  input_hash         text NOT NULL,
  correlation_id     uuid,
  status             text NOT NULL DEFAULT 'queued' CHECK (status IN (
                       'queued', 'running', 'succeeded', 'partial', 'skipped', 'failed', 'dead', 'cancelled'
                     )),
  stop_reason        text,
  summary            text NOT NULL DEFAULT '',
  attempt            integer NOT NULL DEFAULT 1,
  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer,
  cache_write_tokens integer,
  cost_usd           numeric(10, 5),
  latency_ms         integer,
  error              text,
  trace              jsonb NOT NULL DEFAULT '[]'::jsonb,
  queued_at          timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  UNIQUE (agent, idempotency_key)
);

CREATE INDEX IF NOT EXISTS agent_runs_client_idx
  ON public.agent_runs (client_id, queued_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_memory (
  agent      public.agent_key NOT NULL,
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent, client_id, key)
);

CREATE TABLE IF NOT EXISTS public.agent_findings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent          public.agent_key NOT NULL,
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  run_id         uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  severity       text NOT NULL CHECK (severity IN ('info', 'watch', 'act')),
  title          text NOT NULL,
  detail         text,
  evidence       jsonb NOT NULL,
  as_of          date,
  superseded_by  uuid REFERENCES public.agent_findings(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_findings_evidence_chk CHECK (
    jsonb_typeof(evidence) = 'object'
    AND evidence ? 'figures'
    AND jsonb_typeof(evidence -> 'figures') = 'object'
    AND evidence -> 'figures' <> '{}'::jsonb
  )
);

CREATE INDEX IF NOT EXISTS agent_findings_client_idx
  ON public.agent_findings (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_leases (
  agent      public.agent_key NOT NULL,
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  run_id     uuid NOT NULL,
  holder     text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (agent, client_id)
);

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id         uuid REFERENCES public.firms(id) ON DELETE SET NULL,
  from_agent      public.agent_key NOT NULL,
  to_agent        public.agent_key,
  type            text NOT NULL CHECK (type IN ('finding', 'request', 'answer', 'handoff', 'ack')),
  payload         jsonb NOT NULL,
  correlation_id  uuid NOT NULL,
  in_reply_to     uuid REFERENCES public.agent_messages(id),
  run_id          uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'acked', 'expired', 'dead')),
  hop             integer NOT NULL DEFAULT 0 CHECK (hop >= 0 AND hop <= 4),
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  acked_at        timestamptz
);

CREATE INDEX IF NOT EXISTS agent_messages_inbox_idx
  ON public.agent_messages (to_agent, client_id, status, created_at);

CREATE TABLE IF NOT EXISTS public.agent_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.agent_settings (key, value)
VALUES ('enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.agent_runs IS
  'One background or on-demand agent run. error and trace must not contain secrets.';
COMMENT ON TABLE public.agent_findings IS
  'Append-only observations. evidence.figures is required and must come from stored books.';
COMMENT ON TABLE public.agent_settings IS
  'enabled=false until the dispatch flip SQL is run. The cron job is also created inactive.';

-- ---------------------------------------------------------------------------
-- RLS. Reads follow has_client_access. Writes are service_role only.
-- Memory, leases, and settings are not visible to signed-in users.
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_runs REPLICA IDENTITY FULL;
ALTER TABLE public.agent_messages REPLICA IDENTITY FULL;
ALTER TABLE public.agent_findings REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS "agent runs read by access" ON public.agent_runs;
CREATE POLICY "agent runs read by access"
  ON public.agent_runs FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "agent messages read by access" ON public.agent_messages;
CREATE POLICY "agent messages read by access"
  ON public.agent_messages FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "agent findings read by access" ON public.agent_findings;
CREATE POLICY "agent findings read by access"
  ON public.agent_findings FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

REVOKE ALL ON public.agent_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agent_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agent_findings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agent_memory FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agent_leases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agent_settings FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.agent_runs TO authenticated;
GRANT SELECT ON public.agent_messages TO authenticated;
GRANT SELECT ON public.agent_findings TO authenticated;

GRANT ALL ON public.agent_runs TO service_role;
GRANT ALL ON public.agent_messages TO service_role;
GRANT ALL ON public.agent_findings TO service_role;
GRANT ALL ON public.agent_memory TO service_role;
GRANT ALL ON public.agent_leases TO service_role;
GRANT ALL ON public.agent_settings TO service_role;

-- ---------------------------------------------------------------------------
-- Keys, leases, enqueue. Canonical idempotency material matches src/lib/agent-bus.ts:
--   agent || newline || client || newline || trigger || newline || inputs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agent_idempotency_key(
  p_agent public.agent_key,
  p_client_id uuid,
  p_trigger text,
  p_inputs text
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(
    digest(
      p_agent::text || E'\n' || p_client_id::text || E'\n' || p_trigger || E'\n' || COALESCE(p_inputs, ''),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION public.agent_input_hash(p_inputs text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(COALESCE(p_inputs, ''), 'sha256'), 'hex');
$$;

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
  END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_agent_lease(
  p_agent public.agent_key,
  p_client_id uuid,
  p_run_id uuid,
  p_holder text,
  p_ttl interval DEFAULT interval '5 minutes'
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  -- A live row stays held until expires_at, including for this same run.
  -- Heartbeat renews the holder. A second worker must not enter the loop.
  INSERT INTO public.agent_leases (agent, client_id, run_id, holder, expires_at)
  VALUES (p_agent, p_client_id, p_run_id, p_holder, now() + p_ttl)
  ON CONFLICT (agent, client_id) DO UPDATE
    SET run_id = EXCLUDED.run_id,
        holder = EXCLUDED.holder,
        expires_at = EXCLUDED.expires_at
    WHERE public.agent_leases.expires_at < now()
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END $$;

CREATE OR REPLACE FUNCTION public.heartbeat_agent_lease(
  p_agent public.agent_key,
  p_client_id uuid,
  p_run_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.agent_leases
     SET expires_at = now() + interval '5 minutes'
   WHERE agent = p_agent
     AND client_id = p_client_id
     AND run_id = p_run_id
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END $$;

CREATE OR REPLACE FUNCTION public.release_agent_lease(
  p_agent public.agent_key,
  p_client_id uuid,
  p_run_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.agent_leases
   WHERE agent = p_agent
     AND client_id = p_client_id
     AND run_id = p_run_id;
  RETURN FOUND;
END $$;

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

-- 10-minute debounce per analyst+client. Clients with no activity for 30 days are skipped.
-- p_activity_at is the latest activity BEFORE this write. Null asks the function
-- to ignore books timestamps from the last minute (the write in progress).
CREATE OR REPLACE FUNCTION public.enqueue_agent_event(
  p_client_id uuid,
  p_trigger text,
  p_activity_at timestamptz DEFAULT NULL,
  p_inputs text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created timestamptz;
  v_login timestamptz;
  v_books timestamptz;
  v_prev_snap timestamptz;
  v_activity timestamptz;
  v_pending jsonb;
  v_consumed boolean;
  v_existing_after timestamptz;
  v_run_after timestamptz;
BEGIN
  IF p_trigger NOT IN ('sync', 'upload', 'schedule', 'on_demand', 'message', 'retry') THEN
    RAISE EXCEPTION 'invalid agent trigger';
  END IF;

  SELECT created_at, last_login_at, financials_updated_at
    INTO v_created, v_login, v_books
    FROM public.clients
   WHERE id = p_client_id;
  IF v_created IS NULL THEN
    RETURN jsonb_build_object('status', 'missing_client');
  END IF;

  IF p_activity_at IS NOT NULL THEN
    v_activity := p_activity_at;
  ELSE
    SELECT max(created_at) INTO v_prev_snap
      FROM public.client_financial_snapshots
     WHERE client_id = p_client_id
       AND created_at < now() - interval '1 minute';
    IF v_books IS NOT NULL AND v_books >= now() - interval '1 minute' THEN
      v_books := NULL;
    END IF;
    v_activity := GREATEST(
      v_created,
      COALESCE(v_login, v_created),
      COALESCE(v_books, v_created),
      COALESCE(v_prev_snap, v_created)
    );
  END IF;

  IF v_activity < now() - interval '30 days' THEN
    RETURN jsonb_build_object('status', 'skipped_idle');
  END IF;

  SELECT value INTO v_pending
    FROM public.agent_memory
   WHERE agent = 'analyst'
     AND client_id = p_client_id
     AND key = 'pending_event';

  v_consumed := COALESCE((v_pending->>'consumed')::boolean, true);
  BEGIN
    v_existing_after := NULLIF(v_pending->>'run_after', '')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_existing_after := NULL;
  END;

  IF v_pending IS NOT NULL AND v_consumed = false AND v_existing_after IS NOT NULL AND v_existing_after > now() THEN
    UPDATE public.agent_memory
       SET value = v_pending || jsonb_build_object(
             'inputs', COALESCE(p_inputs, v_pending->>'inputs', '')
           ),
           updated_at = now()
     WHERE agent = 'analyst'
       AND client_id = p_client_id
       AND key = 'pending_event';
    RETURN jsonb_build_object('status', 'coalesced', 'run_after', v_existing_after);
  END IF;

  v_run_after := now() + interval '10 minutes';
  INSERT INTO public.agent_memory (agent, client_id, key, value)
  VALUES (
    'analyst',
    p_client_id,
    'pending_event',
    jsonb_build_object(
      'trigger', p_trigger,
      'inputs', COALESCE(p_inputs, ''),
      'run_after', v_run_after,
      'consumed', false
    )
  )
  ON CONFLICT (agent, client_id, key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  RETURN jsonb_build_object('status', 'scheduled', 'run_after', v_run_after);
END $$;

CREATE OR REPLACE FUNCTION public.agent_enqueue_on_statement_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source IS NULL OR NEW.source NOT IN ('upload', 'pdf_upload', 'financial_statement') THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.enqueue_agent_event(NEW.client_id, 'upload', NULL, NEW.id::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'enqueue_agent_event skipped: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS agent_enqueue_on_statement_upload ON public.client_financial_snapshots;
CREATE TRIGGER agent_enqueue_on_statement_upload
  AFTER INSERT OR UPDATE OF source, financials, ratios, period_date, period_label
  ON public.client_financial_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_enqueue_on_statement_upload();

-- ---------------------------------------------------------------------------
-- Message guard + routing. Findings are copied onto the financial manager queue.
-- A missing queue does not fail the insert (step 1 creates analyst + fm).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agent_messages_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.hop < 0 OR NEW.hop > 4 THEN
    RAISE EXCEPTION 'agent message hop limit is 4';
  END IF;
  IF NEW.to_agent IS NOT NULL AND NEW.to_agent = NEW.from_agent THEN
    RAISE EXCEPTION 'an agent cannot message itself';
  END IF;
  IF (
    SELECT count(*)
      FROM public.agent_messages
     WHERE correlation_id = NEW.correlation_id
  ) >= 12 THEN
    RAISE EXCEPTION 'agent correlation is capped at 12 messages';
  END IF;
  RETURN NEW;
END $$;

-- AFTER INSERT cannot assign NEW. Delivery is an UPDATE so a missing queue
-- leaves the row pending instead of failing the insert.
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
BEGIN
  v_payload := jsonb_build_object('message_id', NEW.id, 'client_id', NEW.client_id, 'type', NEW.type);
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
        PERFORM pgmq.send(v_queue, v_payload, 0);
        v_sent := true;
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

DROP TRIGGER IF EXISTS agent_messages_guard ON public.agent_messages;
CREATE TRIGGER agent_messages_guard
  BEFORE INSERT ON public.agent_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_messages_guard();

DROP TRIGGER IF EXISTS agent_messages_route ON public.agent_messages;
CREATE TRIGGER agent_messages_route
  AFTER INSERT ON public.agent_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_messages_route();

-- ---------------------------------------------------------------------------
-- Queues. analyst is drained in step 1. agent_fm receives findings and waits.
-- ---------------------------------------------------------------------------

DO $$ BEGIN PERFORM pgmq.create('agent_analyst'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('agent_analyst_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('agent_fm'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.agent_queue_allowed(p_queue text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_queue IN ('agent_analyst', 'agent_analyst_dlq', 'agent_fm');
$$;

CREATE OR REPLACE FUNCTION public.agent_queue_send(
  p_queue text,
  p_payload jsonb,
  p_delay integer DEFAULT 0
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.agent_queue_allowed(p_queue) THEN
    RAISE EXCEPTION 'queue not allowed';
  END IF;
  RETURN pgmq.send(p_queue, p_payload, GREATEST(COALESCE(p_delay, 0), 0));
END $$;

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
  IF p_queue <> 'agent_analyst' THEN
    RAISE EXCEPTION 'queue not allowed';
  END IF;
  RETURN QUERY
    SELECT r.msg_id, r.read_ct, r.message
      FROM pgmq.read(p_queue, p_vt, LEAST(GREATEST(p_qty, 1), 5)) r;
END $$;

CREATE OR REPLACE FUNCTION public.agent_queue_archive(
  p_queue text,
  p_msg_id bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.agent_queue_allowed(p_queue) THEN
    RAISE EXCEPTION 'queue not allowed';
  END IF;
  RETURN pgmq.archive(p_queue, p_msg_id);
END $$;

CREATE OR REPLACE FUNCTION public.agent_queue_dead_letter(
  p_msg_id bigint,
  p_payload jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  v_id := pgmq.send('agent_analyst_dlq', p_payload, 0);
  PERFORM pgmq.archive('agent_analyst', p_msg_id);
  RETURN v_id;
END $$;

-- Moves due analyst events onto the queue. No-ops while agent_settings.enabled is false.
-- Events more than 30 minutes past run_after are marked stale and not sent.
CREATE OR REPLACE FUNCTION public.promote_due_agent_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_after timestamptz;
  v_count integer := 0;
  v_payload jsonb;
BEGIN
  IF NOT COALESCE(
    (SELECT (value #>> '{}')::boolean FROM public.agent_settings WHERE key = 'enabled'),
    false
  ) THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT agent, client_id, value
      FROM public.agent_memory
     WHERE agent = 'analyst'
       AND key = 'pending_event'
       AND COALESCE((value->>'consumed')::boolean, false) = false
     FOR UPDATE
  LOOP
    BEGIN
      v_after := NULLIF(v_row.value->>'run_after', '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_after := NULL;
    END;
    IF v_after IS NULL OR v_after > now() THEN
      CONTINUE;
    END IF;
    IF v_after < now() - interval '30 minutes' THEN
      UPDATE public.agent_memory
         SET value = v_row.value || jsonb_build_object('consumed', true, 'skip_reason', 'stale'),
             updated_at = now()
       WHERE agent = v_row.agent
         AND client_id = v_row.client_id
         AND key = 'pending_event';
      CONTINUE;
    END IF;

    v_payload := jsonb_build_object(
      'client_id', v_row.client_id,
      'trigger', COALESCE(v_row.value->>'trigger', 'sync'),
      'inputs', COALESCE(v_row.value->>'inputs', ''),
      'attempt', 1
    );
    PERFORM public.agent_queue_send('agent_analyst', v_payload, 0);
    UPDATE public.agent_memory
       SET value = v_row.value || jsonb_build_object('consumed', true),
           updated_at = now()
     WHERE agent = v_row.agent
       AND client_id = v_row.client_id
       AND key = 'pending_event';
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- pg_net call used by the dispatcher. Refuses to run while the flag is false.
CREATE OR REPLACE FUNCTION public.agent_invoke(p_function text, p_body jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_url text;
BEGIN
  IF p_function NOT IN ('agent-analyst') THEN
    RAISE EXCEPTION 'function not allowed';
  END IF;
  IF NOT COALESCE(
    (SELECT (value #>> '{}')::boolean FROM public.agent_settings WHERE key = 'enabled'),
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
    body := COALESCE(p_body, '{}'::jsonb)
  );
END $$;

-- Cron body. The job is inserted inactive. This function also checks the flag.
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
  IF NOT COALESCE(
    (SELECT (value #>> '{}')::boolean FROM public.agent_settings WHERE key = 'enabled'),
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

REVOKE ALL ON FUNCTION public.agent_idempotency_key(public.agent_key, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_input_hash(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_agent_lease(public.agent_key, uuid, uuid, text, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_agent_lease(public.agent_key, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_agent_lease(public.agent_key, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_agent_run(public.agent_key, uuid, text, text, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_agent_event(uuid, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_queue_send(text, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_queue_read(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_queue_archive(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_queue_dead_letter(bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_due_agent_events() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_invoke(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_dispatch_tick() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agent_idempotency_key(public.agent_key, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_input_hash(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_agent_lease(public.agent_key, uuid, uuid, text, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_agent_lease(public.agent_key, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_agent_lease(public.agent_key, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_agent_run(public.agent_key, uuid, text, text, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_agent_event(uuid, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_queue_send(text, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_queue_read(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_queue_archive(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_queue_dead_letter(bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_due_agent_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_invoke(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_dispatch_tick() TO service_role;

-- Realtime for the desk (step 1b reads these). Publication may be absent locally.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_runs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_runs;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_messages;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_findings'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_findings;
    END IF;
  END IF;
END $$;

-- Schedule the dispatcher every minute, then turn the job off.
-- Re-running unschedules the previous job and leaves the new one inactive.
-- The migration role cannot write cron.job rows; cron.alter_job is the granted path.
-- A failure here aborts the migration.
DO $$
DECLARE
  v_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-dispatch') THEN
      PERFORM cron.unschedule('agent-dispatch');
    END IF;
    v_id := cron.schedule(
      'agent-dispatch',
      '* * * * *',
      $cron$SELECT public.agent_dispatch_tick()$cron$
    );
    PERFORM cron.alter_job(job_id := v_id, active := false);
  END IF;
END $$;
