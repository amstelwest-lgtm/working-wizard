-- Percent metrics on active findings are stored as percentage points.
-- A stored fraction (|value| <= 1.5) becomes value * 100, rounded to one decimal.
-- value_raw keeps that fraction. 0.6 → 60, 0.0857… → 8.6, 0.16 → 16.
-- Severity, created_at, and superseded_by stay as they are. Nothing is deleted.

UPDATE public.agent_findings AS finding
SET evidence = jsonb_set(finding.evidence, '{metrics}', scaled.metrics, false)
FROM (
  SELECT
    id,
    jsonb_agg(
      CASE
        WHEN metric->>'unit' = 'percent'
          AND (metric->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
          AND abs((metric->>'value')::numeric) <= 1.5
        THEN metric || jsonb_build_object(
          'value_raw', (metric->>'value')::numeric,
          'value',
          CASE
            WHEN round((metric->>'value')::numeric * 100, 1) = trunc(round((metric->>'value')::numeric * 100, 1))
            THEN to_jsonb(trunc(round((metric->>'value')::numeric * 100, 1))::int)
            ELSE to_jsonb(round((metric->>'value')::numeric * 100, 1))
          END
        )
        ELSE metric
      END
      ORDER BY ordinality
    ) AS metrics
  FROM public.agent_findings
  CROSS JOIN LATERAL jsonb_array_elements(evidence->'metrics') WITH ORDINALITY AS item(metric, ordinality)
  WHERE superseded_by IS NULL
    AND dismissed_reason IS NULL
    AND jsonb_typeof(evidence->'metrics') = 'array'
  GROUP BY id
) AS scaled
WHERE finding.id = scaled.id
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(finding.evidence->'metrics') AS metric
    WHERE metric->>'unit' = 'percent'
      AND (metric->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
      AND abs((metric->>'value')::numeric) <= 1.5
  );
