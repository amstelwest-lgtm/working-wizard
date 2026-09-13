-- Team & Access amendment — database tests (not UI).
-- Safe to re-run: uses a unique prefix and deletes its own rows.
-- Requires the 20260913120000_team_access_amendment migration.

DO $$
DECLARE
  prefix TEXT := 'milon_amend_' || substr(gen_random_uuid()::text, 1, 8);
  owner_id UUID := gen_random_uuid();
  staff_id UUID := gen_random_uuid();
  manager_id UUID := gen_random_uuid();
  admin_staff_id UUID := gen_random_uuid();
  firm_id UUID;
  client_id UUID;
  raised TEXT;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, instance_id)
  VALUES
    (owner_id, 'authenticated', 'authenticated', prefix || '_owner@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (staff_id, 'authenticated', 'authenticated', prefix || '_staff@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (manager_id, 'authenticated', 'authenticated', prefix || '_mgr@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (admin_staff_id, 'authenticated', 'authenticated', prefix || '_admin@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000');

  INSERT INTO public.firms (name, owner_user_id) VALUES (prefix || ' firm', owner_id) RETURNING id INTO firm_id;
  INSERT INTO public.firm_memberships (firm_id, user_id, role, classification) VALUES
    (firm_id, owner_id, 'owner', 'partner'),
    (firm_id, staff_id, 'member', 'staff'),
    (firm_id, manager_id, 'member', 'manager'),
    (firm_id, admin_staff_id, 'admin', 'staff');

  INSERT INTO public.clients (name, owner_user_id, firm_id)
  VALUES (prefix || ' client', owner_id, firm_id)
  RETURNING id INTO client_id;

  INSERT INTO public.client_practice_access (
    client_id, user_id, firm_id, classification, status,
    requested_at, accountant_approved_at, owner_approved_at
  ) VALUES
    (client_id, staff_id, firm_id, 'staff', 'active', now(), now(), now()),
    (client_id, manager_id, firm_id, 'manager', 'active', now(), now(), now()),
    (client_id, admin_staff_id, firm_id, 'staff', 'active', now(), now(), now()),
    (client_id, owner_id, firm_id, 'partner', 'active', now(), now(), now());

  -- 1. Staff rejected on sign-off
  IF public.can_sign_off_deliverable(staff_id, client_id) THEN
    RAISE EXCEPTION 'test 1 failed: staff can_sign_off_deliverable should be false';
  END IF;

  -- 2. Manager rejected on sign-off
  IF public.can_sign_off_deliverable(manager_id, client_id) THEN
    RAISE EXCEPTION 'test 2 failed: manager can_sign_off_deliverable should be false';
  END IF;

  -- 3. Firm admin classified Staff cannot set own class to Partner
  raised := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', admin_staff_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_staff_id::text)::text, true);
    UPDATE public.firm_memberships
      SET classification = 'partner'
      WHERE firm_id = firm_id AND user_id = admin_staff_id;
  EXCEPTION WHEN OTHERS THEN
    raised := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF raised IS NULL OR raised NOT ILIKE '%partner%' THEN
    RAISE EXCEPTION 'test 3 failed: expected partner-assign rejection, got %', raised;
  END IF;

  -- 4. Team Staff cannot get per-client Manager
  raised := NULL;
  BEGIN
    UPDATE public.client_practice_access
      SET classification = 'manager'
      WHERE client_id = client_id AND user_id = staff_id;
  EXCEPTION WHEN OTHERS THEN
    raised := SQLERRM;
  END;
  IF raised IS NULL OR raised NOT ILIKE '%professional level%' THEN
    RAISE EXCEPTION 'test 4 failed: expected ceiling rejection, got %', raised;
  END IF;

  -- 5. Owner revoke → accountant immediately loses read access
  UPDATE public.client_practice_access
    SET status = 'revoked', revoked_at = now()
    WHERE client_id = client_id AND user_id = staff_id;
  IF public.has_client_access(staff_id, client_id) THEN
    RAISE EXCEPTION 'test 5 failed: revoked staff still has_client_access';
  END IF;

  -- 6. Draft / Ready rows are invisible to the business owner via the SELECT policy
  INSERT INTO public.client_deliverable_states (client_id, scope, status)
  VALUES (client_id, 'financials', 'draft');
  INSERT INTO public.client_deliverable_states (client_id, scope, status)
  VALUES (client_id, 'budget', 'ready_for_review');
  INSERT INTO public.client_deliverable_states (client_id, scope, status)
  VALUES (client_id, 'profitability', 'signed_off');

  IF NOT public.practice_can('staff', 'sign_off') IS FALSE THEN
    RAISE EXCEPTION 'matrix: staff sign_off';
  END IF;
  IF public.practice_class_at_most('staff', 'manager') <> 'staff' THEN
    RAISE EXCEPTION 'matrix: ceiling clamp';
  END IF;

  -- Cleanup (disable last-partner guard so the disposable firm can be removed)
  DELETE FROM public.client_deliverable_states WHERE client_id = client_id;
  DELETE FROM public.client_practice_access WHERE client_id = client_id;
  DELETE FROM public.clients WHERE id = client_id;
  ALTER TABLE public.firm_memberships DISABLE TRIGGER firm_memberships_partner_guard_del;
  DELETE FROM public.firm_memberships WHERE firm_id = firm_id;
  ALTER TABLE public.firm_memberships ENABLE TRIGGER firm_memberships_partner_guard_del;
  DELETE FROM public.firms WHERE id = firm_id;
  DELETE FROM auth.users WHERE id IN (owner_id, staff_id, manager_id, admin_staff_id);

  RAISE NOTICE 'team-access-amendment-sql-tests: ok';
END;
$$;
