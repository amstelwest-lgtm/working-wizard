-- Signup Demo filed weakest_pillar again under the long health range
-- (1 Jan 2026 – 30 Sep 2026) instead of Sep 2026. That is the same period
-- end as the keeper. Keep 69471b80-7e6d-4ec8-b96c-a59b16fb9fce and supersede
-- the row whose id starts b456deb8. last_seen moves forward. Idempotent:
-- a row that already has superseded_by is left alone.
--
-- QA US data-quality rows 9e99e9e8 and 10464c39 compared September figures
-- with an October label. There is no dismissed status. superseded_by is the
-- column the review already filters on, so both leave the active set.
-- Point them at the weakest-pillar keeper whose id starts 8556e68f. Do not
-- move that keeper's last_seen: they are not the same observation.
-- 982d09f0 is a genuine finding and is not superseded. Nothing is deleted.

WITH pairs(keeper_id, dup_id) AS (
  SELECT keeper.id, dup.id
  FROM public.agent_findings AS keeper
  JOIN public.agent_findings AS dup
    ON dup.id::text LIKE 'b456deb8-%'
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
    ON dup.id::text LIKE 'b456deb8-%'
   AND dup.superseded_by = keeper.id
  WHERE keeper.id = '69471b80-7e6d-4ec8-b96c-a59b16fb9fce'::uuid
)
UPDATE public.agent_findings AS keeper
SET last_seen = GREATEST(keeper.last_seen, dup.last_seen)
FROM pairs
JOIN public.agent_findings AS dup ON dup.id = pairs.dup_id
WHERE keeper.id = pairs.keeper_id
  AND dup.superseded_by = pairs.keeper_id;

WITH pairs(keeper_id, dup_id) AS (
  SELECT keeper.id, dup.id
  FROM public.agent_findings AS keeper
  JOIN public.agent_findings AS dup
    ON (
      dup.id::text LIKE '9e99e9e8-%'
      OR dup.id::text LIKE '10464c39-%'
    )
   AND dup.superseded_by IS NULL
  WHERE keeper.id::text LIKE '8556e68f-%'
    AND keeper.superseded_by IS NULL
)
UPDATE public.agent_findings AS dup
SET superseded_by = pairs.keeper_id
FROM pairs
WHERE dup.id = pairs.dup_id
  AND dup.superseded_by IS NULL;
