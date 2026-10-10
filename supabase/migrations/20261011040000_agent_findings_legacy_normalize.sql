-- Normalise analyst findings filed before the kind enum, then collapse the
-- repeats that comparison still treats as the same observation.
-- Idempotent: an enum kind is left alone, a figures object that is already
-- nested per period is left alone, and a row that already has superseded_by
-- is not pointed at a keeper again. GREATEST(last_seen) is stable on a rerun.
--
-- Keep the earliest row:
--   c5dce3e6-1230-455f-b211-6ae400886f76 superseded by 69471b80-7e6d-4ec8-b96c-a59b16fb9fce
--   032eaf02-ea42-4f2b-bd70-872543b1e759 superseded by cd3cfbb4-d97f-46ba-962c-8573d8184656
--
-- 2faf551f-a965-40b4-b250-10cf47705457 is the only Signup Demo Co
-- working-capital finding. Its kind and figures are normalised. It is kept.

UPDATE public.agent_findings
SET kind = CASE
  WHEN kind ILIKE '%weakest%pillar%' THEN 'weakest_pillar'
  WHEN kind ILIKE 'health score decline%' THEN 'score_decline'
  WHEN kind ILIKE '%creditor days%' AND kind ILIKE '%debtor days%' THEN 'working_capital_days'
  ELSE kind
END
WHERE agent = 'analyst'
  AND kind NOT IN (
    'weakest_pillar',
    'score_decline',
    'score_improvement',
    'working_capital_days',
    'margin_compression',
    'margin_improvement',
    'liquidity',
    'leverage',
    'revenue_trend',
    'cost_ratio',
    'data_quality',
    'other'
  );

UPDATE public.agent_findings AS finding
SET evidence = jsonb_set(
  finding.evidence,
  '{figures}',
  CASE
    WHEN coalesce(finding.evidence->>'period_label', '') <> ''
      THEN jsonb_build_object(finding.evidence->>'period_label', renamed.figures)
    ELSE renamed.figures
  END
)
FROM (
  SELECT
    f.id,
    jsonb_object_agg(
      CASE
        WHEN lower(e.key) IN ('profit', 'assets', 'financing', 'cash')
          AND jsonb_typeof(e.value) = 'number'
          AND (e.value::text)::numeric BETWEEN 0 AND 100
          THEN 'pillar:' || lower(e.key)
        WHEN e.key = 'score'
          AND coalesce(f.evidence->>'period_label', '') ~ '^\d{4}-\d{2}-\d{2}$'
          THEN 'score:' || (f.evidence->>'period_label')
        ELSE e.key
      END,
      e.value
    ) AS figures
  FROM public.agent_findings AS f
  CROSS JOIN LATERAL jsonb_each(f.evidence->'figures') AS e(key, value)
  WHERE f.agent = 'analyst'
    AND jsonb_typeof(f.evidence->'figures') = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(f.evidence->'figures') AS nested(key, value)
      WHERE jsonb_typeof(nested.value) = 'object'
    )
  GROUP BY f.id
) AS renamed
WHERE finding.id = renamed.id;

WITH pairs(keeper_id, dup_id) AS (
  VALUES
    (
      '69471b80-7e6d-4ec8-b96c-a59b16fb9fce'::uuid,
      'c5dce3e6-1230-455f-b211-6ae400886f76'::uuid
    ),
    (
      'cd3cfbb4-d97f-46ba-962c-8573d8184656'::uuid,
      '032eaf02-ea42-4f2b-bd70-872543b1e759'::uuid
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
      'c5dce3e6-1230-455f-b211-6ae400886f76'::uuid
    ),
    (
      'cd3cfbb4-d97f-46ba-962c-8573d8184656'::uuid,
      '032eaf02-ea42-4f2b-bd70-872543b1e759'::uuid
    )
)
UPDATE public.agent_findings AS keeper
SET last_seen = GREATEST(keeper.last_seen, dup.last_seen)
FROM pairs
JOIN public.agent_findings AS dup ON dup.id = pairs.dup_id
WHERE keeper.id = pairs.keeper_id
  AND dup.superseded_by = pairs.keeper_id;
