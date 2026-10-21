-- Test-only. Plants policies the migration must remove.
-- Not part of the migration. Does not run against a hosted database.

SET client_min_messages TO warning;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client-agent-sends anon select" ON storage.objects;
DROP POLICY IF EXISTS "client-agent-sends anon insert" ON storage.objects;
DROP POLICY IF EXISTS "client-agent-sends anon update" ON storage.objects;
DROP POLICY IF EXISTS "client-agent-sends anon delete" ON storage.objects;
DROP POLICY IF EXISTS "client-agent-sends authenticated select" ON storage.objects;
DROP POLICY IF EXISTS "client-agent-sends authenticated insert" ON storage.objects;
DROP POLICY IF EXISTS "client-agent-sends authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "client-agent-sends authenticated delete" ON storage.objects;
DROP POLICY IF EXISTS "client-agent-sends leak" ON storage.objects;

CREATE POLICY "client-agent-sends anon select"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'client-agent-sends');

CREATE POLICY "client-agent-sends anon insert"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'client-agent-sends');

CREATE POLICY "client-agent-sends anon update"
  ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'client-agent-sends')
  WITH CHECK (bucket_id = 'client-agent-sends');

CREATE POLICY "client-agent-sends anon delete"
  ON storage.objects FOR DELETE TO anon
  USING (bucket_id = 'client-agent-sends');

CREATE POLICY "client-agent-sends authenticated select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-agent-sends');

CREATE POLICY "client-agent-sends authenticated insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-agent-sends');

CREATE POLICY "client-agent-sends authenticated update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'client-agent-sends')
  WITH CHECK (bucket_id = 'client-agent-sends');

CREATE POLICY "client-agent-sends authenticated delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-agent-sends');

CREATE POLICY "client-agent-sends leak"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (true);
