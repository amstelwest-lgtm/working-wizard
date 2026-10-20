-- Catch up Data API (PostgREST) privileges for public relations that already
-- exist in production.
--
-- From 30 Oct 2026, a table created in schema public no longer receives grants
-- for anon, authenticated, or service_role. supabase db reset and preview
-- branches replay every migration under that rule, so history that relied on
-- the old automatic grant would come back with no Data API access.
--
-- This file grants exactly the privileges project jxclnsbsqpixxqlbcapl had on
-- 2026-10-20 (Postgres 17.6), read from pg_class ACLs / information_schema
-- role_table_grants for anon, authenticated, and service_role. It does not
-- grant anon on any relation where production's ACL has no anon entry.
-- Row level security is unchanged.
--
-- Idempotent: GRANT of a privilege the role already holds is a no-op, and a
-- relation that is not in this database is skipped. That covers a fresh
-- replay (qbo_* and milon_bot_bundle are in production but not created by a
-- timestamped migration) and a later apply on production (where every
-- relation already has these privileges).
--
-- Relations created by older migrations and absent from production on
-- 2026-10-20 are intentionally omitted: employee_sop_items, employee_sop_log,
-- playbooks, financial_submissions, expense_extractions, income_extractions.
--
-- anon holds privileges on these relations and no others:
--   tables and views (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
--   TRIGGER, MAINTAIN):
--     access_approval_tokens
--     accountant_requests
--     action_emails
--     action_items
--     action_items_v
--     action_milestones
--     action_plans
--     action_tokens
--     action_updates
--     advisory_cycles
--     advisory_deliveries
--     advisory_events
--     advisory_pack_reviews
--     advisory_packs
--     advisory_transition_rules
--     ask_ai_cache
--     ask_ai_log
--     audit_log
--     bot_tool_calls
--     budget_month_actuals
--     client_artifacts
--     client_brain_questions
--     client_deliverable_states
--     client_employees
--     client_financial_snapshots
--     client_memberships
--     client_note_replies
--     client_notes
--     client_practice_access
--     client_review_signoff_history
--     client_review_signoffs
--     client_score_history
--     clients
--     context_facts
--     data_requests
--     deliverable_drafts
--     email_send_log
--     email_send_state
--     email_unsubscribe_tokens
--     employee_tasks
--     extraction_log
--     firm_listings
--     firm_memberships
--     firm_staff_invites
--     firms
--     impersonation_audit
--     industry_benchmarks
--     intervention_ai_sessions
--     intervention_custom_steps
--     intervention_signoffs
--     invite_tokens
--     lighthouse_activities
--     lighthouse_assets
--     lighthouse_cadence_steps
--     lighthouse_campaigns
--     lighthouse_contacts
--     lighthouse_firms
--     lighthouse_inbound
--     lighthouse_product_usage
--     lighthouse_sequences
--     lighthouse_touches
--     milon_bot_bundle
--     milon_bot_runs
--     milon_it_members
--     milon_ops_leads
--     milon_ops_payments
--     milon_ops_settings
--     profiles
--     proposed_next_steps
--     qbo_connections
--     qbo_oauth_states
--     qbo_sync_data
--     recommendation_outcomes
--     sage_connections
--     sage_sync_data
--     suppressed_emails
--     user_roles
--     workflow_email_log
--     xero_connections
--     xero_oauth_states
--     xero_sync_data
--   sequences (USAGE, SELECT, UPDATE):
--     advisory_events_id_seq
--     advisory_pack_reviews_id_seq
--     extraction_log_id_seq
--     workflow_email_log_id_seq

DO $data_api_grants$
DECLARE
  rec record;
  applied integer := 0;
  skipped text[] := ARRAY[]::text[];
  target text;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
  ('table', 'access_approval_tokens', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'accountant_requests', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'action_emails', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'action_items', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'action_milestones', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'action_plans', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'action_tokens', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'action_updates', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'advisory_cycles', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'advisory_deliveries', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'advisory_events', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'advisory_pack_reviews', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'advisory_packs', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'advisory_transition_rules', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'ask_ai_cache', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'ask_ai_log', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'audit_log', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'bot_tool_calls', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'budget_month_actuals', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_artifacts', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_brain_questions', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_deliverable_states', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_employees', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_financial_snapshots', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_memberships', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_note_replies', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_notes', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_practice_access', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_review_signoff_history', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_review_signoffs', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'client_score_history', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'clients', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'context_facts', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'data_requests', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'deliverable_drafts', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'email_send_log', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'email_send_state', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'email_unsubscribe_tokens', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'employee_tasks', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'extraction_log', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'firm_listings', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'firm_memberships', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'firm_staff_invites', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'firms', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'impersonation_audit', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'industry_benchmarks', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'intervention_ai_sessions', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'intervention_custom_steps', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'intervention_signoffs', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'invite_tokens', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'lighthouse_activities', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'lighthouse_assets', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'lighthouse_cadence_steps', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'lighthouse_campaigns', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'lighthouse_contacts', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'lighthouse_firms', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'lighthouse_inbound', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'lighthouse_product_usage', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'lighthouse_sequences', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'lighthouse_touches', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'milon_bot_bundle', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'milon_bot_runs', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'milon_it_members', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'milon_ops_leads', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'milon_ops_payments', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'milon_ops_settings', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'profiles', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'proposed_next_steps', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'qbo_connections', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'qbo_oauth_states', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'qbo_sync_data', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'recommendation_outcomes', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'sage_connections', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'sage_sync_data', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'suppressed_emails', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'user_roles', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'workflow_email_log', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'xero_connections', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'xero_oauth_states', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'xero_sync_data', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('view', 'action_items_v', 'anon, authenticated, service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'agent_findings', 'authenticated', 'SELECT'),
  ('table', 'agent_findings', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'agent_messages', 'authenticated', 'SELECT'),
  ('table', 'agent_messages', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'agent_runs', 'authenticated', 'SELECT'),
  ('table', 'agent_runs', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'document_extractions', 'authenticated', 'SELECT'),
  ('table', 'document_extractions', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'ledger_post_proposals', 'authenticated', 'SELECT'),
  ('table', 'ledger_post_proposals', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'ledger_posting_config', 'authenticated', 'SELECT'),
  ('table', 'ledger_posting_config', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'owner_subscriptions', 'authenticated', 'SELECT'),
  ('table', 'owner_subscriptions', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'supplier_trust', 'authenticated', 'SELECT'),
  ('table', 'supplier_trust', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'source_documents', 'authenticated', 'SELECT, INSERT'),
  ('table', 'source_documents', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'agent_leases', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'agent_memory', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'agent_settings', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'precard_usage_turns', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'stripe_invoice_payments', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'trial_call_requests', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'trial_lead_alerts', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'trial_leads', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'trial_sessions', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('table', 'trial_usage', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('view', 'sa_revenue_zar_rolling_12m', 'service_role', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  ('sequence', 'advisory_events_id_seq', 'anon, authenticated, service_role', 'USAGE, SELECT, UPDATE'),
  ('sequence', 'advisory_pack_reviews_id_seq', 'anon, authenticated, service_role', 'USAGE, SELECT, UPDATE'),
  ('sequence', 'extraction_log_id_seq', 'anon, authenticated, service_role', 'USAGE, SELECT, UPDATE'),
  ('sequence', 'workflow_email_log_id_seq', 'anon, authenticated, service_role', 'USAGE, SELECT, UPDATE')
    ) AS g(kind, relname, roles, privs)
  LOOP
    target := format('public.%I', rec.relname);
    IF to_regclass(target) IS NULL THEN
      IF NOT (rec.relname = ANY (skipped)) THEN
        skipped := skipped || rec.relname;
      END IF;
      CONTINUE;
    END IF;
    IF rec.kind = 'sequence' THEN
      EXECUTE format('GRANT %s ON SEQUENCE %s TO %s', rec.privs, target, rec.roles);
    ELSE
      EXECUTE format('GRANT %s ON TABLE %s TO %s', rec.privs, target, rec.roles);
    END IF;
    applied := applied + 1;
  END LOOP;

  RAISE NOTICE 'data api grant catch-up: % grant(s); skipped missing: %',
    applied,
    CASE
      WHEN cardinality(skipped) = 0 THEN '(none)'
      ELSE array_to_string(skipped, ', ')
    END;
END
$data_api_grants$;
