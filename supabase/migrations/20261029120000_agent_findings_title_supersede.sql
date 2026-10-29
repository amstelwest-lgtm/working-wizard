-- One open finding per agent, client, and title. The title key matches
-- findingTitleKey in src/lib/finding-title-key.ts: lowercase, digits removed,
-- whitespace collapsed. The newest row (last_seen, then created_at) is kept;
-- older open rows point at it through superseded_by. The writers in
-- supabase/functions do the same on every new finding from now on.
--
-- Nothing is deleted. Approved and dismissed rows are left alone.
-- Idempotent: a second run finds no open duplicates.

WITH open_rows AS (
  SELECT
    f.id,
    f.status,
    first_value(f.id) OVER (
      PARTITION BY
        f.client_id,
        f.agent,
        btrim(regexp_replace(lower(regexp_replace(f.title, '[0-9]', '', 'g')), '\s+', ' ', 'g'))
      ORDER BY COALESCE(f.last_seen, f.created_at) DESC, f.id DESC
    ) AS keeper_id
  FROM public.agent_findings AS f
  WHERE f.superseded_by IS NULL
    AND f.dismissed_reason IS NULL
    AND f.status IS DISTINCT FROM 'dismissed'
    AND btrim(regexp_replace(lower(regexp_replace(f.title, '[0-9]', '', 'g')), '\s+', ' ', 'g')) <> ''
)
UPDATE public.agent_findings AS dup
SET superseded_by = open_rows.keeper_id
FROM open_rows
WHERE dup.id = open_rows.id
  AND open_rows.id <> open_rows.keeper_id
  AND open_rows.status IS DISTINCT FROM 'approved'
  AND dup.superseded_by IS NULL;
