-- ============================================================================
-- Client Brain funnel counts — owner /ops Funnel health card (public RPC).
-- Run AFTER analytics spine + 20260910140000_analytics_client_brain_funnel.sql.
-- PostgREST cannot read analytics.events directly; this RPC aggregates via
-- analytics.v_real_events without exposing secret values.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.analytics_client_brain_funnel_counts(p_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_days int := greatest(1, least(coalesce(p_days, 7), 90));
BEGIN
  IF NOT analytics.caller_may_operate() THEN
    RAISE EXCEPTION 'analytics_client_brain_funnel_counts is founder / service_role only';
  END IF;

  RETURN (
    WITH keys AS (
      SELECT unnest(
        ARRAY[
          'owner.invite.redeemed',
          'seat.accepted',
          'brain.proposed',
          'brain.step.approved',
          'report.sent'
        ]
      ) AS event_key
    ),
    agg AS (
      SELECT e.event_key, count(*)::int AS cnt
      FROM analytics.v_real_events e
      INNER JOIN keys k USING (event_key)
      WHERE e.occurred_at >= now() - (v_days || ' days')::interval
      GROUP BY e.event_key
    )
    SELECT jsonb_build_object(
      'window_days', v_days,
      'counts', COALESCE(
        (
          SELECT jsonb_object_agg(k.event_key, coalesce(a.cnt, 0) ORDER BY k.event_key)
          FROM keys k
          LEFT JOIN agg a USING (event_key)
        ),
        '{}'::jsonb
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_client_brain_funnel_counts(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_client_brain_funnel_counts(int)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.analytics_client_brain_funnel_counts(int) IS
  'Last-N-day counts for Client Brain design-partner funnel event keys.';
