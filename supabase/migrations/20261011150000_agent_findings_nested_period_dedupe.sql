-- Signup Demo Co filed weakest_pillar again for Sep 2026 (profit 58). The new
-- row nests figures by period and leaves snapshot_id and period_label null, so
-- dedupe did not see it as the same period as the keeper.
--
-- Keep 69471b80-7e6d-4ec8-b96c-a59b16fb9fce.
-- Supersede the row whose id starts 42d2fad5, and move last_seen forward.
-- Idempotent: a row that already has superseded_by is left alone, and
-- GREATEST(last_seen) is stable on a second run.
--
-- The two finding messages inserted with a null recipient (cfaa8b3d, 7c147e88)
-- are addressed to financial_manager. A second run finds to_agent already set.

WITH pairs(keeper_id, dup_id) AS (
  SELECT keeper.id, dup.id
  FROM public.agent_findings AS keeper
  JOIN public.agent_findings AS dup
    ON dup.id::text LIKE '42d2fad5-%'
   AND dup.superseded_by IS NULL
  WHERE keeper.id = '69471b80-7e6d-4ec8-b96c-a59b16fb9fce'::uuid
)
UPDATE public.agent_findings AS dup
SET superseded_by = pairs.keeper_id
FROM pairs
WHERE dup.id = pairs.dup_id
  AND dup.superseded_by IS NULL;

WITH pairs(keeper_id, dup_id) AS (
  SELECT keeper.id, dup.id
  FROM public.agent_findings AS keeper
  JOIN public.agent_findings AS dup
    ON dup.id::text LIKE '42d2fad5-%'
   AND dup.superseded_by = keeper.id
  WHERE keeper.id = '69471b80-7e6d-4ec8-b96c-a59b16fb9fce'::uuid
)
UPDATE public.agent_findings AS keeper
SET last_seen = GREATEST(keeper.last_seen, dup.last_seen)
FROM pairs
JOIN public.agent_findings AS dup ON dup.id = pairs.dup_id
WHERE keeper.id = pairs.keeper_id
  AND dup.superseded_by = pairs.keeper_id;

UPDATE public.agent_messages
SET to_agent = 'financial_manager'
WHERE to_agent IS NULL
  AND type = 'finding'
  AND (
    id::text LIKE 'cfaa8b3d-%'
    OR id::text LIKE '7c147e88-%'
  );
