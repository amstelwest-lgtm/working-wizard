-- ============================================================================
-- SQL 6 — allow analytics_refresh_derived() from the Supabase SQL editor.
-- The editor has no JWT, so auth.uid() is null and the founder check failed.
-- Authenticated non-founders are still rejected (role = authenticated).
-- Run this, then: select public.analytics_refresh_derived();
-- ============================================================================

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
  -- SQL editor / psql: no JWT. Do not treat authenticated or anon as ops.
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
