-- link_client_firm must not let a firm member claim another owner's client.
-- Safe to re-run: unique prefix, deletes its own rows.
-- Requires 20261013160000_link_client_firm_execute_lock.sql (and 20261013150000).
--
-- Tests:
--   cross_tenant_member_refused
--   owner_self_link_refused
--   invite_redeem_links
--   marketplace_accept_links
--   link_own_client_to_firm_owner_member
--   create_firm_client_does_not_claim_existing

DO $$
DECLARE
  prefix TEXT := 'milon_link_guard_' || substr(gen_random_uuid()::text, 1, 8);
  v_firm_owner UUID := gen_random_uuid();
  v_business_owner UUID := gen_random_uuid();
  v_firm UUID;
  v_victim UUID;
  v_invite UUID;
  v_orphan UUID;
  v_untouched UUID;
  v_request UUID;
  v_created UUID;
  v_firm_id UUID;
  raised TEXT;
  v_sqlstate TEXT;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, instance_id)
  VALUES
    (v_firm_owner, 'authenticated', 'authenticated', prefix || '_firm@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (v_business_owner, 'authenticated', 'authenticated', prefix || '_biz@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000');

  INSERT INTO public.profiles (id, email, full_name)
  VALUES
    (v_firm_owner, prefix || '_firm@example.test', prefix || ' Firm'),
    (v_business_owner, prefix || '_biz@example.test', prefix || ' Business')
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

  INSERT INTO public.firms (name, owner_user_id)
  VALUES (prefix || ' firm', v_firm_owner)
  RETURNING id INTO v_firm;

  INSERT INTO public.firm_memberships (firm_id, user_id, role, classification)
  VALUES (v_firm, v_firm_owner, 'owner', 'staff');

  INSERT INTO public.clients (name, owner_user_id)
  VALUES (prefix || ' victim', v_business_owner)
  RETURNING id INTO v_victim;
  INSERT INTO public.clients (name, owner_user_id)
  VALUES (prefix || ' invite', v_business_owner)
  RETURNING id INTO v_invite;
  INSERT INTO public.clients (name, owner_user_id)
  VALUES (prefix || ' orphan', v_firm_owner)
  RETURNING id INTO v_orphan;
  INSERT INTO public.clients (name, owner_user_id)
  VALUES (prefix || ' untouched', v_business_owner)
  RETURNING id INTO v_untouched;

  IF public.has_client_access(v_firm_owner, v_victim) THEN
    RAISE EXCEPTION 'cross_tenant_member_refused: firm owner already had access';
  END IF;

  IF has_function_privilege('authenticated', 'public.link_client_firm(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'cross_tenant_member_refused: authenticated can still execute link_client_firm';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.link_client_firm(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'invite_redeem_links: service_role cannot execute link_client_firm';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.accountant_request_respond(uuid,boolean,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'marketplace_accept_links: authenticated cannot execute accountant_request_respond';
  END IF;

  -- Body: a firm member with a JWT still cannot attach someone else's client.
  PERFORM set_config('request.jwt.claim.sub', v_firm_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_firm_owner::text, 'role', 'authenticated')::text,
    true
  );
  raised := NULL;
  BEGIN
    PERFORM public.link_client_firm(v_victim, v_firm, v_firm_owner);
  EXCEPTION WHEN OTHERS THEN
    raised := SQLERRM;
  END;
  IF raised IS NULL OR raised NOT ILIKE '%accepted firm request%' THEN
    RAISE EXCEPTION 'cross_tenant_member_refused: body allowed the link (%).', raised;
  END IF;

  -- Grant: the signed-in role cannot call the function at all.
  raised := NULL;
  v_sqlstate := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.link_client_firm(v_victim, v_firm, v_firm_owner);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS raised = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS raised = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'cross_tenant_member_refused: expected permission denied, got % %', v_sqlstate, raised;
  END IF;
  IF public.has_client_access(v_firm_owner, v_victim) THEN
    RAISE EXCEPTION 'cross_tenant_member_refused: has_client_access flipped to true';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_victim AND c.firm_id IS NOT NULL) THEN
    RAISE EXCEPTION 'cross_tenant_member_refused: victim firm_id was set';
  END IF;
  RAISE NOTICE 'cross_tenant_member_refused ok';

  -- Owner cannot attach their own client to a firm through link_client_firm.
  PERFORM set_config('request.jwt.claim.sub', v_business_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_business_owner::text, 'role', 'authenticated')::text,
    true
  );
  raised := NULL;
  BEGIN
    PERFORM public.link_client_firm(v_victim, v_firm, v_business_owner);
  EXCEPTION WHEN OTHERS THEN
    raised := SQLERRM;
  END;
  IF raised IS NULL OR raised NOT ILIKE '%Only a member of the firm%' THEN
    RAISE EXCEPTION 'owner_self_link_refused: body allowed the owner (%).', raised;
  END IF;
  raised := NULL;
  v_sqlstate := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.link_client_firm(v_victim, v_firm, v_business_owner);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS raised = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS raised = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'owner_self_link_refused: expected permission denied, got % %', v_sqlstate, raised;
  END IF;
  IF EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_victim AND c.firm_id IS NOT NULL) THEN
    RAISE EXCEPTION 'owner_self_link_refused: owner self-link set firm_id';
  END IF;
  -- A member who owns the client still cannot call link_client_firm.
  -- The dashboard path is link_own_client_to_firm.
  PERFORM set_config('request.jwt.claim.sub', v_firm_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_firm_owner::text, 'role', 'authenticated')::text,
    true
  );
  raised := NULL;
  v_sqlstate := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.link_client_firm(v_orphan, v_firm, v_firm_owner);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS raised = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS raised = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'owner_self_link_refused: member-owner execute expected permission denied, got % %', v_sqlstate, raised;
  END IF;
  IF EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_orphan AND c.firm_id IS NOT NULL) THEN
    RAISE EXCEPTION 'owner_self_link_refused: member-owner link_client_firm set firm_id';
  END IF;
  RAISE NOTICE 'owner_self_link_refused ok';

  -- Invite redeem: service role, no JWT user, accepted_by is a firm member.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.link_client_firm(v_invite, v_firm, v_firm_owner);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'invite_redeem_links: %', SQLERRM;
  END;
  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = v_invite
      AND c.firm_id = v_firm
      AND c.firm_link_accepted_at IS NOT NULL
      AND c.firm_link_accepted_by = v_firm_owner
  ) THEN
    RAISE EXCEPTION 'invite_redeem_links: invite client was not accepted';
  END IF;
  RAISE NOTICE 'invite_redeem_links ok';

  -- Marketplace accept still links, and that is what grants access.
  INSERT INTO public.accountant_requests (client_id, firm_id, status, created_by)
  VALUES (v_victim, v_firm, 'open', v_business_owner)
  RETURNING id INTO v_request;

  PERFORM set_config('request.jwt.claim.sub', v_firm_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_firm_owner::text, 'role', 'authenticated')::text,
    true
  );
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF public.accountant_request_respond(v_request, true, NULL) IS DISTINCT FROM 'accepted' THEN
      RAISE EXCEPTION 'marketplace_accept_links: respond did not accept';
    END IF;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'marketplace_accept_links: %', SQLERRM;
  END;
  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = v_victim
      AND c.firm_id = v_firm
      AND c.firm_link_accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'marketplace_accept_links: victim was not linked';
  END IF;
  IF NOT public.has_client_access(v_firm_owner, v_victim) THEN
    RAISE EXCEPTION 'marketplace_accept_links: accepted request did not grant access';
  END IF;
  RAISE NOTICE 'marketplace_accept_links ok';

  -- Genuine owner who is also a firm member uses the narrow RPC.
  IF NOT has_function_privilege('authenticated', 'public.link_own_client_to_firm(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'link_own_client_to_firm_owner_member: authenticated cannot execute it';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_firm_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_firm_owner::text, 'role', 'authenticated')::text,
    true
  );
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.link_own_client_to_firm(v_orphan, v_firm);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'link_own_client_to_firm_owner_member: %', SQLERRM;
  END;
  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = v_orphan
      AND c.firm_id = v_firm
      AND c.owner_user_id = v_firm_owner
      AND c.firm_link_accepted_at IS NOT NULL
      AND c.firm_link_accepted_by = v_firm_owner
  ) THEN
    RAISE EXCEPTION 'link_own_client_to_firm_owner_member: orphan was not linked';
  END IF;
  RAISE NOTICE 'link_own_client_to_firm_owner_member ok';

  -- create_firm_client inserts a new row. It does not adopt an existing client.
  PERFORM set_config('request.jwt.claim.sub', v_firm_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_firm_owner::text, 'role', 'authenticated')::text,
    true
  );
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_created := (public.create_firm_client(prefix || ' created', v_firm, NULL, NULL)->>'id')::uuid;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'create_firm_client_does_not_claim_existing: %', SQLERRM;
  END;
  SELECT c.firm_id INTO v_firm_id FROM public.clients c WHERE c.id = v_untouched;
  IF v_firm_id IS NOT NULL THEN
    RAISE EXCEPTION 'create_firm_client_does_not_claim_existing: untouched client was claimed';
  END IF;
  IF public.has_client_access(v_firm_owner, v_untouched) THEN
    RAISE EXCEPTION 'create_firm_client_does_not_claim_existing: firm owner gained access to an untouched client';
  END IF;
  IF v_created IS NULL OR v_created IN (v_victim, v_invite, v_orphan, v_untouched) THEN
    RAISE EXCEPTION 'create_firm_client_does_not_claim_existing: did not insert a new client';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = v_created AND c.owner_user_id = v_firm_owner AND c.firm_id = v_firm
  ) THEN
    RAISE EXCEPTION 'create_firm_client_does_not_claim_existing: new client is not owned by the caller';
  END IF;
  RAISE NOTICE 'create_firm_client_does_not_claim_existing ok';

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.accountant_requests WHERE firm_id = v_firm;
  DELETE FROM public.client_employees WHERE client_id IN (v_victim, v_invite, v_orphan, v_untouched, v_created);
  DELETE FROM public.client_practice_access WHERE client_id IN (v_victim, v_invite, v_orphan, v_untouched, v_created);
  DELETE FROM public.clients WHERE id IN (v_victim, v_invite, v_orphan, v_untouched, v_created);
  ALTER TABLE public.firm_memberships DISABLE TRIGGER firm_memberships_partner_guard_del;
  DELETE FROM public.firm_memberships WHERE firm_id = v_firm;
  ALTER TABLE public.firm_memberships ENABLE TRIGGER firm_memberships_partner_guard_del;
  DELETE FROM public.firms WHERE id = v_firm;
  DELETE FROM public.profiles WHERE id IN (v_firm_owner, v_business_owner);
  DELETE FROM auth.users WHERE id IN (v_firm_owner, v_business_owner);

  RAISE NOTICE 'link-client-firm-guard-sql-tests: ok';
END;
$$;
