-- Proves anon and authenticated cannot read client-agent-sends.
-- The grants below match a hosted project and live only in this test.
-- They are not in the migration. With row level security on and no policy
-- for this bucket, a grant is not enough to read an object.
-- Does not run against a hosted database.

\set ON_ERROR_STOP on

SET client_min_messages TO warning;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.objects TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.objects TO service_role;
ALTER ROLE service_role BYPASSRLS;

DO $$
DECLARE
  v_name text := '88888888-8888-4888-8888-888888888888/irp5/99999999-9999-4999-8999-999999999999';
  v_count int;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'client-agent-sends'
      AND name = 'client-agent-sends'
      AND public = false
      AND file_size_limit = 20971520
      AND allowed_mime_types @> ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic']::text[]
      AND allowed_mime_types <@ ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic']::text[]
  ) THEN
    RAISE EXCEPTION 'bucket must be private';
  END IF;

  IF NOT (
    SELECT c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'storage' AND c.relname = 'objects'
  ) THEN
    RAISE EXCEPTION 'storage.objects must have row level security';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy p
    WHERE p.polrelid = 'storage.objects'::regclass
      AND (
        p.polname ILIKE '%client-agent-sends%'
        OR p.polname ILIKE '%client_agent_send%'
        OR coalesce(pg_get_expr(p.polqual, p.polrelid), '') ILIKE '%client-agent-sends%'
        OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ILIKE '%client-agent-sends%'
      )
  ) THEN
    RAISE EXCEPTION 'storage.objects must have no policy for client-agent-sends';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'protect_delete'
      AND tgrelid = 'storage.objects'::regclass
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE storage.objects DISABLE TRIGGER protect_delete';
  END IF;

  DELETE FROM storage.objects
  WHERE bucket_id = 'client-agent-sends' AND name = v_name;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'protect_delete'
      AND tgrelid = 'storage.objects'::regclass
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE storage.objects ENABLE TRIGGER protect_delete';
  END IF;

  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('client-agent-sends', v_name);

  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_count
  FROM storage.objects
  WHERE bucket_id = 'client-agent-sends';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'anon must not read client-agent-sends, saw %', v_count;
  END IF;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('client-agent-sends', 'anon-must-not-insert');
    RAISE EXCEPTION 'anon must not insert into client-agent-sends';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE storage.objects SET name = 'anon-must-not-update'
  WHERE bucket_id = 'client-agent-sends' AND name = v_name;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'anon must not update client-agent-sends, saw %', v_count;
  END IF;
  DELETE FROM storage.objects
  WHERE bucket_id = 'client-agent-sends' AND name = v_name;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'anon must not delete client-agent-sends, saw %', v_count;
  END IF;
  EXECUTE 'RESET ROLE';

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count
  FROM storage.objects
  WHERE bucket_id = 'client-agent-sends';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'authenticated must not read client-agent-sends, saw %', v_count;
  END IF;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('client-agent-sends', 'authenticated-must-not-insert');
    RAISE EXCEPTION 'authenticated must not insert into client-agent-sends';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE storage.objects SET name = 'authenticated-must-not-update'
  WHERE bucket_id = 'client-agent-sends' AND name = v_name;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'authenticated must not update client-agent-sends, saw %', v_count;
  END IF;
  DELETE FROM storage.objects
  WHERE bucket_id = 'client-agent-sends' AND name = v_name;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'authenticated must not delete client-agent-sends, saw %', v_count;
  END IF;
  EXECUTE 'RESET ROLE';

  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT count(*) INTO v_count
  FROM storage.objects
  WHERE bucket_id = 'client-agent-sends' AND name = v_name;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'service role must read the object, saw %', v_count;
  END IF;
  EXECUTE 'RESET ROLE';

  DROP POLICY IF EXISTS "storage proof other bucket" ON storage.objects;
  CREATE POLICY "storage proof other bucket"
    ON storage.objects FOR SELECT TO anon, authenticated
    USING (bucket_id = 'firm-logos');

  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_count
  FROM storage.objects
  WHERE bucket_id = 'client-agent-sends';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'anon must not read client-agent-sends, saw %', v_count;
  END IF;
  EXECUTE 'RESET ROLE';

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count
  FROM storage.objects
  WHERE bucket_id = 'client-agent-sends';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'authenticated must not read client-agent-sends, saw %', v_count;
  END IF;
  EXECUTE 'RESET ROLE';

  DROP POLICY IF EXISTS "storage proof other bucket" ON storage.objects;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'protect_delete'
      AND tgrelid = 'storage.objects'::regclass
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE storage.objects DISABLE TRIGGER protect_delete';
  END IF;
  DELETE FROM storage.objects
  WHERE bucket_id = 'client-agent-sends' AND name = v_name;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'protect_delete'
      AND tgrelid = 'storage.objects'::regclass
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE storage.objects ENABLE TRIGGER protect_delete';
  END IF;
END $$;
