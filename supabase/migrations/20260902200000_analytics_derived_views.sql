-- ============================================================================
-- MILŌN analytics Phase 2 — SQL 1 of 2
-- Cohort / funnel views. Run AFTER Phase 1 spine + triggers.
-- Then run 20260902201000_analytics_commitment_stalls.sql
-- Regular views (not matviews): founder numbers must not go stale.
-- Excludes is_internal / is_demo / is_bot. Splits Founding Practice.
-- No cumulative counters.
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_real_events AS
SELECT *
FROM analytics.events
WHERE NOT is_internal
  AND NOT is_demo
  AND NOT is_bot;

COMMENT ON VIEW analytics.v_real_events IS
  'Real-traffic events only. Every founder metric reads through this.';

GRANT SELECT ON analytics.v_real_events TO service_role;

-- Practice activation by signup week (H1).
-- Activation = report.sent within 14 days of firms.created_at.
-- report.downloaded is a weaker step, not activation.
CREATE OR REPLACE VIEW analytics.v_practice_activation AS
WITH practices AS (
  SELECT
    f.id AS practice_id,
    date_trunc('week', f.created_at) AS cohort_week,
    f.created_at,
    coalesce(f.is_founding_practice, false) AS is_founding_practice
  FROM public.firms f
  WHERE NOT coalesce(f.is_internal, false)
),
milestones AS (
  SELECT
    pr.practice_id,
    pr.cohort_week,
    pr.created_at,
    pr.is_founding_practice,
    min(e.occurred_at) FILTER (WHERE e.event_key = 'entity.created') AS first_entity_at,
    min(e.occurred_at) FILTER (WHERE e.event_key = 'upload.succeeded') AS first_upload_at,
    min(e.occurred_at) FILTER (WHERE e.event_key = 'report.downloaded') AS first_download_at,
    min(e.occurred_at) FILTER (WHERE e.event_key = 'report.sent') AS first_send_at,
    min(e.occurred_at) FILTER (WHERE e.event_key = 'task.assigned') AS first_assign_at,
    min(e.occurred_at) FILTER (WHERE e.event_key = 'task.completed') AS first_completion_at
  FROM practices pr
  LEFT JOIN analytics.v_real_events e ON e.practice_id = pr.practice_id
  GROUP BY 1, 2, 3, 4
)
SELECT
  cohort_week,
  is_founding_practice,
  count(*) AS practices,
  count(first_entity_at) AS reached_entity,
  count(first_upload_at) AS reached_upload,
  count(first_download_at) AS reached_download,
  count(first_send_at) AS reached_send,
  count(first_assign_at) AS reached_assign,
  count(first_completion_at) AS reached_completion,
  round(
    100.0 * count(*) FILTER (
      WHERE first_send_at IS NOT NULL
        AND first_send_at <= created_at + interval '14 days'
    ) / nullif(count(*), 0),
    1
  ) AS activation_14d_pct
FROM milestones
GROUP BY 1, 2;

COMMENT ON VIEW analytics.v_practice_activation IS
  'H1. activation_14d_pct = report.sent within 14d. Founding Practice is a separate row, never blended.';

GRANT SELECT ON analytics.v_practice_activation TO service_role;

-- Accountability loop by assignment week (H2).
-- Only task.link.engaged (not rendered, not GET) counts as human open.
CREATE OR REPLACE VIEW analytics.v_accountability_loop AS
WITH assigned AS (
  SELECT
    object_id,
    min(occurred_at) AS occurred_at
  FROM analytics.v_real_events
  WHERE event_key = 'task.assigned'
    AND object_id IS NOT NULL
  GROUP BY 1
),
completed AS (
  SELECT object_id, min(occurred_at) AS occurred_at
  FROM analytics.v_real_events
  WHERE event_key = 'task.completed'
    AND object_id IS NOT NULL
  GROUP BY 1
),
hours AS (
  SELECT
    a.object_id,
    a.occurred_at,
    extract(epoch FROM (c.occurred_at - a.occurred_at)) / 3600.0 AS hours_to_complete
  FROM assigned a
  JOIN completed c ON c.object_id = a.object_id
)
SELECT
  date_trunc('week', a.occurred_at) AS cohort_week,
  count(*)::int AS tasks_assigned,
  count(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM analytics.v_real_events d
      WHERE d.object_id = a.object_id AND d.event_key = 'task.email.dispatched'
    )
  )::int AS emails_dispatched,
  count(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM analytics.v_real_events g
      WHERE g.object_id = a.object_id
        AND g.event_key = 'task.link.engaged'
        AND NOT g.is_bot
    )
  )::int AS links_engaged_by_human,
  count(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM analytics.v_real_events p
      WHERE p.object_id = a.object_id AND p.event_key = 'task.status_changed'
    )
  )::int AS status_progressed,
  count(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM completed c WHERE c.object_id = a.object_id
    )
  )::int AS completed,
  round(
    100.0 * count(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM completed c
        WHERE c.object_id = a.object_id
          AND c.occurred_at <= a.occurred_at + interval '14 days'
      )
    ) / nullif(count(*), 0),
    1
  ) AS completion_14d_pct,
  round(
    (
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY h.hours_to_complete
      )
    )::numeric,
    1
  ) AS median_hours_to_complete
FROM assigned a
LEFT JOIN hours h ON h.object_id = a.object_id
GROUP BY 1;

COMMENT ON VIEW analytics.v_accountability_loop IS
  'H2 funnel: assigned → dispatched → engaged (human POST) → progressed → completed. GET is not engagement.';

GRANT SELECT ON analytics.v_accountability_loop TO service_role;

-- Report sent → task assigned within 7 days (H2).
CREATE OR REPLACE VIEW analytics.v_assignment_adoption AS
WITH sends AS (
  SELECT
    entity_id,
    min(occurred_at) AS first_send_at
  FROM analytics.v_real_events
  WHERE event_key = 'report.sent'
    AND entity_id IS NOT NULL
  GROUP BY 1
)
SELECT
  date_trunc('week', s.first_send_at) AS cohort_week,
  count(*)::int AS entities_with_send,
  count(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM analytics.v_real_events t
      WHERE t.entity_id = s.entity_id
        AND t.event_key = 'task.assigned'
        AND t.occurred_at <= s.first_send_at + interval '7 days'
    )
  )::int AS assigned_within_7d,
  round(
    100.0 * count(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM analytics.v_real_events t
        WHERE t.entity_id = s.entity_id
          AND t.event_key = 'task.assigned'
          AND t.occurred_at <= s.first_send_at + interval '7 days'
      )
    ) / nullif(count(*), 0),
    1
  ) AS assignment_adoption_pct
FROM sends s
GROUP BY 1;

COMMENT ON VIEW analytics.v_assignment_adoption IS
  'H2. Of entities with report.sent, % with task.assigned within 7 days.';

GRANT SELECT ON analytics.v_assignment_adoption TO service_role;

-- Median non-demo entities per practice by signup month (H4).
CREATE OR REPLACE VIEW analytics.v_entity_expansion AS
WITH practices AS (
  SELECT
    f.id AS practice_id,
    date_trunc('month', f.created_at) AS cohort_month,
    coalesce(f.is_founding_practice, false) AS is_founding_practice
  FROM public.firms f
  WHERE NOT coalesce(f.is_internal, false)
),
counts AS (
  SELECT
    p.practice_id,
    p.cohort_month,
    p.is_founding_practice,
    count(*) FILTER (WHERE e.event_key = 'entity.created') AS entities
  FROM practices p
  LEFT JOIN analytics.v_real_events e ON e.practice_id = p.practice_id
  GROUP BY 1, 2, 3
)
SELECT
  cohort_month,
  is_founding_practice,
  count(*)::int AS practices,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY entities))::numeric, 1) AS median_entities
FROM counts
GROUP BY 1, 2;

COMMENT ON VIEW analytics.v_entity_expansion IS
  'H4. Median real (non-demo) entities per practice. Plateau at 1–2 falsifies the channel.';

GRANT SELECT ON analytics.v_entity_expansion TO service_role;

-- Month-2 retention among practices old enough to have entered month 2 (H1).
CREATE OR REPLACE VIEW analytics.v_month2_retention AS
WITH practices AS (
  SELECT
    f.id AS practice_id,
    f.created_at,
    date_trunc('month', f.created_at) AS cohort_month,
    coalesce(f.is_founding_practice, false) AS is_founding_practice
  FROM public.firms f
  WHERE NOT coalesce(f.is_internal, false)
),
active AS (
  SELECT
    p.practice_id,
    p.cohort_month,
    p.is_founding_practice,
    p.created_at + interval '51 days' <= now() AS eligible,
    EXISTS (
      SELECT 1 FROM analytics.v_real_events e
      WHERE e.practice_id = p.practice_id
        AND e.event_key IN ('upload.succeeded', 'report.sent', 'task.assigned', 'task.completed')
        AND e.occurred_at >= p.created_at
        AND e.occurred_at < p.created_at + interval '30 days'
    ) AS active_m1,
    EXISTS (
      SELECT 1 FROM analytics.v_real_events e
      WHERE e.practice_id = p.practice_id
        AND e.event_key IN ('upload.succeeded', 'report.sent', 'task.assigned', 'task.completed')
        AND e.occurred_at >= p.created_at + interval '30 days'
        AND e.occurred_at < p.created_at + interval '60 days'
    ) AS active_m2
  FROM practices p
)
SELECT
  cohort_month,
  is_founding_practice,
  count(*) FILTER (WHERE eligible AND active_m1)::int AS active_month1,
  count(*) FILTER (WHERE eligible AND active_m1 AND active_m2)::int AS active_month2,
  round(
    100.0 * count(*) FILTER (WHERE eligible AND active_m1 AND active_m2)
      / nullif(count(*) FILTER (WHERE eligible AND active_m1), 0),
    1
  ) AS month2_retention_pct
FROM active
GROUP BY 1, 2;

COMMENT ON VIEW analytics.v_month2_retention IS
  'H1. Practices with a commitment event in days 0–30 that also have one in days 30–60. Younger cohorts omitted from the percentage.';

GRANT SELECT ON analytics.v_month2_retention TO service_role;
