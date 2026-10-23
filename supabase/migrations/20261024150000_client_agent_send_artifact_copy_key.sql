-- One archive copy per send file.
-- Chief of Staff applies this file. It is not wired into the CI apply script.
--
-- Finish, the copy made when an upload is confirmed, and the backfill that
-- heals sends finished before the copy step shipped all use the same
-- duplicate key: the send, the item, and the source path, stored in
-- client_artifacts.meta. The application checks that key before it copies.
-- This index makes the database refuse a duplicate even when two of those
-- paths race.
--
-- No table is altered, nothing is granted, and no function is created.
-- RLS on client_artifacts is unchanged. completed_at and reviewed_at on
-- client_agent_sends are not touched.

CREATE UNIQUE INDEX IF NOT EXISTS client_artifacts_send_copy_key
  ON public.client_artifacts (
    client_id,
    (meta->>'send_id'),
    (meta->>'item_key'),
    (meta->>'source_path')
  )
  WHERE meta->>'source' = 'client_agent_send';

COMMENT ON INDEX public.client_artifacts_send_copy_key IS
  'A send file is copied into the archive once: per client, send, item, and source path.';
