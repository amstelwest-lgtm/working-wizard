-- ============================================================
-- MILŌN — Automatic nudge dispatcher
-- Adds the find_nudge_candidates helper used by the
-- nudge-action-items edge function, plus pg_cron scheduling.
-- ============================================================

-- Index to make cooldown queries fast (action_emails lookup).
CREATE INDEX IF NOT EXISTS idx_action_emails_item_type_created
  ON action_emails (action_item_id, email_type, created_at DESC);

-- ── find_nudge_candidates ────────────────────────────────────────────────────
-- Returns action items that:
--   1. Have been assigned (sent_at IS NOT NULL, owner has email)
--   2. Are not done
--   3. Health is overdue, at_risk, or off_track
--   4. Have NOT received a nudge or overdue email since p_cooldown_cutoff
--
-- Called by the nudge-action-items edge function with service role.
CREATE OR REPLACE FUNCTION find_nudge_candidates(p_cooldown_cutoff timestamptz)
RETURNS TABLE (
  id              uuid,
  title           text,
  outcome_why     text,
  due_date        date,
  plan_id         uuid,
  client_id       uuid,
  client_name     text,
  employee_id     uuid,
  owner_name      text,
  owner_email     text,
  period_label    text,
  health          action_health
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ai.id,
    ai.title,
    ai.outcome_why,
    ai.due_date,
    ai.plan_id,
    ai.client_id,
    c.name                                                         AS client_name,
    e.id                                                           AS employee_id,
    e.name                                                         AS owner_name,
    e.email                                                        AS owner_email,
    ap.period_label,
    action_item_health(ai.status, ai.due_date, ai.progress_pct, ai.created_at) AS health
  FROM action_items ai
  JOIN action_plans   ap ON ap.id       = ai.plan_id
  JOIN clients        c  ON c.id        = ai.client_id
  JOIN client_employees e ON e.id       = ai.owner_id
  WHERE
    -- Must have been assigned already.
    ai.sent_at IS NOT NULL
    AND ai.status  != 'done'
    AND e.email IS NOT NULL
    -- Health: only nudge items that are falling behind.
    AND action_item_health(ai.status, ai.due_date, ai.progress_pct, ai.created_at)
          IN ('overdue', 'at_risk', 'off_track')
    -- Cooldown: no nudge/overdue email logged for this item since the cutoff.
    AND NOT EXISTS (
      SELECT 1
      FROM action_emails ae
      WHERE ae.action_item_id = ai.id
        AND ae.email_type     IN ('nudge', 'overdue')
        AND ae.created_at      > p_cooldown_cutoff
    );
$$;

-- Grant to service role so the edge function can call it.
GRANT EXECUTE ON FUNCTION find_nudge_candidates(timestamptz) TO service_role;

-- ============================================================
-- pg_cron — schedule the nudge job once per day at 08:00 UTC.
--
-- IMPORTANT: This block requires two things already in place:
--   1. The vault secret 'email_queue_service_role_key' (set up
--      by the email-infra migration/setup_email_infra tool).
--   2. The Supabase project URL stored as vault secret
--      'supabase_project_url'  (value: https://<ref>.supabase.co).
--
-- If those secrets are missing the DO block logs a NOTICE and
-- skips scheduling — run it again once the secrets are set.
-- ============================================================
DO $$
DECLARE
  v_service_role_key text;
  v_project_url      text;
  v_fn_url           text;
BEGIN
  -- Read secrets from vault (both were set up by email-infra setup).
  SELECT decrypted_secret INTO v_service_role_key
    FROM vault.decrypted_secrets
   WHERE name = 'email_queue_service_role_key'
   LIMIT 1;

  SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets
   WHERE name = 'supabase_project_url'
   LIMIT 1;

  IF v_service_role_key IS NULL OR v_project_url IS NULL THEN
    RAISE NOTICE
      'nudge-action-items cron NOT scheduled: vault secrets email_queue_service_role_key '
      'and/or supabase_project_url are missing. '
      'Add them and re-run: SELECT schedule_nudge_job();';
    RETURN;
  END IF;

  v_fn_url := v_project_url || '/functions/v1/nudge-action-items';

  -- Remove any stale job before re-creating.
  BEGIN
    PERFORM cron.unschedule('nudge-action-items');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM cron.schedule(
    'nudge-action-items',
    '0 8 * * *',          -- daily at 08:00 UTC
    format(
      $q$SELECT net.http_post(
          url    := %L,
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || %L
          ),
          body   := '{}'::jsonb
        )$q$,
      v_fn_url,
      v_service_role_key
    )
  );

  RAISE NOTICE 'nudge-action-items cron job scheduled (daily 08:00 UTC) → %', v_fn_url;
END $$;

-- ── schedule_nudge_job() convenience helper ──────────────────────────────────
-- Admins can re-run this after adding vault secrets to (re-)schedule the job.
CREATE OR REPLACE FUNCTION schedule_nudge_job()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_role_key text;
  v_project_url      text;
  v_fn_url           text;
BEGIN
  SELECT decrypted_secret INTO v_service_role_key
    FROM vault.decrypted_secrets
   WHERE name = 'email_queue_service_role_key'
   LIMIT 1;

  SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets
   WHERE name = 'supabase_project_url'
   LIMIT 1;

  IF v_service_role_key IS NULL THEN
    RETURN 'ERROR: vault secret email_queue_service_role_key is missing';
  END IF;

  IF v_project_url IS NULL THEN
    RETURN 'ERROR: vault secret supabase_project_url is missing. '
           'Set it with: SELECT vault.create_secret(''https://<ref>.supabase.co'', ''supabase_project_url'');';
  END IF;

  v_fn_url := v_project_url || '/functions/v1/nudge-action-items';

  -- Unschedule any existing job first.
  BEGIN
    PERFORM cron.unschedule('nudge-action-items');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM cron.schedule(
    'nudge-action-items',
    '0 8 * * *',
    format(
      $q$SELECT net.http_post(
          url    := %L,
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || %L
          ),
          body   := '{}'::jsonb
        )$q$,
      v_fn_url,
      v_service_role_key
    )
  );

  RETURN 'OK: nudge-action-items scheduled daily at 08:00 UTC → ' || v_fn_url;
END $$;

GRANT EXECUTE ON FUNCTION schedule_nudge_job() TO service_role;
