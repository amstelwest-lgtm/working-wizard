-- ============================================================================
-- MILŌN analytics Phase 3 — SQL 3 of 3 (editor file 5 overall)
-- Experiment registry, digest log, 24-month purge (manual — not auto-delete).
-- Run AFTER 20260902201000_analytics_commitment_stalls.sql
-- prediction is NOT NULL: write the bet before the result.
-- ============================================================================

CREATE TABLE IF NOT EXISTS analytics.experiments (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  name               text NOT NULL,
  hypothesis_id      text NOT NULL CHECK (hypothesis_id IN ('H1', 'H2', 'H3', 'H4', 'H5')),
  started_at         timestamptz NOT NULL DEFAULT now(),
  ends_at            timestamptz,
  cohort_filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
  prediction         text NOT NULL,
  success_metric     text NOT NULL,
  success_threshold  numeric NOT NULL,
  result             text,
  decision           text CHECK (
                       decision IS NULL
                       OR decision IN ('persevere', 'pivot', 'inconclusive', 'abandoned')
                     ),
  pivot_type         text CHECK (
                       pivot_type IS NULL
                       OR pivot_type IN (
                         'zoom_in', 'zoom_out', 'customer_segment', 'customer_need',
                         'platform', 'business_architecture', 'value_capture',
                         'engine_of_growth', 'channel', 'technology'
                       )
                     ),
  decided_at         timestamptz,
  CONSTRAINT experiment_prediction_required CHECK (length(trim(prediction)) > 8),
  CONSTRAINT experiment_pivot_needs_type CHECK (
    decision IS DISTINCT FROM 'pivot' OR pivot_type IS NOT NULL
  ),
  CONSTRAINT experiment_no_result_without_prediction CHECK (prediction IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS analytics.digest_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  recipient    text NOT NULL,
  subject      text NOT NULL,
  body         text NOT NULL,
  triggered_by text NOT NULL,
  worst_line   text
);

ALTER TABLE analytics.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.digest_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "experiments deny all" ON analytics.experiments;
CREATE POLICY "experiments deny all"
  ON analytics.experiments FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "digest_log deny all" ON analytics.digest_log;
CREATE POLICY "digest_log deny all"
  ON analytics.digest_log FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE ON analytics.experiments TO service_role;
GRANT SELECT, INSERT ON analytics.digest_log TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA analytics TO service_role;

CREATE OR REPLACE FUNCTION public.analytics_create_experiment(
  p_name text,
  p_hypothesis_id text,
  p_prediction text,
  p_success_metric text,
  p_success_threshold numeric,
  p_cohort_filter jsonb DEFAULT '{}'::jsonb,
  p_ends_at timestamptz DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT analytics.is_founder_uid(auth.uid()) THEN
    RAISE EXCEPTION 'analytics_create_experiment is founder / service_role only';
  END IF;
  IF length(trim(coalesce(p_prediction, ''))) <= 8 THEN
    RAISE EXCEPTION 'prediction is required before the experiment starts';
  END IF;
  IF p_hypothesis_id NOT IN ('H1', 'H2', 'H3', 'H4', 'H5') THEN
    RAISE EXCEPTION 'hypothesis_id must be H1–H5';
  END IF;
  INSERT INTO analytics.experiments (
    created_by, name, hypothesis_id, prediction,
    success_metric, success_threshold, cohort_filter, ends_at
  ) VALUES (
    auth.uid(), trim(p_name), p_hypothesis_id, trim(p_prediction),
    trim(p_success_metric), p_success_threshold,
    coalesce(p_cohort_filter, '{}'::jsonb), p_ends_at
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_create_experiment(
  text, text, text, text, numeric, jsonb, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_create_experiment(
  text, text, text, text, numeric, jsonb, timestamptz
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_decide_experiment(
  p_id bigint,
  p_decision text,
  p_result text,
  p_pivot_type text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_prediction text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT analytics.is_founder_uid(auth.uid()) THEN
    RAISE EXCEPTION 'analytics_decide_experiment is founder / service_role only';
  END IF;
  IF p_decision NOT IN ('persevere', 'pivot', 'inconclusive', 'abandoned') THEN
    RAISE EXCEPTION 'invalid experiment decision';
  END IF;
  IF p_decision = 'pivot' AND coalesce(nullif(trim(p_pivot_type), ''), '') = '' THEN
    RAISE EXCEPTION 'pivot requires a pivot_type';
  END IF;
  SELECT prediction INTO v_prediction FROM analytics.experiments WHERE id = p_id;
  IF v_prediction IS NULL OR length(trim(v_prediction)) <= 8 THEN
    RAISE EXCEPTION 'cannot record a result without a written prediction';
  END IF;
  UPDATE analytics.experiments
  SET decision = p_decision,
      result = nullif(trim(p_result), ''),
      pivot_type = CASE WHEN p_decision = 'pivot' THEN p_pivot_type ELSE pivot_type END,
      decided_at = now(),
      updated_at = now()
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_decide_experiment(bigint, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_decide_experiment(bigint, text, text, text)
  TO authenticated, service_role;

-- Deletes raw events older than p_months. Weekly snapshots and views stay.
-- Manual only — do not schedule this until you have read the count.
CREATE OR REPLACE FUNCTION public.analytics_purge_old_events(p_months int DEFAULT 24)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT analytics.is_founder_uid(auth.uid()) THEN
    RAISE EXCEPTION 'analytics_purge_old_events is founder / service_role only';
  END IF;
  IF p_months < 6 THEN
    RAISE EXCEPTION 'retention floor is 6 months';
  END IF;
  DELETE FROM analytics.events
  WHERE occurred_at < now() - make_interval(months => p_months);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_purge_old_events(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_purge_old_events(integer)
  TO authenticated, service_role;

COMMENT ON TABLE analytics.experiments IS
  'Write the prediction before the result. A result without a prior bet is rationalisation.';
COMMENT ON TABLE analytics.digest_log IS
  'Sent weekly founder digests. GET on /api/metrics-digest never writes here.';
COMMENT ON FUNCTION public.analytics_purge_old_events(integer) IS
  '24-month default. Aggregates (commitment weekly, queue history, experiments) are kept.';
