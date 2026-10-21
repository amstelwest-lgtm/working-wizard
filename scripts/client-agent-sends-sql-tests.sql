-- Send-an-agent tables. Runs after 20261021210000_client_agent_sends.sql
-- on a database that already has firms, clients, and is_firm_member.
-- Deletes its own rows. Does not print tokens.

\set ON_ERROR_STOP on

GRANT SELECT ON public.clients, public.firms, public.firm_memberships TO service_role;
GRANT SELECT ON public.clients TO authenticated;

DO $$
DECLARE
  v_member uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '22222222-2222-4222-8222-222222222222';
  v_client_owner uuid := '33333333-3333-4333-8333-333333333333';
  v_other uuid := '44444444-4444-4444-8444-444444444444';
  v_firm uuid := '55555555-5555-4555-8555-555555555555';
  v_other_firm uuid := '66666666-6666-4666-8666-666666666666';
  v_client uuid := '77777777-7777-4777-8777-777777777777';
  v_send uuid := '88888888-8888-4888-8888-888888888888';
  v_hash text := repeat('ab', 32);
  v_expires timestamptz;
  v_touched timestamptz;
  v_count int;
  v_definer boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_agent_sends'
      AND column_name = 'token'
  ) THEN
    RAISE EXCEPTION 'raw token column must not exist';
  END IF;

  SELECT bool_or(p.prosecdef) INTO v_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'client_agent_send_guard_firm',
      'client_agent_send_item_guard_consent',
      'client_agent_send_item_touch'
    );
  IF v_definer IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'guard functions must not be security definer';
  END IF;

  IF has_table_privilege('anon', 'public.client_agent_sends', 'SELECT')
     OR has_table_privilege('anon', 'public.client_agent_send_items', 'SELECT')
     OR has_table_privilege('anon', 'public.client_agent_send_attempts', 'SELECT')
     OR has_table_privilege('anon', 'public.client_agent_sends', 'INSERT') THEN
    RAISE EXCEPTION 'anon must have no table privileges';
  END IF;

  IF has_table_privilege('authenticated', 'public.client_agent_sends', 'INSERT')
     OR has_table_privilege('authenticated', 'public.client_agent_sends', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.client_agent_sends', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.client_agent_sends', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated may select sends and must not write them';
  END IF;

  IF has_table_privilege('authenticated', 'public.client_agent_send_attempts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.client_agent_send_attempts', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated must not touch attempt rows';
  END IF;

  IF has_function_privilege('anon', 'public.client_agent_send_guard_firm()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.client_agent_send_guard_firm()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.client_agent_send_item_guard_consent()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.client_agent_send_item_guard_consent()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.client_agent_send_item_touch()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.client_agent_send_item_touch()', 'EXECUTE') THEN
    RAISE EXCEPTION 'guard functions must not be executable without the service role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname LIKE 'client_agent_send%'
      AND p.polcmd <> 'r'
  ) THEN
    RAISE EXCEPTION 'only select policies are allowed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'client_agent_send_attempts'
  ) THEN
    RAISE EXCEPTION 'attempt log must have no policy';
  END IF;

  DELETE FROM public.client_agent_send_items WHERE send_id = v_send;
  DELETE FROM public.client_agent_send_attempts WHERE send_id = v_send;
  DELETE FROM public.client_agent_sends WHERE id = v_send;
  DELETE FROM public.clients WHERE id = v_client;
  DELETE FROM public.firm_memberships WHERE firm_id IN (v_firm, v_other_firm);
  DELETE FROM public.firms WHERE id IN (v_firm, v_other_firm);
  DELETE FROM auth.users WHERE id IN (v_member, v_owner, v_client_owner, v_other);

  INSERT INTO auth.users (id, email) VALUES
    (v_member, 'cas-member@example.test'),
    (v_owner, 'cas-owner@example.test'),
    (v_client_owner, 'cas-client@example.test'),
    (v_other, 'cas-other@example.test');

  INSERT INTO public.firms (id, name, owner_user_id) VALUES
    (v_firm, 'cas firm', v_owner),
    (v_other_firm, 'cas other firm', v_other);

  INSERT INTO public.firm_memberships (firm_id, user_id, role) VALUES
    (v_firm, v_member, 'member'),
    (v_other_firm, v_other, 'member');

  INSERT INTO public.clients (id, name, owner_user_id, firm_id) VALUES
    (v_client, 'cas client', v_client_owner, v_firm);

  INSERT INTO public.client_agent_sends (
    id, firm_id, client_id, agent, token_hash, sent_by
  ) VALUES (
    v_send, v_firm, v_client, 'tax-specialist', v_hash, v_owner
  )
  RETURNING expires_at INTO v_expires;

  IF v_expires < now() + interval '13 days' OR v_expires > now() + interval '15 days' THEN
    RAISE EXCEPTION 'default expiry must be 14 days, got %', v_expires;
  END IF;

  INSERT INTO public.client_agent_send_items (send_id, item_key, totals_only) VALUES
    (v_send, 'irp5', false),
    (v_send, 'medical_aid_certificate', true),
    (v_send, 'ra_contribution_certificate', false),
    (v_send, 'it3b', false),
    (v_send, 'practice_income_expenses', false);

  BEGIN
    UPDATE public.client_agent_send_items
      SET totals_only = false
      WHERE send_id = v_send AND item_key = 'medical_aid_certificate';
    RAISE EXCEPTION 'medical item must be totals only';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.client_agent_sends (
      firm_id, client_id, agent, token_hash, sent_by
    ) VALUES (
      v_other_firm, v_client, 'tax-specialist', repeat('cd', 32), v_owner
    );
    RAISE EXCEPTION 'mismatched firm must be refused';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.client_agent_send_items
      SET mime = 'application/pdf', size_bytes = 1200, storage_path = 'irp5.pdf'
      WHERE send_id = v_send AND item_key = 'irp5';
    RAISE EXCEPTION 'a file before consent must be refused';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  UPDATE public.client_agent_sends
    SET consent_at = now(), consent_notice_version = 'popia-v1'
    WHERE id = v_send;

  UPDATE public.client_agent_send_items
    SET mime = 'application/pdf',
        size_bytes = 1200,
        storage_path = 'irp5.pdf',
        status = 'received',
        quality = 'usable'
    WHERE send_id = v_send AND item_key = 'irp5';

  BEGIN
    UPDATE public.client_agent_sends
      SET consent_at = NULL, consent_notice_version = NULL
      WHERE id = v_send;
    RAISE EXCEPTION 'consent must stay once a file is stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.client_agent_send_items
      SET mime = 'image/gif', size_bytes = 10
      WHERE send_id = v_send AND item_key = 'it3b';
    RAISE EXCEPTION 'gif must be refused';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.client_agent_send_items
      SET mime = 'image/png', size_bytes = 20971521
      WHERE send_id = v_send AND item_key = 'it3b';
    RAISE EXCEPTION 'oversize file must be refused';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.client_agent_send_items
      SET status = 'received', quality = 'incomplete', explanation = '   '
      WHERE send_id = v_send AND item_key = 'it3b';
    RAISE EXCEPTION 'incomplete quality needs an explanation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  UPDATE public.client_agent_send_items
    SET status = 'received', quality = 'poor', explanation = 'The scan is cut off. This is all they have.'
    WHERE send_id = v_send AND item_key = 'it3b';

  BEGIN
    INSERT INTO public.client_agent_send_items (send_id, item_key, totals_only)
    VALUES (v_send, 'other', false);
    RAISE EXCEPTION 'other without label or explanation must be refused';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.client_agent_send_items (send_id, item_key, totals_only, label)
    VALUES (v_send, 'other', false, '   ');
    RAISE EXCEPTION 'blank other label must be refused';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.client_agent_send_items (send_id, item_key, totals_only, label) VALUES
    (v_send, 'bank_statements', false, NULL),
    (v_send, 'travel_logbook', false, NULL),
    (v_send, 'other', false, 'Extra certificate');
  DELETE FROM public.client_agent_send_items
  WHERE send_id = v_send AND item_key IN ('bank_statements', 'travel_logbook', 'other');

  INSERT INTO public.client_agent_send_items (send_id, item_key, totals_only, explanation)
  VALUES (v_send, 'other', false, 'This is the extra document.');
  DELETE FROM public.client_agent_send_items
  WHERE send_id = v_send AND item_key = 'other';

  UPDATE public.client_agent_send_items
    SET updated_at = timestamptz '2000-01-01'
    WHERE send_id = v_send AND item_key = 'irp5'
    RETURNING updated_at INTO v_touched;
  IF v_touched < timestamptz '2020-01-01' THEN
    RAISE EXCEPTION 'touch trigger must refresh updated_at, got %', v_touched;
  END IF;

  UPDATE public.client_agent_sends SET revoked_at = now() WHERE id = v_send;
  IF NOT EXISTS (
    SELECT 1 FROM public.client_agent_sends WHERE id = v_send AND revoked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'revoke must set revoked_at';
  END IF;

  INSERT INTO public.client_agent_send_attempts (send_id, token_hash, ip_hash, outcome)
  VALUES (v_send, v_hash, repeat('ef', 32), 'revoked');

  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.client_agent_sends WHERE id = v_send;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'firm member should read the send, saw %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.client_agent_send_items WHERE send_id = v_send;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'firm member should read the five items, saw %', v_count;
  END IF;
  BEGIN
    INSERT INTO public.client_agent_send_attempts (ip_hash, outcome)
    VALUES (repeat('11', 32), 'unknown');
    RAISE EXCEPTION 'authenticated must not write attempts';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', v_client_owner::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.client_agent_sends WHERE id = v_send;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'client owner who is not a firm member must not read the send';
  END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.client_agent_sends WHERE id = v_send;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'firm owner should read the send, saw %', v_count;
  END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.client_agent_sends WHERE id = v_send;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'another firm must not read the send';
  END IF;
  EXECUTE 'RESET ROLE';

  -- The client now belongs to a different firm from the send. The policy must
  -- compare client_agent_sends.firm_id, not the clients row's own firm_id.
  UPDATE public.clients SET firm_id = v_other_firm WHERE id = v_client;

  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.client_agent_sends WHERE id = v_send;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'a member of a different firm must not read the send, saw %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.client_agent_send_items WHERE send_id = v_send;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'a member of a different firm must not read the items, saw %', v_count;
  END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.client_agent_sends WHERE id = v_send;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'the client''s new firm must not read the old send, saw %', v_count;
  END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', '', true);

  DELETE FROM public.client_agent_send_attempts WHERE send_id = v_send OR ip_hash = repeat('11', 32);
  DELETE FROM public.client_agent_send_items WHERE send_id = v_send;
  DELETE FROM public.client_agent_sends WHERE id = v_send OR token_hash = repeat('cd', 32);
  DELETE FROM public.clients WHERE id = v_client;
  DELETE FROM public.firm_memberships WHERE firm_id IN (v_firm, v_other_firm);
  DELETE FROM public.firms WHERE id IN (v_firm, v_other_firm);
  DELETE FROM auth.users WHERE id IN (v_member, v_owner, v_client_owner, v_other);
END $$;
