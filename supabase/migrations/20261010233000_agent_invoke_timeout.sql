-- pg_net cancels net.http_post at 5000 ms by default. An analyst run takes
-- longer than that, so the invoke was cut off. 60000 ms covers a run.
-- Signature, security, and grants match 20261010160000_agent_foundation.sql.
-- That applied file is not edited.

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
    body := COALESCE(p_body, '{}'::jsonb),
    timeout_milliseconds := 60000
  );
END $$;

REVOKE ALL ON FUNCTION public.agent_invoke(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_invoke(text, jsonb) TO service_role;
