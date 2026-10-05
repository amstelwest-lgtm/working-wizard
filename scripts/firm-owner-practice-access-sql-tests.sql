-- Firm-owner practice access — database tests (not UI).
-- Safe to re-run: uses a unique prefix and deletes its own rows.
-- Requires 20261005183000_firm_owner_practice_access.sql.

DO $$
DECLARE
  prefix TEXT := 'milon_owner_access_' || substr(gen_random_uuid()::text, 1, 8);
  v_owner UUID := gen_random_uuid();
  v_staff UUID := gen_random_uuid();
  v_partner UUID := gen_random_uuid();
  v_outsider UUID := gen_random_uuid();
  v_firm UUID;
  v_client UUID;
  v_client_later UUID;
  v_rows INT;
  v_class TEXT;
  v_status TEXT;
  v_requested UUID;
  raised TEXT;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, instance_id)
  VALUES
    (v_owner, 'authenticated', 'authenticated', prefix || '_owner@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (v_staff, 'authenticated', 'authenticated', prefix || '_staff@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (v_partner, 'authenticated', 'authenticated', prefix || '_partner@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (v_outsider, 'authenticated', 'authenticated', prefix || '_out@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000');

  INSERT INTO public.profiles (id, email, full_name)
  VALUES
    (v_owner, prefix || '_owner@example.test', prefix || ' Owner'),
    (v_staff, prefix || '_staff@example.test', prefix || ' Staff'),
    (v_partner, prefix || '_partner@example.test', prefix || ' Partner')
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

  INSERT INTO public.firms (name, owner_user_id)
  VALUES (prefix || ' firm', v_owner)
  RETURNING id INTO v_firm;

  -- Prod shape: the firm owner is role owner with classification staff.
  -- team_practice_classification still treats that owner as partner.
  INSERT INTO public.firm_memberships (firm_id, user_id, role, classification) VALUES
    (v_firm, v_owner, 'owner', 'staff'),
    (v_firm, v_staff, 'member', 'staff');

  INSERT INTO public.clients (name, owner_user_id, firm_id)
  VALUES (prefix || ' client', v_owner, v_firm)
  RETURNING id INTO v_client;

  SELECT count(*), max(a.classification), max(a.status), max(a.requested_by)
    INTO v_rows, v_class, v_status, v_requested
  FROM public.client_practice_access a
  WHERE a.client_id = v_client AND a.user_id = v_owner;

  IF v_rows <> 1 OR v_status <> 'active' OR v_class <> 'partner' THEN
    RAISE EXCEPTION 'owner grant failed: rows=% status=% class=%', v_rows, v_status, v_class;
  END IF;
  IF v_requested IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'requested_by should be the firm owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.client_practice_access a
    WHERE a.client_id = v_client AND a.user_id = v_staff
  ) THEN
    RAISE EXCEPTION 'staff must not receive automatic access';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.client_practice_access a
    WHERE a.client_id = v_client AND a.user_id = v_outsider
  ) THEN
    RAISE EXCEPTION 'non-firm user must not receive access';
  END IF;
  IF NOT public.has_active_practice_assignment(v_owner, v_client) THEN
    RAISE EXCEPTION 'owner should have an active assignment';
  END IF;
  IF public.has_active_practice_assignment(v_staff, v_client) THEN
    RAISE EXCEPTION 'staff should not have an active assignment';
  END IF;
  IF NOT public.practice_can(public.effective_practice_classification(v_owner, v_client), 'sign_off') THEN
    RAISE EXCEPTION 'owner effective class must be able to sign off';
  END IF;
  IF NOT public.practice_can(public.effective_practice_classification(v_owner, v_client), 'submit') THEN
    RAISE EXCEPTION 'owner effective class must be able to submit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.client_employees e
    WHERE e.client_id = v_client AND e.user_id = v_owner AND e.email = prefix || '_owner@example.test'
  ) THEN
    RAISE EXCEPTION 'owner should appear as an action-plan assignee';
  END IF;

  -- Idempotent: a second grant does not duplicate.
  PERFORM public.grant_practice_principal_access(v_client, v_firm);
  SELECT count(*) INTO v_rows
  FROM public.client_practice_access a
  WHERE a.client_id = v_client AND a.user_id = v_owner;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'second grant duplicated the owner row (%).', v_rows;
  END IF;

  -- Revoke sticks.
  UPDATE public.client_practice_access
    SET status = 'revoked', revoked_at = now()
    WHERE client_id = v_client AND user_id = v_owner;
  PERFORM public.grant_practice_principal_access(v_client, v_firm);
  IF public.has_active_practice_assignment(v_owner, v_client) THEN
    RAISE EXCEPTION 'revoked owner must not be treated as assigned';
  END IF;
  SELECT count(*) INTO v_rows
  FROM public.client_practice_access a
  WHERE a.client_id = v_client AND a.user_id = v_owner AND a.status = 'revoked';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'revoke must leave exactly one revoked row';
  END IF;

  -- A client connected later still grants the owner, and a new partner is
  -- granted on every existing client of the firm.
  UPDATE public.client_practice_access
    SET status = 'active', revoked_at = NULL
    WHERE client_id = v_client AND user_id = v_owner;

  INSERT INTO public.clients (name, owner_user_id)
  VALUES (prefix || ' later', v_owner)
  RETURNING id INTO v_client_later;

  UPDATE public.clients SET firm_id = v_firm WHERE id = v_client_later;

  IF NOT public.has_active_practice_assignment(v_owner, v_client_later) THEN
    RAISE EXCEPTION 'setting firm_id should grant the owner';
  END IF;

  INSERT INTO public.firm_memberships (firm_id, user_id, role, classification)
  VALUES (v_firm, v_partner, 'member', 'partner');

  IF NOT public.has_active_practice_assignment(v_partner, v_client) THEN
    RAISE EXCEPTION 'new partner should be granted on existing clients';
  END IF;
  IF NOT public.has_active_practice_assignment(v_partner, v_client_later) THEN
    RAISE EXCEPTION 'new partner should be granted on the later client';
  END IF;
  SELECT a.classification INTO v_class
  FROM public.client_practice_access a
  WHERE a.client_id = v_client AND a.user_id = v_partner;
  IF v_class <> 'partner' THEN
    RAISE EXCEPTION 'partner access class should be partner, got %', v_class;
  END IF;

  -- Deliverable submit: owner passes, unassigned staff does not.
  INSERT INTO public.client_deliverable_states (client_id, scope, status)
  VALUES (v_client_later, 'financials', 'draft');

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text)::text, true);
  UPDATE public.client_deliverable_states
    SET status = 'ready_for_review'
    WHERE client_id = v_client_later AND scope = 'financials';

  PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff::text)::text, true);
  raised := NULL;
  BEGIN
    UPDATE public.client_deliverable_states
      SET status = 'draft'
      WHERE client_id = v_client_later AND scope = 'financials';
  EXCEPTION WHEN OTHERS THEN
    raised := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF raised IS NULL OR raised NOT ILIKE '%No practice assignment%' THEN
    RAISE EXCEPTION 'staff submit should be blocked, got %', raised;
  END IF;

  DELETE FROM public.client_deliverable_states
    WHERE client_id IN (v_client, v_client_later);
  DELETE FROM public.client_employees
    WHERE client_id IN (v_client, v_client_later);
  DELETE FROM public.client_practice_access
    WHERE client_id IN (v_client, v_client_later);
  DELETE FROM public.clients WHERE id IN (v_client, v_client_later);
  ALTER TABLE public.firm_memberships DISABLE TRIGGER firm_memberships_partner_guard_del;
  DELETE FROM public.firm_memberships WHERE firm_id = v_firm;
  ALTER TABLE public.firm_memberships ENABLE TRIGGER firm_memberships_partner_guard_del;
  DELETE FROM public.firms WHERE id = v_firm;
  DELETE FROM public.profiles WHERE id IN (v_owner, v_staff, v_partner, v_outsider);
  DELETE FROM auth.users WHERE id IN (v_owner, v_staff, v_partner, v_outsider);

  RAISE NOTICE 'firm-owner-practice-access-sql-tests: ok';
END;
$$;
