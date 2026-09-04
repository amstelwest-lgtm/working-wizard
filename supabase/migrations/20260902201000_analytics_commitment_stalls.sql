-- ============================================================================
-- MILŌN analytics Phase 2 — SQL 2 of 2
-- SQL4_RETRY_42P17
-- Commitment ladder, stall queue, signal log, refresh RPC.
-- Run AFTER 20260902200000_analytics_derived_views.sql
-- Questions are past-tense / behavioural. H3 stall is not generated.
-- If this file still contains "GENERATED ALWAYS AS ((date_trunc" you have the OLD paste.
-- ============================================================================

CREATE OR REPLACE FUNCTION analytics.is_founder_uid(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = analytics, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN analytics.founder_emails fe ON lower(u.email::text) = lower(fe.email)
    WHERE u.id = p_uid
  );
$$;

CREATE TABLE IF NOT EXISTS analytics.practice_commitment_weekly (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  week_start    date NOT NULL,
  practice_id   uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  highest_rung  text NOT NULL,
  points        integer NOT NULL,
  rungs         jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_founding_practice boolean NOT NULL DEFAULT false,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_start, practice_id)
);

CREATE TABLE IF NOT EXISTS analytics.founder_action_queue (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- No generated column and no date_trunc in DDL (Postgres 42P17).
  week_start         date NOT NULL,
  practice_id        uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  practice_name      text,
  entity_id          uuid,
  is_founding_practice boolean NOT NULL DEFAULT false,
  stall_type         text NOT NULL,
  severity           text NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  detected_at        timestamptz NOT NULL DEFAULT now(),
  suggested_question text NOT NULL,
  status             text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'contacted', 'answered', 'dismissed')),
  outcome_notes      text,
  resolved_at        timestamptz,
  UNIQUE (practice_id, stall_type, week_start)
);

CREATE INDEX IF NOT EXISTS founder_action_queue_open_idx
  ON analytics.founder_action_queue (status, severity)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS analytics.customer_signals (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  captured_at         timestamptz NOT NULL DEFAULT now(),
  practice_id         uuid,
  source              text NOT NULL,
  situation           text NOT NULL,
  literal_ask         text,
  underlying_job      text,
  frequency_stated    text,
  workaround_today    text,
  commitment_observed text,
  hypothesis_id       text,
  is_compliment_only  boolean NOT NULL DEFAULT false,
  CONSTRAINT situation_required CHECK (length(trim(situation)) > 20)
);

ALTER TABLE analytics.practice_commitment_weekly ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.founder_action_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.customer_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commitment deny all" ON analytics.practice_commitment_weekly;
CREATE POLICY "commitment deny all"
  ON analytics.practice_commitment_weekly FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "queue deny all" ON analytics.founder_action_queue;
CREATE POLICY "queue deny all"
  ON analytics.founder_action_queue FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "signals deny all" ON analytics.customer_signals;
CREATE POLICY "signals deny all"
  ON analytics.customer_signals FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE ON analytics.practice_commitment_weekly TO service_role;
GRANT SELECT, INSERT, UPDATE ON analytics.founder_action_queue TO service_role;
GRANT SELECT, INSERT, UPDATE ON analytics.customer_signals TO service_role;

-- Live ladder (highest rung wins; referred_another_practice is unmeasurable).
CREATE OR REPLACE FUNCTION analytics.practice_commitment(p_practice uuid)
RETURNS TABLE (highest_rung text, points integer, rungs jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_signed boolean := true;
  v_demo_only boolean := false;
  v_upload boolean := false;
  v_brand boolean := false;
  v_send boolean := false;
  v_assign boolean := false;
  v_second boolean := false;
  v_seat boolean := false;
  v_paid boolean := false;
  v_real_entities int := 0;
  v_demo_entities int := 0;
  v_rungs jsonb := '[]'::jsonb;
  v_high text := 'signed_up';
  v_pts int := 0;
BEGIN
  SELECT
    count(*) FILTER (WHERE NOT coalesce(c.is_demo, false)),
    count(*) FILTER (WHERE coalesce(c.is_demo, false))
  INTO v_real_entities, v_demo_entities
  FROM public.clients c
  WHERE c.firm_id = p_practice;

  v_demo_only := v_demo_entities > 0 AND v_real_entities = 0;

  SELECT EXISTS (
    SELECT 1 FROM analytics.v_real_events e
    WHERE e.practice_id = p_practice AND e.event_key = 'upload.succeeded'
  ) INTO v_upload;

  SELECT EXISTS (
    SELECT 1 FROM analytics.events e
    WHERE e.practice_id = p_practice
      AND e.event_key = 'practice.brand.configured'
      AND NOT e.is_bot
  ) INTO v_brand;

  SELECT EXISTS (
    SELECT 1 FROM analytics.v_real_events e
    WHERE e.practice_id = p_practice AND e.event_key = 'report.sent'
  ) INTO v_send;

  SELECT EXISTS (
    SELECT 1 FROM analytics.v_real_events e
    WHERE e.practice_id = p_practice AND e.event_key = 'task.assigned'
  ) INTO v_assign;

  v_second := v_real_entities >= 2;

  SELECT EXISTS (
    SELECT 1 FROM analytics.events e
    WHERE e.practice_id = p_practice
      AND e.event_key IN ('seat.invited', 'seat.accepted')
      AND NOT e.is_bot
  ) INTO v_seat;

  SELECT EXISTS (
    SELECT 1 FROM analytics.v_real_events e
    WHERE e.practice_id = p_practice AND e.event_key = 'payment.recorded'
  ) INTO v_paid;

  IF v_signed THEN
    v_rungs := v_rungs || jsonb_build_array('signed_up');
  END IF;
  IF v_demo_only THEN
    v_rungs := v_rungs || jsonb_build_array('demo_entity_only');
    v_high := 'demo_entity_only'; v_pts := 1;
  END IF;
  IF v_upload THEN
    v_rungs := v_rungs || jsonb_build_array('real_client_uploaded');
    v_high := 'real_client_uploaded'; v_pts := 5;
  END IF;
  IF v_brand THEN
    v_rungs := v_rungs || jsonb_build_array('branding_configured');
    v_high := 'branding_configured'; v_pts := 8;
  END IF;
  IF v_send THEN
    v_rungs := v_rungs || jsonb_build_array('report_sent_to_client');
    v_high := 'report_sent_to_client'; v_pts := 15;
  END IF;
  IF v_assign THEN
    v_rungs := v_rungs || jsonb_build_array('task_assigned');
    v_high := 'task_assigned'; v_pts := 20;
  END IF;
  IF v_second THEN
    v_rungs := v_rungs || jsonb_build_array('second_entity_added');
    v_high := 'second_entity_added'; v_pts := 25;
  END IF;
  IF v_seat THEN
    v_rungs := v_rungs || jsonb_build_array('colleague_invited');
    v_high := 'colleague_invited'; v_pts := 30;
  END IF;
  IF v_paid THEN
    v_rungs := v_rungs || jsonb_build_array('invoice_paid');
    v_high := 'invoice_paid'; v_pts := 50;
  END IF;

  highest_rung := v_high;
  points := v_pts;
  rungs := v_rungs;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE VIEW analytics.v_practice_commitment_current AS
SELECT
  f.id AS practice_id,
  f.name AS practice_name,
  coalesce(f.is_founding_practice, false) AS is_founding_practice,
  c.highest_rung,
  c.points,
  c.rungs
FROM public.firms f
CROSS JOIN LATERAL analytics.practice_commitment(f.id) c
WHERE NOT coalesce(f.is_internal, false);

GRANT SELECT ON analytics.v_practice_commitment_current TO service_role;

CREATE OR REPLACE FUNCTION analytics.snapshot_commitment_weekly()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_week date := date_trunc('week', now())::date;
  v_n int := 0;
BEGIN
  INSERT INTO analytics.practice_commitment_weekly (
    week_start, practice_id, highest_rung, points, rungs, is_founding_practice
  )
  SELECT
    v_week,
    v.practice_id,
    v.highest_rung,
    v.points,
    v.rungs,
    v.is_founding_practice
  FROM analytics.v_practice_commitment_current v
  ON CONFLICT (week_start, practice_id) DO UPDATE
    SET highest_rung = excluded.highest_rung,
        points = excluded.points,
        rungs = excluded.rungs,
        is_founding_practice = excluded.is_founding_practice,
        computed_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Stall queue. Questions copied from src/lib/metrics/definitions.ts — keep in sync.
CREATE OR REPLACE FUNCTION analytics.refresh_founder_action_queue()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_n int := 0;
BEGIN
  -- signup_no_entity
  INSERT INTO analytics.founder_action_queue (
    week_start, practice_id, practice_name, is_founding_practice, stall_type, severity, suggested_question
  )
  SELECT
    (date_trunc('week', timezone('UTC', now())))::date,
    f.id, f.name, coalesce(f.is_founding_practice, false),
    'signup_no_entity', 'medium',
    'Walk me through what you did right after you signed up — where did you get stuck?'
  FROM public.firms f
  WHERE NOT coalesce(f.is_internal, false)
    AND f.created_at < now() - interval '5 days'
    AND NOT EXISTS (
      SELECT 1 FROM analytics.v_real_events e
      WHERE e.practice_id = f.id AND e.event_key = 'entity.created'
    )
  ON CONFLICT (practice_id, stall_type, week_start) DO NOTHING;

  -- upload_no_report
  INSERT INTO analytics.founder_action_queue (
    week_start, practice_id, practice_name, entity_id, is_founding_practice, stall_type, severity, suggested_question
  )
  SELECT DISTINCT ON (f.id)
    (date_trunc('week', timezone('UTC', now())))::date,
    f.id, f.name, e.entity_id, coalesce(f.is_founding_practice, false),
    'upload_no_report', 'high',
    'You uploaded a client''s statements but didn''t generate a report — what happened next?'
  FROM public.firms f
  JOIN analytics.v_real_events e ON e.practice_id = f.id AND e.event_key = 'upload.succeeded'
  WHERE NOT coalesce(f.is_internal, false)
    AND e.occurred_at < now() - interval '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM analytics.v_real_events r
      WHERE r.practice_id = f.id
        AND r.event_key IN ('report.sent', 'report.downloaded', 'report.zip_all')
    )
  ORDER BY f.id, e.occurred_at
  ON CONFLICT (practice_id, stall_type, week_start) DO NOTHING;

  -- report_no_send
  INSERT INTO analytics.founder_action_queue (
    week_start, practice_id, practice_name, entity_id, is_founding_practice, stall_type, severity, suggested_question
  )
  SELECT DISTINCT ON (f.id)
    (date_trunc('week', timezone('UTC', now())))::date,
    f.id, f.name, d.entity_id, coalesce(f.is_founding_practice, false),
    'report_no_send', 'high',
    'You made a report for a client but didn''t send it. What stopped you?'
  FROM public.firms f
  JOIN analytics.v_real_events d
    ON d.practice_id = f.id AND d.event_key IN ('report.downloaded', 'report.zip_all')
  WHERE NOT coalesce(f.is_internal, false)
    AND d.occurred_at < now() - interval '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM analytics.v_real_events s
      WHERE s.practice_id = f.id AND s.event_key = 'report.sent'
    )
  ORDER BY f.id, d.occurred_at
  ON CONFLICT (practice_id, stall_type, week_start) DO NOTHING;

  -- send_no_assign
  INSERT INTO analytics.founder_action_queue (
    week_start, practice_id, practice_name, entity_id, is_founding_practice, stall_type, severity, suggested_question
  )
  SELECT DISTINCT ON (f.id)
    (date_trunc('week', timezone('UTC', now())))::date,
    f.id, f.name, s.entity_id, coalesce(f.is_founding_practice, false),
    'send_no_assign', 'high',
    'After the client saw the report, what did you actually do to get things fixed?'
  FROM public.firms f
  JOIN analytics.v_real_events s ON s.practice_id = f.id AND s.event_key = 'report.sent'
  WHERE NOT coalesce(f.is_internal, false)
    AND s.occurred_at < now() - interval '10 days'
    AND NOT EXISTS (
      SELECT 1 FROM analytics.v_real_events t
      WHERE t.practice_id = f.id AND t.event_key = 'task.assigned'
    )
  ORDER BY f.id, s.occurred_at
  ON CONFLICT (practice_id, stall_type, week_start) DO NOTHING;

  -- assign_no_completion
  INSERT INTO analytics.founder_action_queue (
    week_start, practice_id, practice_name, entity_id, is_founding_practice, stall_type, severity, suggested_question
  )
  SELECT DISTINCT ON (f.id)
    (date_trunc('week', timezone('UTC', now())))::date,
    f.id, f.name, a.entity_id, coalesce(f.is_founding_practice, false),
    'assign_no_completion', 'high',
    'Talk me through the last task you assigned — what did the person on the other end do?'
  FROM public.firms f
  JOIN analytics.v_real_events a ON a.practice_id = f.id AND a.event_key = 'task.assigned'
  WHERE NOT coalesce(f.is_internal, false)
    AND a.occurred_at < now() - interval '14 days'
    AND NOT EXISTS (
      SELECT 1 FROM analytics.v_real_events c
      WHERE c.practice_id = f.id AND c.event_key = 'task.completed'
    )
  ORDER BY f.id, a.occurred_at
  ON CONFLICT (practice_id, stall_type, week_start) DO NOTHING;

  -- month2_dormant
  INSERT INTO analytics.founder_action_queue (
    week_start, practice_id, practice_name, is_founding_practice, stall_type, severity, suggested_question
  )
  SELECT
    (date_trunc('week', timezone('UTC', now())))::date,
    f.id, f.name, coalesce(f.is_founding_practice, false),
    'month2_dormant', 'high',
    'What were you using instead of MILŌN this month?'
  FROM public.firms f
  WHERE NOT coalesce(f.is_internal, false)
    AND f.created_at < now() - interval '51 days'
    AND EXISTS (
      SELECT 1 FROM analytics.v_real_events e
      WHERE e.practice_id = f.id
        AND e.event_key IN ('upload.succeeded', 'report.sent', 'task.assigned', 'task.completed')
        AND e.occurred_at >= f.created_at
        AND e.occurred_at < f.created_at + interval '30 days'
    )
    AND NOT EXISTS (
      SELECT 1 FROM analytics.v_real_events e
      WHERE e.practice_id = f.id
        AND e.event_key IN ('upload.succeeded', 'report.sent', 'task.assigned', 'task.completed')
        AND e.occurred_at >= f.created_at + interval '30 days'
    )
  ON CONFLICT (practice_id, stall_type, week_start) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION analytics.caller_may_operate()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_role text := coalesce(auth.role(), '');
  v_uid uuid := auth.uid();
BEGIN
  IF v_role = 'service_role' THEN
    RETURN true;
  END IF;
  IF v_uid IS NOT NULL AND analytics.is_founder_uid(v_uid) THEN
    RETURN true;
  END IF;
  IF v_uid IS NULL AND v_role NOT IN ('authenticated', 'anon') THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_refresh_derived()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_commit int;
  v_queue int;
BEGIN
  IF NOT analytics.caller_may_operate() THEN
    RAISE EXCEPTION 'analytics_refresh_derived is founder / service_role only';
  END IF;
  v_commit := analytics.snapshot_commitment_weekly();
  v_queue := analytics.refresh_founder_action_queue();
  RETURN jsonb_build_object(
    'commitment_rows', v_commit,
    'queue_inserts', v_queue,
    'refreshed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_refresh_derived() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_refresh_derived() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_log_signal(
  p_practice_id uuid,
  p_source text,
  p_situation text,
  p_literal_ask text DEFAULT NULL,
  p_underlying_job text DEFAULT NULL,
  p_frequency_stated text DEFAULT NULL,
  p_workaround_today text DEFAULT NULL,
  p_commitment_observed text DEFAULT NULL,
  p_hypothesis_id text DEFAULT NULL,
  p_is_compliment_only boolean DEFAULT false
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
    RAISE EXCEPTION 'analytics_log_signal is founder / service_role only';
  END IF;
  IF length(trim(coalesce(p_situation, ''))) <= 20 THEN
    RAISE EXCEPTION 'situation is required (what they actually do today) — more than 20 characters';
  END IF;
  INSERT INTO analytics.customer_signals (
    practice_id, source, situation, literal_ask, underlying_job,
    frequency_stated, workaround_today, commitment_observed,
    hypothesis_id, is_compliment_only
  ) VALUES (
    p_practice_id, coalesce(nullif(trim(p_source), ''), 'call'),
    trim(p_situation), p_literal_ask, p_underlying_job,
    p_frequency_stated, p_workaround_today, p_commitment_observed,
    p_hypothesis_id, coalesce(p_is_compliment_only, false)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_log_signal(
  uuid, text, text, text, text, text, text, text, text, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_log_signal(
  uuid, text, text, text, text, text, text, text, text, boolean
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_update_queue_item(
  p_id bigint,
  p_status text,
  p_outcome_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT analytics.is_founder_uid(auth.uid()) THEN
    RAISE EXCEPTION 'analytics_update_queue_item is founder / service_role only';
  END IF;
  IF p_status NOT IN ('open', 'contacted', 'answered', 'dismissed') THEN
    RAISE EXCEPTION 'invalid queue status';
  END IF;
  UPDATE analytics.founder_action_queue
  SET status = p_status,
      outcome_notes = coalesce(p_outcome_notes, outcome_notes),
      resolved_at = CASE WHEN p_status IN ('answered', 'dismissed') THEN now() ELSE resolved_at END
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_update_queue_item(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_update_queue_item(bigint, text, text)
  TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'analytics-refresh-derived',
      '15 4 * * *',
      $cron$SELECT public.analytics_refresh_derived()$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
