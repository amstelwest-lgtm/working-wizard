-- Before/after visibility for the clients RLS initplan wrap.
-- Builds a scratch schema, installs the pre-migration predicates, records the
-- rows each actor can select, update, delete, and insert, installs the wrapped
-- predicates, and requires the same results. Does not alter public.clients.
--
-- Actors:
--   owner       owns Harbour (A), the other owned book (C), and a delete row
--   accountant  active practice assignment on A, membership on D, revoked on C
--   outsider    no ownership, membership, or assignment
-- Control book B is owned by someone else and is visible to none of them.

\set ON_ERROR_STOP on

DO $$
DECLARE
  has_rows boolean;
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.clients LIMIT 1)' INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'refusing to run while public.clients has rows';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $body$
        SELECT COALESCE(
          NULLIF(current_setting('request.jwt.claim.sub', true), ''),
          NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
        )::uuid
      $body$
    $fn$;
    EXECUTE 'GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated';
  END IF;
END $$;

DROP SCHEMA IF EXISTS milon_clients_rls_check CASCADE;
CREATE SCHEMA milon_clients_rls_check;

CREATE TABLE milon_clients_rls_check.clients (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_user_id uuid NOT NULL,
  firm_id uuid,
  firm_link_accepted_at timestamptz,
  firm_link_accepted_by uuid
);

CREATE TABLE milon_clients_rls_check.client_memberships (
  client_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL
);

CREATE TABLE milon_clients_rls_check.practice_assignments (
  client_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL
);

CREATE TABLE milon_clients_rls_check.seen (
  phase text NOT NULL,
  actor text NOT NULL,
  op text NOT NULL,
  detail text NOT NULL,
  PRIMARY KEY (phase, actor, op)
);

-- Same access rule as public.has_client_access: owner, membership, or an
-- active practice assignment. Not granted to anon.
CREATE FUNCTION milon_clients_rls_check.has_client_access(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = milon_clients_rls_check
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM clients c
    WHERE c.id = _client_id
      AND (
        c.owner_user_id = _user_id
        OR EXISTS (
          SELECT 1 FROM client_memberships m
          WHERE m.client_id = c.id AND m.user_id = _user_id
        )
        OR EXISTS (
          SELECT 1 FROM practice_assignments a
          WHERE a.client_id = c.id
            AND a.user_id = _user_id
            AND a.status = 'active'
        )
      )
  );
$$;

-- Owner, or an active assignment (the edit-capable accountant case).
CREATE FUNCTION milon_clients_rls_check.is_client_writer(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = milon_clients_rls_check
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM clients c
    WHERE c.id = _client_id
      AND (
        c.owner_user_id = _user_id
        OR EXISTS (
          SELECT 1 FROM practice_assignments a
          WHERE a.client_id = c.id
            AND a.user_id = _user_id
            AND a.status = 'active'
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION milon_clients_rls_check.has_client_access(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION milon_clients_rls_check.is_client_writer(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION milon_clients_rls_check.has_client_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION milon_clients_rls_check.is_client_writer(uuid, uuid) TO authenticated;

GRANT USAGE ON SCHEMA milon_clients_rls_check TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON milon_clients_rls_check.clients TO authenticated;

CREATE INDEX clients_owner_user_id_idx
  ON milon_clients_rls_check.clients (owner_user_id);

CREATE PROCEDURE milon_clients_rls_check.install_policies(wrapped boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  uid text := CASE WHEN wrapped THEN '(select auth.uid())' ELSE 'auth.uid()' END;
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "clients read by access" ON milon_clients_rls_check.clients';
  EXECUTE 'DROP POLICY IF EXISTS "clients insert own" ON milon_clients_rls_check.clients';
  EXECUTE 'DROP POLICY IF EXISTS "clients update by owner or firm" ON milon_clients_rls_check.clients';
  EXECUTE 'DROP POLICY IF EXISTS "clients update brain summary by access" ON milon_clients_rls_check.clients';
  EXECUTE 'DROP POLICY IF EXISTS "clients delete by owner" ON milon_clients_rls_check.clients';

  EXECUTE format(
    'CREATE POLICY "clients read by access" ON milon_clients_rls_check.clients FOR SELECT TO authenticated USING (milon_clients_rls_check.has_client_access(%s, id))',
    uid
  );
  EXECUTE format(
    'CREATE POLICY "clients insert own" ON milon_clients_rls_check.clients FOR INSERT TO authenticated WITH CHECK (owner_user_id = %s AND firm_id IS NULL AND firm_link_accepted_at IS NULL AND firm_link_accepted_by IS NULL)',
    uid
  );
  EXECUTE format(
    'CREATE POLICY "clients update by owner or firm" ON milon_clients_rls_check.clients FOR UPDATE TO authenticated USING (milon_clients_rls_check.is_client_writer(%s, id)) WITH CHECK (milon_clients_rls_check.is_client_writer(%s, id))',
    uid, uid
  );
  EXECUTE format(
    'CREATE POLICY "clients update brain summary by access" ON milon_clients_rls_check.clients FOR UPDATE TO authenticated USING (milon_clients_rls_check.has_client_access(%s, id)) WITH CHECK (milon_clients_rls_check.has_client_access(%s, id))',
    uid, uid
  );
  EXECUTE format(
    'CREATE POLICY "clients delete by owner" ON milon_clients_rls_check.clients FOR DELETE TO authenticated USING (owner_user_id = %s)',
    uid
  );
END;
$$;

ALTER TABLE milon_clients_rls_check.clients ENABLE ROW LEVEL SECURITY;

INSERT INTO milon_clients_rls_check.clients (id, name, owner_user_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Harbour', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Other Books', '44444444-4444-4444-8444-444444444444'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Second Book', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'Member Book', '44444444-4444-4444-8444-444444444444'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'Delete Book', '11111111-1111-4111-8111-111111111111');

INSERT INTO milon_clients_rls_check.practice_assignments (client_id, user_id, status) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '22222222-2222-4222-8222-222222222222', 'active'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '22222222-2222-4222-8222-222222222222', 'revoked');

INSERT INTO milon_clients_rls_check.client_memberships (client_id, user_id, role) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', '22222222-2222-4222-8222-222222222222', 'client_member');

CREATE PROCEDURE milon_clients_rls_check.record_phase(phase text)
LANGUAGE plpgsql
AS $$
DECLARE
  actor text;
  uid uuid;
  ids uuid[];
  updated uuid[];
  deleted_a int;
  deleted_target uuid;
  insert_result text;
  new_id uuid;
BEGIN
  FOREACH actor IN ARRAY ARRAY['owner', 'accountant', 'outsider']
  LOOP
    uid := CASE actor
      WHEN 'owner' THEN '11111111-1111-4111-8111-111111111111'::uuid
      WHEN 'accountant' THEN '22222222-2222-4222-8222-222222222222'::uuid
      ELSE '33333333-3333-4333-8333-333333333333'::uuid
    END;
    deleted_target := CASE actor
      WHEN 'owner' THEN 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'::uuid
      WHEN 'accountant' THEN 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid
      ELSE 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid
    END;

    PERFORM set_config('request.jwt.claim.sub', uid::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}'::uuid[])
      INTO ids
    FROM milon_clients_rls_check.clients c;

    WITH upd AS (
      UPDATE milon_clients_rls_check.clients
      SET name = name
      RETURNING id
    )
    SELECT coalesce(array_agg(upd.id ORDER BY upd.id), '{}'::uuid[])
      INTO updated
    FROM upd;

    DELETE FROM milon_clients_rls_check.clients WHERE id = deleted_target;
    GET DIAGNOSTICS deleted_a = ROW_COUNT;

    EXECUTE 'RESET ROLE';

    INSERT INTO milon_clients_rls_check.seen (phase, actor, op, detail) VALUES
      (phase, actor, 'select', ids::text),
      (phase, actor, 'update', updated::text),
      (phase, actor, 'delete', deleted_a::text);

    -- The delete above is real. Put the row back before the next actor.
    IF deleted_a > 0 THEN
      INSERT INTO milon_clients_rls_check.clients (id, name, owner_user_id)
      VALUES (deleted_target, 'Delete Book', '11111111-1111-4111-8111-111111111111');
    END IF;

    FOREACH insert_result IN ARRAY ARRAY['own', 'foreign', 'firm']
    LOOP
      new_id := gen_random_uuid();
      BEGIN
        PERFORM set_config('request.jwt.claim.sub', uid::text, true);
        PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
        EXECUTE 'SET LOCAL ROLE authenticated';
        IF insert_result = 'own' THEN
          INSERT INTO milon_clients_rls_check.clients (id, name, owner_user_id)
          VALUES (new_id, 'New', uid);
        ELSIF insert_result = 'foreign' THEN
          INSERT INTO milon_clients_rls_check.clients (id, name, owner_user_id)
          VALUES (new_id, 'New', '44444444-4444-4444-8444-444444444444');
        ELSE
          INSERT INTO milon_clients_rls_check.clients (id, name, owner_user_id, firm_id)
          VALUES (new_id, 'New', uid, '55555555-5555-4555-8555-555555555555');
        END IF;
        EXECUTE 'RESET ROLE';
        INSERT INTO milon_clients_rls_check.seen (phase, actor, op, detail)
        VALUES (phase, actor, 'insert_' || insert_result, 'allow');
        DELETE FROM milon_clients_rls_check.clients WHERE id = new_id;
      EXCEPTION
        WHEN insufficient_privilege THEN
          EXECUTE 'RESET ROLE';
          INSERT INTO milon_clients_rls_check.seen (phase, actor, op, detail)
          VALUES (phase, actor, 'insert_' || insert_result, 'deny');
      END;
    END LOOP;
  END LOOP;
END;
$$;

CALL milon_clients_rls_check.install_policies(false);
CALL milon_clients_rls_check.record_phase('before');
CALL milon_clients_rls_check.install_policies(true);
CALL milon_clients_rls_check.record_phase('after');

DO $$
DECLARE
  mismatch text;
  bare text;
  expr text;
  rec record;
BEGIN
  IF has_function_privilege('anon', 'milon_clients_rls_check.has_client_access(uuid,uuid)', 'execute') THEN
    RAISE EXCEPTION 'anon can execute the scratch access helper';
  END IF;
  IF has_function_privilege('anon', 'milon_clients_rls_check.is_client_writer(uuid,uuid)', 'execute') THEN
    RAISE EXCEPTION 'anon can execute the scratch writer helper';
  END IF;
  IF has_table_privilege('anon', 'milon_clients_rls_check.clients', 'select') THEN
    RAISE EXCEPTION 'anon can read the scratch clients table';
  END IF;

  SELECT string_agg(format('%s %s before=%s after=%s', b.actor, b.op, b.detail, a.detail), E'\n')
    INTO mismatch
  FROM milon_clients_rls_check.seen b
  JOIN milon_clients_rls_check.seen a
    ON a.actor = b.actor AND a.op = b.op AND a.phase = 'after'
  WHERE b.phase = 'before'
    AND a.detail IS DISTINCT FROM b.detail;
  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'visible rows changed:%', E'\n' || mismatch;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM milon_clients_rls_check.seen
    WHERE phase = 'before' AND actor = 'owner' AND op = 'select'
      AND detail = '{aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1,aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3,aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5}'
  ) THEN
    RAISE EXCEPTION 'owner did not see the owned books';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM milon_clients_rls_check.seen
    WHERE phase = 'before' AND actor = 'accountant' AND op = 'select'
      AND detail = '{aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1,aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4}'
  ) THEN
    RAISE EXCEPTION 'accountant member did not see the assigned book and the membership book';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM milon_clients_rls_check.seen
    WHERE phase = 'before' AND actor = 'outsider' AND op = 'select' AND detail = '{}'
  ) THEN
    RAISE EXCEPTION 'outsider saw a client';
  END IF;
  IF EXISTS (
    SELECT 1 FROM milon_clients_rls_check.seen
    WHERE phase = 'before' AND op = 'insert_own' AND detail <> 'allow'
  ) THEN
    RAISE EXCEPTION 'an actor was blocked from inserting their own client';
  END IF;
  IF EXISTS (
    SELECT 1 FROM milon_clients_rls_check.seen
    WHERE phase = 'before'
      AND op IN ('insert_foreign', 'insert_firm')
      AND detail <> 'deny'
  ) THEN
    RAISE EXCEPTION 'a forbidden insert was allowed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM milon_clients_rls_check.seen
    WHERE phase = 'before' AND op = 'delete'
      AND (
        (actor = 'owner' AND detail <> '1')
        OR (actor <> 'owner' AND detail <> '0')
      )
  ) THEN
    RAISE EXCEPTION 'delete was not limited to the owner row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM milon_clients_rls_check.seen
    WHERE detail LIKE '%aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2%'
  ) THEN
    RAISE EXCEPTION 'the unrelated book was visible';
  END IF;

  FOR rec IN
    SELECT policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'milon_clients_rls_check' AND tablename = 'clients'
  LOOP
    FOREACH expr IN ARRAY ARRAY[rec.qual, rec.with_check]
    LOOP
      IF expr IS NULL THEN
        CONTINUE;
      END IF;
      bare := regexp_replace(expr, '\(\s*SELECT\s+auth\.uid\(\)\s*(AS\s+\w+)?\s*\)', '', 'gi');
      IF bare ~* 'auth\.uid\(\)' THEN
        RAISE EXCEPTION 'policy % still calls auth.uid() directly: %', rec.policyname, expr;
      END IF;
      IF expr ~* 'auth\.uid\(\)' AND bare = expr THEN
        RAISE EXCEPTION 'policy % is missing the select wrap: %', rec.policyname, expr;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'milon_clients_rls_check'
      AND tablename = 'clients'
      AND indexname = 'clients_owner_user_id_idx'
  ) THEN
    RAISE EXCEPTION 'clients(owner_user_id) index was not created';
  END IF;
END $$;

SELECT phase, actor, op, detail
FROM milon_clients_rls_check.seen
ORDER BY op, actor, phase;

DROP SCHEMA milon_clients_rls_check CASCADE;
