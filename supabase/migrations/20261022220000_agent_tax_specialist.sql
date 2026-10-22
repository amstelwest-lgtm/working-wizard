-- Tax Specialist queue. Not applied here. Chief of Staff applies it.
-- Does not deploy an edge function and does not turn the dispatch cron on.
--
-- agent_settings is one global jsonb row, not a column per firm. A boolean
-- true would enable every firm. tax_specialist_enabled stores
-- {"default": false, "firms": {"<firm uuid>": true}} and only that exact id
-- is on. The new agent_key label is added in this file and is not used again
-- until a later transaction, because Postgres will not accept a new enum
-- value in the same transaction that adds it.

ALTER TYPE public.agent_key ADD VALUE IF NOT EXISTS 'tax_specialist';

DO $$ BEGIN PERFORM pgmq.create('agent_tax'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('agent_tax_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

INSERT INTO public.agent_settings (key, value)
VALUES (
  'tax_specialist_enabled',
  jsonb_build_object(
    'default', false,
    'firms', jsonb_build_object(
      'fca0f102-a597-4ec6-8f45-825c57f78797', true
    )
  )
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.agent_tax_specialist_enabled(p_firm_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT (value #> ARRAY['firms', p_firm_id::text]) = 'true'::jsonb
      FROM public.agent_settings
      WHERE key = 'tax_specialist_enabled'
        AND p_firm_id IS NOT NULL
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.agent_tax_specialist_dispatch_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_each(COALESCE(value->'firms', '{}'::jsonb)) AS firm(firm_id, enabled)
        WHERE enabled = 'true'::jsonb
      )
      FROM public.agent_settings
      WHERE key = 'tax_specialist_enabled'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.agent_queue_allowed(p_queue text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_queue IN (
    'agent_analyst', 'agent_analyst_dlq',
    'agent_fm', 'agent_fm_dlq',
    'agent_advisor', 'agent_advisor_dlq',
    'agent_tax', 'agent_tax_dlq'
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
  IF p_queue NOT IN ('agent_analyst', 'agent_fm', 'agent_advisor', 'agent_tax') THEN
    RAISE EXCEPTION 'queue not allowed';
  END IF;
  RETURN QUERY
    SELECT r.msg_id, r.read_ct, r.message
      FROM pgmq.read(p_queue, p_vt, LEAST(GREATEST(p_qty, 1), 5)) r;
END $$;

CREATE OR REPLACE FUNCTION public.agent_queue_dead_letter(
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
  IF v_source NOT IN ('agent_analyst', 'agent_fm', 'agent_advisor', 'agent_tax') THEN
    RAISE EXCEPTION 'queue not allowed';
  END IF;
  v_dlq := CASE v_source
    WHEN 'agent_fm' THEN 'agent_fm_dlq'
    WHEN 'agent_advisor' THEN 'agent_advisor_dlq'
    WHEN 'agent_tax' THEN 'agent_tax_dlq'
    ELSE 'agent_analyst_dlq'
  END;
  v_id := pgmq.send(v_dlq, p_payload, 0);
  PERFORM pgmq.archive(v_source, p_msg_id);
  RETURN v_id;
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
    WHEN 'agent-tax-specialist' THEN 'tax_specialist_enabled'
    ELSE NULL
  END;
  IF v_setting IS NULL THEN
    RAISE EXCEPTION 'function not allowed';
  END IF;
  IF p_function = 'agent-tax-specialist' THEN
    IF p_body->>'firm_id' IS NULL
       OR p_body->>'firm_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT public.agent_tax_specialist_enabled((p_body->>'firm_id')::uuid) THEN
      RETURN;
    END IF;
  ELSIF NOT COALESCE(
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

-- The tick runs when any runner flag is on. The tax flag is a firm map, so
-- it is not cast to boolean. The cron job itself stays inactive.
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
    OR public.agent_tax_specialist_dispatch_enabled()
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

REVOKE ALL ON FUNCTION public.agent_tax_specialist_enabled(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tax_specialist_dispatch_enabled() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_queue_read(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_queue_dead_letter(bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_invoke(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_dispatch_tick() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agent_tax_specialist_enabled(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tax_specialist_dispatch_enabled() TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_queue_read(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_queue_dead_letter(bigint, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_invoke(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_dispatch_tick() TO service_role;
