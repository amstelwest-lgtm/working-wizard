-- Signup Demo Co. The later accountant hand-off repeats the books-quality
-- data request (one PDF upload, no ledger) even though its figures are margins.
-- Keeps the earlier row, points the later row at it, and moves last_seen forward.
-- Nothing is deleted. Idempotent: a row that already has superseded_by is left
-- alone, and GREATEST(last_seen) is stable on a second run.
--
--   keep 2905a21a-2ee9-4d78-a019-c709c3c702f7 (data_request_draft)
--   supersede 0cb4b83a-de25-4407-b57a-769585a14732 (accountant_handoff_draft)

WITH pairs(keeper_id, dup_id) AS (
  VALUES
    (
      '2905a21a-2ee9-4d78-a019-c709c3c702f7'::uuid,
      '0cb4b83a-de25-4407-b57a-769585a14732'::uuid
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
      '2905a21a-2ee9-4d78-a019-c709c3c702f7'::uuid,
      '0cb4b83a-de25-4407-b57a-769585a14732'::uuid
    )
)
UPDATE public.agent_findings AS keeper
SET last_seen = GREATEST(keeper.last_seen, dup.last_seen)
FROM pairs
JOIN public.agent_findings AS dup ON dup.id = pairs.dup_id
WHERE keeper.id = pairs.keeper_id
  AND dup.superseded_by = pairs.keeper_id;
