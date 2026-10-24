-- Proves the lock migration: anon can still call the acknowledgement
-- RPCs, a sample of revoked functions fail for anon, and authenticated /
-- service_role keep the grants their callers need. Runs after the migration
-- has been applied twice.

CREATE OR REPLACE FUNCTION public._exec_lock_call(p_role name, p_sql text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', p_role, true);
  -- PERFORM lives in PL/pgSQL. SET LOCAL lasts for the whole transaction,
  -- so the caller's role is restored even when the call is denied.
  BEGIN
    EXECUTE format('DO $body$ BEGIN PERFORM %s; END $body$', p_sql);
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config('role', 'none', true);
      RAISE;
  END;
  PERFORM set_config('role', 'none', true);
END;
$$;

DO $$
DECLARE
  found boolean;
  got bigint;
  health public.action_health;
BEGIN
  -- Kept: logged-out /ack/:token still runs both RPCs as anon.
  PERFORM public._exec_lock_call(
    'anon',
    $sql$public.preview_advisory_delivery_ack('tok')$sql$
  );
  PERFORM public._exec_lock_call(
    'anon',
    $sql$public.acknowledge_advisory_delivery('tok')$sql$
  );

  IF NOT has_function_privilege('anon', 'public.preview_advisory_delivery_ack(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost preview_advisory_delivery_ack';
  END IF;
  IF NOT has_function_privilege('anon', 'public.acknowledge_advisory_delivery(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost acknowledge_advisory_delivery';
  END IF;

  -- Revoked sample. Each name is one the advisor flagged and the app does
  -- not call before login.
  FOR found IN
    SELECT has_function_privilege('anon', sig, 'EXECUTE')
    FROM (VALUES
      ('public.enqueue_email(text,jsonb)'),
      ('public.read_email_batch(text,integer,integer)'),
      ('public.delete_email(text,bigint)'),
      ('public.move_to_dlq(text,text,bigint,jsonb)'),
      ('public.delete_own_account()'),
      ('public.mint_owner_invite(uuid)'),
      ('public.mint_accountant_invite(uuid,text)'),
      ('public.ensure_own_client(text,jsonb)'),
      ('public.create_firm_client(text,uuid,text,jsonb)'),
      ('public.write_audit_log(text,uuid,uuid,uuid,jsonb,uuid)'),
      ('public.has_client_access(uuid,uuid)'),
      ('public.find_nudge_candidates(timestamp with time zone)'),
      ('public.handle_new_user()'),
      ('public.has_role(uuid,public.app_role)')
    ) AS v(sig)
  LOOP
    IF found THEN
      RAISE EXCEPTION 'anon can still execute a revoked function';
    END IF;
  END LOOP;

  BEGIN
    PERFORM public._exec_lock_call(
      'anon',
      $sql$public.enqueue_email('q', '{}'::jsonb)$sql$
    );
    RAISE EXCEPTION 'anon call to enqueue_email succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM public._exec_lock_call(
      'anon',
      $sql$public.ensure_own_client('Acme', '{}'::jsonb)$sql$
    );
    RAISE EXCEPTION 'anon call to ensure_own_client succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM public._exec_lock_call(
      'anon',
      $sql$public.delete_own_account()$sql$
    );
    RAISE EXCEPTION 'anon call to delete_own_account succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  -- Signed-in app calls.
  PERFORM public._exec_lock_call(
    'authenticated',
    $sql$public.ensure_own_client('Acme', '{}'::jsonb)$sql$
  );
  PERFORM public._exec_lock_call(
    'authenticated',
    $sql$public.delete_own_account()$sql$
  );
  PERFORM public._exec_lock_call(
    'authenticated',
    $sql$public.mint_owner_invite('00000000-0000-0000-0000-000000000004'::uuid)$sql$
  );
  PERFORM public._exec_lock_call(
    'authenticated',
    $sql$public.has_client_access(
      '00000000-0000-0000-0000-000000000004'::uuid,
      '00000000-0000-0000-0000-000000000005'::uuid
    )$sql$
  );
  PERFORM public._exec_lock_call(
    'authenticated',
    $sql$public.preview_advisory_delivery_ack('tok')$sql$
  );

  BEGIN
    PERFORM public._exec_lock_call(
      'authenticated',
      $sql$public.enqueue_email('q', '{}'::jsonb)$sql$
    );
    RAISE EXCEPTION 'authenticated call to enqueue_email succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  -- Edge functions and the email worker use service_role. Empty search_path
  -- must still resolve schema-qualified pgmq calls.
  PERFORM public._exec_lock_call(
    'service_role',
    $sql$public.enqueue_email('transactional_emails', '{}'::jsonb)$sql$
  );
  PERFORM public._exec_lock_call(
    'service_role',
    $sql$public.read_email_batch('transactional_emails', 10, 30)$sql$
  );
  PERFORM public._exec_lock_call(
    'service_role',
    $sql$public.delete_email('transactional_emails', 1)$sql$
  );
  PERFORM public._exec_lock_call(
    'service_role',
    $sql$public.move_to_dlq('transactional_emails', 'dlq', 1, '{}'::jsonb)$sql$
  );
  PERFORM public._exec_lock_call(
    'service_role',
    $sql$public.find_nudge_candidates(now())$sql$
  );

  SELECT public.enqueue_email('transactional_emails', '{}'::jsonb) INTO got;
  IF got IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'enqueue_email did not reach pgmq.send, got %', got;
  END IF;

  -- Signup trigger runs as supabase_auth_admin, not as anon.
  IF NOT has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'EXECUTE') THEN
    RAISE EXCEPTION 'supabase_auth_admin lost handle_new_user';
  END IF;
  IF has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute handle_new_user';
  END IF;

  -- PUBLIC no longer carries EXECUTE, including on the functions anon keeps.
  IF has_function_privilege('public', 'public.enqueue_email(text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can still execute enqueue_email';
  END IF;
  IF has_function_privilege('public', 'public.preview_advisory_delivery_ack(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can still execute preview_advisory_delivery_ack';
  END IF;

  -- search_path pin still resolves built-ins and public enums.
  IF public.practice_can('partner', 'sign_off') IS NOT TRUE THEN
    RAISE EXCEPTION 'practice_can broke after search_path pin';
  END IF;
  IF analytics.jsonb_is_blank('{}'::jsonb) IS NOT TRUE THEN
    RAISE EXCEPTION 'analytics.jsonb_is_blank broke after search_path pin';
  END IF;
  SELECT public.action_item_health('done', NULL, 100, now()) INTO health;
  IF health IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'action_item_health broke after search_path pin, got %', health;
  END IF;

  IF (
    SELECT proconfig::text
    FROM pg_proc
    WHERE proname = 'enqueue_email'
      AND pronamespace = 'public'::regnamespace
  ) NOT LIKE '%search_path=%' THEN
    RAISE EXCEPTION 'enqueue_email search_path was not pinned';
  END IF;
END $$;

-- New functions must not inherit anon or PUBLIC execute.
CREATE FUNCTION public._exec_lock_future_probe()
RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public._exec_lock_future_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'new function is executable by anon';
  END IF;
  IF has_function_privilege('public', 'public._exec_lock_future_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'new function is executable by PUBLIC';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public._exec_lock_future_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'new function is not executable by authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public._exec_lock_future_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'new function is not executable by service_role';
  END IF;
END $$;

DROP FUNCTION public._exec_lock_future_probe();
DROP FUNCTION public._exec_lock_call(name, text);
