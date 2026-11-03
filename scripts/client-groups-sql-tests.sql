-- Backfill, can_access_company, Individual privacy, and move revoke.
-- Runs after 20261103150000_client_groups.sql. Fails the script on mismatch.

DO $$
DECLARE
  solo_books uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  solo_cafe uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  n int;
  shared int;
  g1 uuid;
  g2 uuid;
BEGIN
  SELECT count(*) INTO n
  FROM public.clients
  WHERE id IN (solo_books, solo_cafe)
    AND group_id IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'backfill left % seeded clients without a group', n;
  END IF;

  SELECT count(*) INTO shared
  FROM (
    SELECT group_id
    FROM public.clients
    WHERE id IN (solo_books, solo_cafe)
    GROUP BY group_id
    HAVING count(*) > 1
  ) dupes;
  IF shared <> 0 THEN
    RAISE EXCEPTION 'backfill put existing clients in the same group';
  END IF;

  SELECT count(*) INTO n FROM public.clients WHERE group_id IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'backfill left % clients without a group', n;
  END IF;
END $$;

DO $$
DECLARE
  accountant uuid := '22222222-2222-4222-8222-222222222222';
  owner_one uuid := '11111111-1111-4111-8111-111111111111';
  owner_two uuid := '44444444-4444-4444-8444-444444444444';
  stranger uuid := '55555555-5555-4555-8555-555555555555';
  firm uuid := '33333333-3333-4333-8333-333333333333';
  grp uuid;
  company_id uuid;
  individual_id uuid;
BEGIN
  INSERT INTO public.client_groups (firm_id, name)
  VALUES (firm, 'Harbour group')
  RETURNING id INTO grp;

  INSERT INTO public.client_group_members (group_id, user_id, role) VALUES
    (grp, owner_one, 'owner'),
    (grp, owner_two, 'owner');

  INSERT INTO public.clients (
    name, owner_user_id, firm_id, group_id, entity_type, placeholder
  ) VALUES (
    'Harbour Trading', accountant, firm, grp, 'company', false
  )
  RETURNING id INTO company_id;

  INSERT INTO public.clients (
    name, owner_user_id, firm_id, group_id, entity_type, person_user_id, placeholder
  ) VALUES (
    'Harbour owner', accountant, firm, grp, 'individual', owner_one, false
  )
  RETURNING id INTO individual_id;

  IF NOT public.can_access_company(owner_one, company_id) THEN
    RAISE EXCEPTION 'group owner should see the company';
  END IF;
  IF NOT public.can_access_company(owner_one, individual_id) THEN
    RAISE EXCEPTION 'the Individual person should see their entity';
  END IF;
  IF public.can_access_company(owner_two, individual_id) THEN
    RAISE EXCEPTION 'another group owner must not see the Individual';
  END IF;
  IF NOT public.can_access_company(owner_two, company_id) THEN
    RAISE EXCEPTION 'another group owner should see the company';
  END IF;
  IF NOT public.can_access_company(accountant, individual_id) THEN
    RAISE EXCEPTION 'the firm file owner should see the Individual';
  END IF;
  IF public.can_access_company(stranger, company_id)
     OR public.can_access_company(stranger, individual_id) THEN
    RAISE EXCEPTION 'a stranger should not see the group';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', owner_one::text, true);
  IF NOT public.can_access_company(individual_id) THEN
    RAISE EXCEPTION 'can_access_company(company_id) should follow auth.uid()';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

DO $$
DECLARE
  accountant uuid := '22222222-2222-4222-8222-222222222222';
  owner_one uuid := '11111111-1111-4111-8111-111111111111';
  owner_two uuid := '44444444-4444-4444-8444-444444444444';
  firm uuid := '33333333-3333-4333-8333-333333333333';
  from_group uuid;
  to_group uuid;
  company_id uuid;
  billable int;
  revoked int;
  granted int;
BEGIN
  INSERT INTO public.client_groups (firm_id, name) VALUES
    (firm, 'From group')
  RETURNING id INTO from_group;
  INSERT INTO public.client_groups (firm_id, name) VALUES
    (firm, 'To group')
  RETURNING id INTO to_group;

  INSERT INTO public.client_group_members (group_id, user_id, role) VALUES
    (from_group, owner_one, 'owner'),
    (to_group, owner_two, 'owner');

  INSERT INTO public.clients (
    name, owner_user_id, firm_id, group_id, entity_type, placeholder
  ) VALUES (
    'Movable CC', accountant, firm, from_group, 'cc', false
  )
  RETURNING id INTO company_id;

  INSERT INTO public.client_memberships (client_id, user_id, role)
  VALUES (company_id, owner_one, 'client_owner');
  INSERT INTO public.client_group_grants (group_id, client_id, user_id)
  VALUES (from_group, company_id, owner_one);

  -- Three real companies already conceptually: this one counts, plus extras below.
  INSERT INTO public.clients (name, owner_user_id, firm_id, group_id, entity_type, placeholder)
  VALUES
    ('Counted 2', accountant, firm, to_group, 'company', false),
    ('Counted 3', accountant, firm, to_group, 'trust', false),
    ('Counted 4', accountant, firm, to_group, 'partnership', false),
    ('Owner ITR12', accountant, firm, to_group, 'individual', false),
    ('Shell', accountant, firm, to_group, 'company', true);

  UPDATE public.clients
  SET person_user_id = owner_two
  WHERE name = 'Owner ITR12' AND group_id = to_group;

  SELECT public.group_billable_company_count(to_group) INTO billable;
  IF billable <> 3 THEN
    RAISE EXCEPTION 'expected 3 billable companies before the move, got %', billable;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', accountant::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  BEGIN
    PERFORM public.move_company_to_group(company_id, to_group, false);
    RAISE EXCEPTION 'move without confirm should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Confirm who gains access%' THEN
        RAISE;
      END IF;
  END;

  IF (SELECT group_id FROM public.clients WHERE id = company_id) IS DISTINCT FROM from_group THEN
    RAISE EXCEPTION 'unconfirmed move changed the group';
  END IF;

  PERFORM public.move_company_to_group(company_id, to_group, true);

  IF (SELECT group_id FROM public.clients WHERE id = company_id) IS DISTINCT FROM to_group THEN
    RAISE EXCEPTION 'confirmed move did not change group_id';
  END IF;
  IF (
    SELECT count(*) FROM public.clients WHERE id = company_id
  ) <> 1 THEN
    RAISE EXCEPTION 'company row was duplicated';
  END IF;

  IF public.can_access_company(owner_one, company_id) THEN
    RAISE EXCEPTION 'previous group owner still has access after the move';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.client_memberships
    WHERE client_id = company_id AND user_id = owner_one
  ) THEN
    RAISE EXCEPTION 'previous group owner membership was not revoked';
  END IF;
  IF NOT public.can_access_company(owner_two, company_id) THEN
    RAISE EXCEPTION 'destination group owner did not gain access';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.client_memberships
    WHERE client_id = company_id AND user_id = owner_two AND role = 'client_owner'
  ) THEN
    RAISE EXCEPTION 'destination group owner was not granted a membership';
  END IF;

  SELECT count(*) INTO revoked
  FROM public.client_group_audit
  WHERE client_id = company_id AND action = 'access_revoked';
  SELECT count(*) INTO granted
  FROM public.client_group_audit
  WHERE client_id = company_id AND action = 'access_granted';
  IF revoked < 1 OR granted < 1 THEN
    RAISE EXCEPTION 'move did not audit revoke (%) and grant (%)', revoked, granted;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.client_group_audit
    WHERE client_id = company_id AND action = 'company_moved'
  ) THEN
    RAISE EXCEPTION 'move was not audited';
  END IF;

  SELECT public.group_billable_company_count(to_group) INTO billable;
  IF billable <> 4 THEN
    RAISE EXCEPTION 'expected 4 billable companies after the move, got %', billable;
  END IF;

  UPDATE public.clients
  SET data_uploaded_at = now()
  WHERE name = 'Shell' AND group_id = to_group;
  SELECT public.group_billable_company_count(to_group) INTO billable;
  IF billable <> 5 THEN
    RAISE EXCEPTION 'uploaded placeholder should count, got %', billable;
  END IF;
END $$;
