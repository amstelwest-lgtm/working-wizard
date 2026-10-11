-- nudge-action-items cron: read the project URL and service-role key from the
-- vault at run time instead of formatting the key into cron.job.command.
-- Matches what was applied on prod by hand on 2026-10-11 (cron.alter_job on job 1).
-- Idempotent. Keeps the schedule (0 8 * * *), body '{}' and headers. Nothing is deleted.
--
-- Replaces public.schedule_nudge_job() from 20260805000000_nudge_action_items.sql.
-- That version unschedules the job and cron.schedule's a new command with the
-- service-role key formatted in (%L). This version never writes the key. The
-- stored command selects supabase_project_url and email_queue_service_role_key
-- when the job runs. An existing job is re-pointed with cron.alter_job, so
-- prod job 1 stays job 1 (a no-op there, where the command is already this one).

CREATE OR REPLACE FUNCTION public.nudge_cron_command()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT $cmd$SELECT net.http_post(
  url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_project_url' LIMIT 1) || '/functions/v1/nudge-action-items',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1)
  ),
  body    := '{}'::jsonb
)$cmd$;
$$;

-- Re-scheduling helper no longer embeds the key.
CREATE OR REPLACE FUNCTION public.schedule_nudge_job()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jobid bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key') THEN
    RETURN 'ERROR: vault secret email_queue_service_role_key is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_project_url') THEN
    RETURN 'ERROR: vault secret supabase_project_url is missing';
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'nudge-action-items' LIMIT 1;
  IF v_jobid IS NULL THEN
    PERFORM cron.schedule('nudge-action-items', '0 8 * * *', public.nudge_cron_command());
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, command := public.nudge_cron_command());
  END IF;
  RETURN 'OK: nudge-action-items reads URL and key from the vault at run time';
END $$;

REVOKE ALL ON FUNCTION public.schedule_nudge_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_nudge_job() TO service_role;

-- Re-point an existing job (no-op on prod, where it is already re-pointed).
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'nudge-action-items' LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_jobid, command := public.nudge_cron_command());
  END IF;
END $$;
