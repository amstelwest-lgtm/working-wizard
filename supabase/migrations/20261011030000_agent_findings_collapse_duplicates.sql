-- Collapse the duplicate analyst findings the title-based dedupe missed.
-- Keeps the earliest row, points the later row at it, and moves last_seen forward.
-- Idempotent: a row that already has superseded_by is left alone, and
-- GREATEST(last_seen) is stable on a second run.
--
-- Signup Demo Co weakest-pillar pair:
--   keep 69471b80-7e6d-4ec8-b96c-a59b16fb9fce
--   supersede c0be29bb-8d51-47f9-a201-32a6ac1a2a2f
-- QA US Test LLC score-decline pair:
--   keep 171506a0-f4c0-46c0-896e-d090dba9d6a1
--   supersede e3f97ba0-a718-4bcb-b7b1-2346877fa6db
--
-- 2faf551f-a965-40b4-b250-10cf47705457 is the only Signup Demo Co
-- working-capital finding (Creditor Days vs Debtor Days). It is kept.
-- Requires 20261011001000_agent_findings_last_seen.sql.

WITH pairs(keeper_id, dup_id) AS (
  VALUES
    (
      '69471b80-7e6d-4ec8-b96c-a59b16fb9fce'::uuid,
      'c0be29bb-8d51-47f9-a201-32a6ac1a2a2f'::uuid
    ),
    (
      '171506a0-f4c0-46c0-896e-d090dba9d6a1'::uuid,
      'e3f97ba0-a718-4bcb-b7b1-2346877fa6db'::uuid
    )
)
UPDATE public.agent_findings AS dup
SET superseded_by = pairs.keeper_id
FROM pairs
WHERE dup.id = pairs.dup_id
  AND dup.superseded_by IS NULL
  AND EXISTS (
    SELECT 1 FROM public.agent_findings AS keeper WHERE keeper.id = pairs.keeper_id
  );

WITH pairs(keeper_id, dup_id) AS (
  VALUES
    (
      '69471b80-7e6d-4ec8-b96c-a59b16fb9fce'::uuid,
      'c0be29bb-8d51-47f9-a201-32a6ac1a2a2f'::uuid
    ),
    (
      '171506a0-f4c0-46c0-896e-d090dba9d6a1'::uuid,
      'e3f97ba0-a718-4bcb-b7b1-2346877fa6db'::uuid
    )
)
UPDATE public.agent_findings AS keeper
SET last_seen = GREATEST(keeper.last_seen, dup.last_seen)
FROM pairs
JOIN public.agent_findings AS dup ON dup.id = pairs.dup_id
WHERE keeper.id = pairs.keeper_id
  AND dup.superseded_by = pairs.keeper_id;
