-- Collapse related drafts that cite the same period end and the same figures.
-- Keeps the earlier row, points the later row at it, and moves last_seen forward.
-- Nothing is deleted. Idempotent: a row that already has superseded_by is left
-- alone, and GREATEST(last_seen) is stable on a second run.
--
-- Advisor, Signup Demo Co. The next move was already on file:
--   keep e37ea580-249a-4d8c-b52c-74cd795c4928 (next_move_draft)
--   supersede d3604217-2f05-4375-873e-232662b46c77 (advisory_deliverable_draft)
-- Financial Manager, same client. The data request was already on file:
--   keep 2905a21a-2ee9-4d78-a019-c709c3c702f7 (data_request_draft)
--   supersede a1dd5a9f-1c80-4d0b-88c2-afbdb210bc4a (accountant_handoff_draft)

WITH pairs(keeper_id, dup_id) AS (
  VALUES
    (
      'e37ea580-249a-4d8c-b52c-74cd795c4928'::uuid,
      'd3604217-2f05-4375-873e-232662b46c77'::uuid
    ),
    (
      '2905a21a-2ee9-4d78-a019-c709c3c702f7'::uuid,
      'a1dd5a9f-1c80-4d0b-88c2-afbdb210bc4a'::uuid
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
      'e37ea580-249a-4d8c-b52c-74cd795c4928'::uuid,
      'd3604217-2f05-4375-873e-232662b46c77'::uuid
    ),
    (
      '2905a21a-2ee9-4d78-a019-c709c3c702f7'::uuid,
      'a1dd5a9f-1c80-4d0b-88c2-afbdb210bc4a'::uuid
    )
)
UPDATE public.agent_findings AS keeper
SET last_seen = GREATEST(keeper.last_seen, dup.last_seen)
FROM pairs
JOIN public.agent_findings AS dup ON dup.id = pairs.dup_id
WHERE keeper.id = pairs.keeper_id
  AND dup.superseded_by = pairs.keeper_id;
