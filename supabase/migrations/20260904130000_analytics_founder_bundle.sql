-- ============================================================================
-- SQL 7 — founder instrument reads without exposing the analytics schema.
-- SQL 3–6 create tables in `analytics`. PostgREST only serves exposed schemas
-- (usually public). `.schema('analytics')` then errors: Invalid schema: analytics
-- even though the SQL editor paste succeeded. This RPC lives in public.
-- Run AFTER SQL 6. Do not re-paste 3–6.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.analytics_founder_bundle()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = analytics, public
AS $$
BEGIN
  IF NOT analytics.caller_may_operate() THEN
    RAISE EXCEPTION 'analytics_founder_bundle is founder / service_role only';
  END IF;

  RETURN jsonb_build_object(
    'activation', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM analytics.v_practice_activation t), '[]'::jsonb),
    'loop', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM analytics.v_accountability_loop t), '[]'::jsonb),
    'adoption', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM analytics.v_assignment_adoption t), '[]'::jsonb),
    'expansion', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM analytics.v_entity_expansion t), '[]'::jsonb),
    'retention', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM analytics.v_month2_retention t), '[]'::jsonb),
    'commitment', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM analytics.v_practice_commitment_current t), '[]'::jsonb),
    'queue', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM analytics.founder_action_queue t), '[]'::jsonb),
    'signals', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM analytics.customer_signals t), '[]'::jsonb),
    'experiments', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM analytics.experiments t), '[]'::jsonb),
    'founder_emails', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM analytics.founder_emails t), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_founder_bundle() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_founder_bundle()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_log_digest(
  p_recipient text,
  p_subject text,
  p_body text,
  p_triggered_by text,
  p_worst_line text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
BEGIN
  IF NOT analytics.caller_may_operate() THEN
    RAISE EXCEPTION 'analytics_log_digest is founder / service_role only';
  END IF;
  INSERT INTO analytics.digest_log (recipient, subject, body, triggered_by, worst_line)
  VALUES (p_recipient, p_subject, p_body, p_triggered_by, p_worst_line);
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_log_digest(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_log_digest(text, text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.analytics_founder_bundle() IS
  'Founder instrument payload. Avoids PostgREST Invalid schema: analytics.';
