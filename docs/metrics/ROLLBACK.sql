-- Rollback for 20260902120000_analytics_events_spine.sql
-- Does not delete product data. Drops the analytics schema and flag columns.

DROP TRIGGER IF EXISTS trg_analytics_firms ON public.firms;
DROP TRIGGER IF EXISTS trg_analytics_clients ON public.clients;
DROP TRIGGER IF EXISTS trg_analytics_snapshots ON public.client_financial_snapshots;
DROP TRIGGER IF EXISTS trg_analytics_user_roles ON public.user_roles;
DROP TRIGGER IF EXISTS trg_analytics_action_items ON public.action_items;
DROP TRIGGER IF EXISTS trg_analytics_action_emails ON public.action_emails;
DROP TRIGGER IF EXISTS trg_analytics_advisory_deliveries ON public.advisory_deliveries;
DROP TRIGGER IF EXISTS trg_analytics_qbo ON public.qbo_connections;
DROP TRIGGER IF EXISTS trg_analytics_signoffs ON public.client_review_signoffs;
DROP TRIGGER IF EXISTS trg_analytics_invite_tokens ON public.invite_tokens;

DO $$ BEGIN
  IF to_regclass('public.firm_staff_invites') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_analytics_staff_invites ON public.firm_staff_invites;
  END IF;
  IF to_regclass('public.client_practice_access') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_analytics_practice_access ON public.client_practice_access;
  END IF;
  IF to_regclass('public.impersonation_audit') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_analytics_impersonation ON public.impersonation_audit;
  END IF;
  IF to_regclass('public.ask_ai_log') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_analytics_ask_ai ON public.ask_ai_log;
  END IF;
  IF to_regclass('public.milon_ops_payments') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_analytics_payments ON public.milon_ops_payments;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.analytics_update_queue_item(bigint, text, text);
DROP FUNCTION IF EXISTS public.analytics_log_signal(uuid, text, text, text, text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.analytics_refresh_derived();
DROP FUNCTION IF EXISTS public.analytics_track(text, jsonb, text, uuid, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.analytics_emit(text, timestamptz, text, uuid, text, uuid, uuid, uuid, text, text, text, boolean, text, jsonb);
DROP FUNCTION IF EXISTS public.preview_advisory_delivery_ack(text);

DROP SCHEMA IF EXISTS analytics CASCADE;

ALTER TABLE public.firms DROP COLUMN IF EXISTS is_internal;
ALTER TABLE public.firms DROP COLUMN IF EXISTS is_founding_practice;
ALTER TABLE public.clients DROP COLUMN IF EXISTS is_demo;

DO $$ BEGIN
  IF to_regclass('public.milon_ops_payments') IS NOT NULL THEN
    ALTER TABLE public.milon_ops_payments DROP COLUMN IF EXISTS firm_id;
  END IF;
END $$;
