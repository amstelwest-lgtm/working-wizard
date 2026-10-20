-- Lock EXECUTE on the public SECURITY DEFINER functions advisor 0028 flags
-- as callable by anon.
--
-- Postgres grants EXECUTE to PUBLIC on new functions, and this project's
-- default privileges also grant it to anon, authenticated, and service_role.
-- REVOKE FROM PUBLIC alone leaves the explicit anon grant in place.
--
-- anon keeps EXECUTE only on the two acknowledgement RPCs the logged-out
-- /ack/:token page calls with the browser client. Signup, invite minting,
-- and unsubscribe do not: signup calls ensure_* only after a session exists,
-- invite preview/redeem goes through service_role, and unsubscribe reads
-- tokens with the service role.
--
-- authenticated keeps EXECUTE on RPCs, RLS helpers, and trigger functions
-- the signed-in app fires. service_role keeps EXECUTE on every function here
-- so edge functions and server routes keep working. postgres (function owner,
-- and the role pg_cron uses) is unaffected.
--
-- Seven functions are service_role only. Their original migrations already
-- said so; default privileges had granted anon and authenticated back.
-- handle_new_user() is the auth.users trigger, so supabase_auth_admin is
-- granted explicitly once PUBLIC no longer covers it.
--
-- Missing functions are skipped so a database that has not applied every
-- historical migration can still run this file. Safe to re-run.

DO $lock$
DECLARE
  rec record;
  fn regprocedure;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('public.acknowledge_advisory_delivery(text)', 'anon'),
      ('public.action_item_sync_recommendation_link()', 'authenticated'),
      ('public.action_item_tenant_check()', 'authenticated'),
      ('public.actor_is_partner(uuid,uuid)', 'authenticated'),
      ('public.advisory_actor_kind(uuid)', 'authenticated'),
      ('public.advisory_deliveries_guard_update()', 'authenticated'),
      ('public.advisory_trg_action_items()', 'authenticated'),
      ('public.advisory_trg_brain_questions()', 'authenticated'),
      ('public.advisory_trg_clients()', 'authenticated'),
      ('public.advisory_trg_data_requests()', 'authenticated'),
      ('public.advisory_trg_next_steps()', 'authenticated'),
      ('public.advisory_trg_outcomes()', 'authenticated'),
      ('public.advisory_trg_packs()', 'authenticated'),
      ('public.advisory_trg_signoffs()', 'authenticated'),
      ('public.advisory_trg_snapshots()', 'authenticated'),
      ('public.agent_enqueue_on_statement_upload()', 'authenticated'),
      ('public.agent_messages_route()', 'authenticated'),
      ('public.can_sign_off_deliverable(uuid,uuid)', 'authenticated'),
      ('public.client_notes_guard_update()', 'authenticated'),
      ('public.client_review_signoffs_history_mirror()', 'authenticated'),
      ('public.clients_guard_owner_only_columns()', 'authenticated'),
      ('public.create_firm_client(text,uuid,text,jsonb)', 'authenticated'),
      ('public.data_request_defaults()', 'authenticated'),
      ('public.data_requests_fulfil(uuid,text[],jsonb,uuid)', 'authenticated'),
      ('public.data_requests_sync(uuid,jsonb)', 'authenticated'),
      ('public.data_requests_trg_client()', 'authenticated'),
      ('public.data_requests_trg_snapshot()', 'authenticated'),
      ('public.delete_email(text,bigint)', 'service'),
      ('public.delete_own_account()', 'authenticated'),
      ('public.effective_practice_classification(uuid,uuid)', 'authenticated'),
      ('public.enforce_client_review_signoff_identity()', 'authenticated'),
      ('public.enqueue_email(text,jsonb)', 'service'),
      ('public.ensure_client_practice_employee(uuid,uuid,text)', 'service'),
      ('public.ensure_own_client(text,jsonb)', 'authenticated'),
      ('public.ensure_practice_firm(text,jsonb)', 'authenticated'),
      ('public.find_nudge_candidates(timestamp with time zone)', 'service'),
      ('public.firm_has_partner(uuid,uuid)', 'authenticated'),
      ('public.grant_practice_principal_access(uuid,uuid)', 'service'),
      ('public.handle_new_user()', 'authenticated'),
      ('public.has_active_practice_assignment(uuid,uuid)', 'authenticated'),
      ('public.has_client_access(uuid,uuid)', 'authenticated'),
      ('public.has_role(uuid,public.app_role)', 'authenticated'),
      ('public.is_action_plan_writer(uuid,uuid)', 'authenticated'),
      ('public.is_client_writer(uuid,uuid)', 'authenticated'),
      ('public.is_firm_manager(uuid,uuid)', 'authenticated'),
      ('public.is_firm_member(uuid,uuid)', 'authenticated'),
      ('public.is_milon_it_member(uuid)', 'authenticated'),
      ('public.is_practice_principal(uuid,uuid)', 'authenticated'),
      ('public.list_client_practice_team(uuid)', 'authenticated'),
      ('public.list_note_collaborators(uuid)', 'authenticated'),
      ('public.mint_accountant_invite(uuid,text)', 'authenticated'),
      ('public.mint_owner_invite(uuid)', 'authenticated'),
      ('public.move_to_dlq(text,text,bigint,jsonb)', 'service'),
      ('public.preview_advisory_delivery_ack(text)', 'anon'),
      ('public.read_email_batch(text,integer,integer)', 'service'),
      ('public.recommendation_default_cycle()', 'authenticated'),
      ('public.recommendation_outcome_defaults()', 'authenticated'),
      ('public.recommendation_stamp_decision()', 'authenticated'),
      ('public.team_practice_classification(uuid,uuid)', 'authenticated'),
      ('public.trg_clients_firm_connect()', 'authenticated'),
      ('public.trg_clients_firm_connect_audit()', 'authenticated'),
      ('public.trg_clients_grant_principal_access()', 'authenticated'),
      ('public.trg_deliverable_state_caps()', 'authenticated'),
      ('public.trg_firm_membership_grant_principal_access()', 'authenticated'),
      ('public.trg_firm_memberships_partner_guard()', 'authenticated'),
      ('public.trg_practice_access_ceiling()', 'authenticated'),
      ('public.write_audit_log(text,uuid,uuid,uuid,jsonb,uuid)', 'authenticated')
    ) AS v(sig, mode)
  LOOP
    BEGIN
      fn := to_regprocedure(rec.sig);
    EXCEPTION
      WHEN undefined_object THEN
        fn := NULL;
    END;

    IF fn IS NULL THEN
      RAISE NOTICE 'skip missing function %', rec.sig;
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', rec.sig);

    IF rec.mode = 'service' THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', rec.sig);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', rec.sig);
    END IF;

    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', rec.sig);

    IF rec.mode = 'anon' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', rec.sig);
    END IF;

    IF rec.sig = 'public.handle_new_user()'
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin';
    END IF;
  END LOOP;
END
$lock$;

-- Stop new public functions from inheriting EXECUTE for anon or PUBLIC.
-- authenticated and service_role defaults stay, so a later migration that
-- forgets a GRANT does not lock the signed-in app out. The CI check still
-- requires an explicit REVOKE on new SECURITY DEFINER functions.
DO $defaults$
BEGIN
  -- The built-in EXECUTE grant to PUBLIC is global, not schema-scoped.
  -- Schema-scoped REVOKE only removes the extra anon grant Supabase stores
  -- on public. Both are required.
  EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    BEGIN
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon';
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'skip default privileges for supabase_admin';
    END;
  END IF;
END
$defaults$;

-- Lint 0011. Bodies are schema-qualified or use only built-ins, so an empty
-- search_path cannot change name resolution. action_item_health casts to the
-- public enums action_status / action_health, so it is pinned to public
-- (pg_catalog stays implicitly in front). Missing functions are skipped.
DO $paths$
DECLARE
  rec record;
  fn regprocedure;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('analytics.jsonb_is_blank(jsonb)', ''),
      ('public.advisory_jsonb_is_blank(jsonb)', ''),
      ('public.agent_queue_allowed(text)', ''),
      ('public.ask_ai_check_rate_limit(uuid,integer)', ''),
      ('public.delete_email(text,bigint)', ''),
      ('public.enqueue_email(text,jsonb)', ''),
      ('public.generate_client_code()', ''),
      ('public.ledger_note_is_sign_off(text)', ''),
      ('public.market_json_ok(jsonb)', ''),
      ('public.move_to_dlq(text,text,bigint,jsonb)', ''),
      ('public.normalise_document_number(text)', ''),
      ('public.normalise_supplier_key(text)', ''),
      ('public.nudge_cron_command()', ''),
      ('public.practice_can(text,text)', ''),
      ('public.practice_class_at_most(text,text)', ''),
      ('public.practice_class_rank(text)', ''),
      ('public.read_email_batch(text,integer,integer)', ''),
      ('public.review_signoff_initials(text)', ''),
      ('public.touch_action_item()', ''),
      ('public.touch_client_note_updated_at()', ''),
      ('public.touch_row_updated_at()', ''),
      ('public.action_item_health(public.action_status,date,integer,timestamp with time zone)', 'public')
    ) AS v(sig, path)
  LOOP
    BEGIN
      fn := to_regprocedure(rec.sig);
    EXCEPTION
      WHEN undefined_object OR invalid_schema_name THEN
        fn := NULL;
    END;

    IF fn IS NULL THEN
      RAISE NOTICE 'skip search_path for missing function %', rec.sig;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER FUNCTION %s SET search_path = %L', rec.sig, rec.path);
  END LOOP;
END
$paths$;
