-- ============================================================
-- MILŌN — Email queue processor pg_cron job
--
-- Schedules a pg_cron job that POSTs to the TanStack app's
-- /lovable/email/queue/process endpoint every 5 minutes.
-- This guarantees that emails sitting in the transactional_emails
-- queue are retried even if the fire-and-forget kick from the
-- send route failed (network blip, server restart, etc.).
--
-- Prerequisites (must be in vault before running this migration):
--   1. 'email_queue_service_role_key' — the Supabase service-role key.
--      Added by the email-infra setup or nudge migration.
--      If missing: SELECT vault.create_secret('<key>', 'email_queue_service_role_key');
--
--   2. 'app_base_url' — the deployed app's root URL (no trailing slash).
--      Example: https://your-app.replit.app  or  https://app.milon.co.za
--      Add it with: SELECT vault.create_secret('https://...', 'app_base_url');
--
-- If either secret is absent the DO block logs a NOTICE and skips
-- scheduling. Run SELECT schedule_email_queue_job(); once the secrets
-- are in place.
-- ============================================================

-- ── schedule_email_queue_job() ───────────────────────────────────────────────
-- Convenience helper: admins can call this after adding vault secrets to
-- (re-)schedule the cron job without re-running the full migration.
CREATE OR REPLACE FUNCTION schedule_email_queue_job()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_role_key text;
  v_app_base_url     text;
  v_endpoint_url     text;
BEGIN
  SELECT decrypted_secret INTO v_service_role_key
    FROM vault.decrypted_secrets
   WHERE name = 'email_queue_service_role_key'
   LIMIT 1;

  SELECT decrypted_secret INTO v_app_base_url
    FROM vault.decrypted_secrets
   WHERE name = 'app_base_url'
   LIMIT 1;

  IF v_service_role_key IS NULL THEN
    RETURN 'ERROR: vault secret email_queue_service_role_key is missing. '
           'Add it with: SELECT vault.create_secret(''<service_role_key>'', ''email_queue_service_role_key'');';
  END IF;

  IF v_app_base_url IS NULL THEN
    RETURN 'ERROR: vault secret app_base_url is missing. '
           'Add it with: SELECT vault.create_secret(''https://your-app.replit.app'', ''app_base_url'');';
  END IF;

  v_endpoint_url := rtrim(v_app_base_url, '/') || '/lovable/email/queue/process';

  -- Unschedule any existing job first (idempotent re-run).
  BEGIN
    PERFORM cron.unschedule('process-email-queue');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM cron.schedule(
    'process-email-queue',
    '*/5 * * * *',        -- every 5 minutes
    format(
      $$SELECT net.http_post(
          url     := %L,
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || %L
          ),
          body    := '{}'::jsonb
        )$$,
      v_endpoint_url,
      v_service_role_key
    )
  );

  RETURN 'OK: process-email-queue scheduled every 5 minutes → ' || v_endpoint_url;
END $$;

GRANT EXECUTE ON FUNCTION schedule_email_queue_job() TO service_role;

-- ── Auto-schedule on migration run ──────────────────────────────────────────
-- Reads vault secrets and schedules the job immediately if they exist.
-- Safe to run more than once (unschedules before re-creating).
DO $$
DECLARE
  v_service_role_key text;
  v_app_base_url     text;
  v_endpoint_url     text;
BEGIN
  SELECT decrypted_secret INTO v_service_role_key
    FROM vault.decrypted_secrets
   WHERE name = 'email_queue_service_role_key'
   LIMIT 1;

  SELECT decrypted_secret INTO v_app_base_url
    FROM vault.decrypted_secrets
   WHERE name = 'app_base_url'
   LIMIT 1;

  IF v_service_role_key IS NULL OR v_app_base_url IS NULL THEN
    RAISE NOTICE
      'process-email-queue cron NOT scheduled: vault secrets '
      '"email_queue_service_role_key" and/or "app_base_url" are missing. '
      'Add them, then run: SELECT schedule_email_queue_job();';
    RETURN;
  END IF;

  v_endpoint_url := rtrim(v_app_base_url, '/') || '/lovable/email/queue/process';

  BEGIN
    PERFORM cron.unschedule('process-email-queue');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM cron.schedule(
    'process-email-queue',
    '*/5 * * * *',
    format(
      $$SELECT net.http_post(
          url     := %L,
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || %L
          ),
          body    := '{}'::jsonb
        )$$,
      v_endpoint_url,
      v_service_role_key
    )
  );

  RAISE NOTICE 'process-email-queue cron job scheduled (every 5 min) → %', v_endpoint_url;
END $$;
