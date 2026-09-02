-- ============================================================================
-- MILŌN analytics spine (Phase 1) — SQL 2 of 2
-- Triggers + historical backfill. Run AFTER 20260902120000_analytics_events_spine.sql
-- Rollback: docs/metrics/ROLLBACK.sql
-- ============================================================================

-- ============================================================================
-- Triggers (exception-safe via analytics.record)
-- ============================================================================
CREATE OR REPLACE FUNCTION analytics.trg_firms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM analytics.record(
      'practice.created', NEW.created_at, analytics.actor_kind_for(NEW.owner_user_id, NULL),
      NEW.owner_user_id, NULL, NEW.id, NULL, NEW.id, 'firm', 'db_trigger',
      NULL, false, 'practice.created:' || NEW.id, '{}'::jsonb
    );
  ELSIF TG_OP = 'UPDATE' AND coalesce(OLD.logo_url, '') = '' AND coalesce(NEW.logo_url, '') <> '' THEN
    PERFORM analytics.record(
      'practice.brand.configured', now(), analytics.actor_kind_for(auth.uid(), NULL),
      auth.uid(), NULL, NEW.id, NULL, NEW.id, 'firm', 'db_trigger',
      NULL, false, 'practice.brand.configured:' || NEW.id,
      jsonb_build_object('has_logo', true)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_firms ON public.firms;
CREATE TRIGGER trg_analytics_firms
  AFTER INSERT OR UPDATE ON public.firms
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_firms();

CREATE OR REPLACE FUNCTION analytics.trg_clients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_actor uuid := coalesce(auth.uid(), NEW.owner_user_id);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM analytics.record(
      'entity.created', NEW.created_at, analytics.actor_kind_for(v_actor, NULL),
      v_actor, NULL, NEW.firm_id, NEW.id, NEW.id, 'client', 'db_trigger',
      NULL, false, 'entity.created:' || NEW.id,
      jsonb_build_object(
        'via', CASE WHEN NEW.firm_id IS NOT NULL THEN 'firm_create' ELSE 'owner_rpc' END,
        'has_firm', NEW.firm_id IS NOT NULL
      )
    );
    IF NOT analytics.jsonb_is_blank(NEW.financials) THEN
      PERFORM analytics.record(
        'upload.succeeded', NEW.created_at, analytics.actor_kind_for(v_actor, NULL),
        v_actor, NULL, NEW.firm_id, NEW.id, NEW.id, 'client', 'db_trigger',
        NULL, false, 'upload.succeeded:' || NEW.id,
        jsonb_build_object('kind', 'unknown')
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF analytics.jsonb_is_blank(OLD.financials) AND NOT analytics.jsonb_is_blank(NEW.financials) THEN
      PERFORM analytics.record(
        'upload.succeeded', now(), analytics.actor_kind_for(v_actor, NULL),
        v_actor, NULL, NEW.firm_id, NEW.id, NEW.id, 'client', 'db_trigger',
        NULL, false, 'upload.succeeded:' || NEW.id,
        jsonb_build_object('kind', 'unknown')
      );
    END IF;
    IF analytics.jsonb_is_blank(OLD.operating_profile) AND NOT analytics.jsonb_is_blank(NEW.operating_profile) THEN
      PERFORM analytics.record(
        'profile.completed', now(), analytics.actor_kind_for(v_actor, NULL),
        v_actor, NULL, NEW.firm_id, NEW.id, NEW.id, 'client', 'db_trigger',
        NULL, false, 'profile.completed:' || NEW.id, '{}'::jsonb
      );
    END IF;
    IF OLD.last_forecast_at IS NULL AND NEW.last_forecast_at IS NOT NULL THEN
      PERFORM analytics.record(
        'forecast.saved', NEW.last_forecast_at, analytics.actor_kind_for(v_actor, NULL),
        v_actor, NULL, NEW.firm_id, NEW.id, NEW.id, 'client', 'db_trigger',
        NULL, false, 'forecast.saved:' || NEW.id, '{}'::jsonb
      );
    END IF;
    IF OLD.budget_updated_at IS NULL AND NEW.budget_updated_at IS NOT NULL THEN
      PERFORM analytics.record(
        'budget.saved', NEW.budget_updated_at, analytics.actor_kind_for(v_actor, NULL),
        v_actor, NULL, NEW.firm_id, NEW.id, NEW.id, 'client', 'db_trigger',
        NULL, false, 'budget.saved:' || NEW.id, '{}'::jsonb
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_clients ON public.clients;
CREATE TRIGGER trg_analytics_clients
  AFTER INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_clients();

CREATE OR REPLACE FUNCTION analytics.trg_snapshots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_firm uuid;
  v_actor uuid := coalesce(auth.uid(), NEW.created_by);
BEGIN
  SELECT c.firm_id INTO v_firm FROM public.clients c WHERE c.id = NEW.client_id;
  PERFORM analytics.record(
    'snapshot.created', NEW.created_at, analytics.actor_kind_for(v_actor, NULL),
    v_actor, NULL, v_firm, NEW.client_id, NEW.id, 'snapshot', 'db_trigger',
    NULL, false, 'snapshot.created:' || NEW.id,
    jsonb_build_object('kind', coalesce(NEW.source, 'unknown'))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_snapshots ON public.client_financial_snapshots;
CREATE TRIGGER trg_analytics_snapshots
  AFTER INSERT ON public.client_financial_snapshots
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_snapshots();

CREATE OR REPLACE FUNCTION analytics.trg_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_type text;
BEGIN
  v_type := CASE
    WHEN NEW.role::text IN ('firm_admin', 'accountant') THEN 'accountant'
    WHEN NEW.role::text = 'client_member' THEN 'invited_member'
    ELSE 'owner'
  END;
  PERFORM analytics.record(
    'signup.completed', NEW.created_at, analytics.actor_kind_for(NEW.user_id, NULL),
    NEW.user_id, NULL, NULL, NULL, NEW.user_id, 'user', 'db_trigger',
    NULL, false, 'signup.completed:' || NEW.user_id::text,
    jsonb_build_object('signup_type', v_type)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_user_roles ON public.user_roles;
CREATE TRIGGER trg_analytics_user_roles
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_user_roles();

CREATE OR REPLACE FUNCTION analytics.trg_action_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_firm uuid;
  v_actor uuid := auth.uid();
  v_kind analytics.actor_kind;
  v_ratio text;
BEGIN
  SELECT c.firm_id INTO v_firm FROM public.clients c WHERE c.id = NEW.client_id;
  v_kind := CASE
    WHEN v_actor IS NULL THEN 'system'::analytics.actor_kind
    ELSE analytics.actor_kind_for(v_actor, NULL)
  END;
  v_ratio := NEW.source_move_key;

  IF TG_OP = 'INSERT' THEN
    PERFORM analytics.record(
      'task.created', NEW.created_at, v_kind, v_actor, NULL, v_firm, NEW.client_id,
      NEW.id, 'task', 'db_trigger', NULL, false, 'task.created:' || NEW.id,
      jsonb_build_object('source', NEW.source::text, 'ratio_code', v_ratio)
    );
    IF NEW.owner_id IS NOT NULL THEN
      PERFORM analytics.record(
        'task.assigned', NEW.created_at, v_kind, v_actor, NULL, v_firm, NEW.client_id,
        NEW.id, 'task', 'db_trigger', NULL, false, 'task.assigned:' || NEW.id,
        jsonb_build_object('has_email', true)
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.owner_id IS DISTINCT FROM NEW.owner_id AND NEW.owner_id IS NOT NULL THEN
      PERFORM analytics.record(
        'task.assigned', now(), v_kind, v_actor, NULL, v_firm, NEW.client_id,
        NEW.id, 'task', 'db_trigger', NULL, false, 'task.assigned:' || NEW.id,
        jsonb_build_object('has_email', true)
      );
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM analytics.record(
        'task.status_changed', now(),
        CASE WHEN v_actor IS NULL THEN 'sme_employee'::analytics.actor_kind ELSE v_kind END,
        v_actor, NULL, v_firm, NEW.client_id, NEW.id, 'task', 'db_trigger',
        NULL, false,
        'task.status:' || NEW.id || ':' || NEW.status::text || ':' || (extract(epoch from now())::bigint)::text,
        jsonb_build_object('from', OLD.status::text, 'to', NEW.status::text)
      );
      IF NEW.status = 'done' THEN
        PERFORM analytics.record(
          'task.completed', coalesce(NEW.completed_at, now()),
          CASE WHEN v_actor IS NULL THEN 'sme_employee'::analytics.actor_kind ELSE v_kind END,
          v_actor, NULL, v_firm, NEW.client_id, NEW.id, 'task', 'db_trigger',
          NULL, false, 'task.completed:' || NEW.id, '{}'::jsonb
        );
      ELSIF NEW.status = 'blocked' THEN
        PERFORM analytics.record(
          'task.blocked', now(),
          CASE WHEN v_actor IS NULL THEN 'sme_employee'::analytics.actor_kind ELSE v_kind END,
          v_actor, NULL, v_firm, NEW.client_id, NEW.id, 'task', 'db_trigger',
          NULL, false, 'task.blocked:' || NEW.id, '{}'::jsonb
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_action_items ON public.action_items;
CREATE TRIGGER trg_analytics_action_items
  AFTER INSERT OR UPDATE ON public.action_items
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_action_items();

CREATE OR REPLACE FUNCTION analytics.trg_action_emails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_firm uuid;
BEGIN
  SELECT c.firm_id INTO v_firm FROM public.clients c WHERE c.id = NEW.client_id;
  PERFORM analytics.record(
    'task.email.dispatched', coalesce(NEW.sent_at, NEW.created_at),
    analytics.actor_kind_for(auth.uid(), NULL), auth.uid(), NULL,
    v_firm, NEW.client_id, NEW.action_item_id, 'task', 'db_trigger',
    NULL, false, 'task.email.dispatched:' || NEW.id,
    jsonb_build_object('email_type', NEW.email_type)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_action_emails ON public.action_emails;
CREATE TRIGGER trg_analytics_action_emails
  AFTER INSERT ON public.action_emails
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_action_emails();

CREATE OR REPLACE FUNCTION analytics.trg_advisory_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_key text;
  v_actor uuid := coalesce(NEW.created_by, auth.uid());
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.report_key = 'zip_all' THEN
      v_key := 'report.zip_all';
    ELSIF NEW.channel = 'pdf_download' THEN
      v_key := 'report.downloaded';
    ELSE
      v_key := 'report.sent';
    END IF;
    PERFORM analytics.record(
      v_key, NEW.created_at, analytics.actor_kind_for(v_actor, 'reports'),
      v_actor, NULL, NEW.firm_id, NEW.client_id, NEW.id, 'delivery', 'db_trigger',
      NULL, false, v_key || ':' || NEW.id,
      jsonb_build_object(
        'report_key', NEW.report_key,
        'channel', NEW.channel,
        'kind', NEW.kind
      )
    );
  ELSIF TG_OP = 'UPDATE'
    AND OLD.acknowledged_at IS NULL
    AND NEW.acknowledged_at IS NOT NULL THEN
    -- Only trustworthy after /ack became POST-confirm. Still not a GET write.
    PERFORM analytics.record(
      'report.acknowledged', NEW.acknowledged_at, 'anonymous'::analytics.actor_kind,
      NEW.acknowledged_by, NULL, NEW.firm_id, NEW.client_id, NEW.id, 'delivery',
      'db_trigger', NULL, false, 'report.acknowledged:' || NEW.id, '{}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_advisory_deliveries ON public.advisory_deliveries;
CREATE TRIGGER trg_analytics_advisory_deliveries
  AFTER INSERT OR UPDATE ON public.advisory_deliveries
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_advisory_deliveries();

CREATE OR REPLACE FUNCTION analytics.trg_qbo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_firm uuid;
BEGIN
  SELECT c.firm_id INTO v_firm FROM public.clients c WHERE c.id = NEW.client_id;
  PERFORM analytics.record(
    'qbo.connected', coalesce(NEW.connected_at, now()),
    analytics.actor_kind_for(auth.uid(), NULL), auth.uid(), NULL,
    v_firm, NEW.client_id, NEW.id, 'qbo', 'db_trigger',
    NULL, false, 'qbo.connected:' || NEW.id, '{}'::jsonb
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_qbo ON public.qbo_connections;
CREATE TRIGGER trg_analytics_qbo
  AFTER INSERT ON public.qbo_connections
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_qbo();

CREATE OR REPLACE FUNCTION analytics.trg_signoffs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_firm uuid;
BEGIN
  SELECT c.firm_id INTO v_firm FROM public.clients c WHERE c.id = NEW.client_id;
  PERFORM analytics.record(
    'signoff.recorded', NEW.signed_off_at, analytics.actor_kind_for(NEW.signed_off_by_id, NULL),
    NEW.signed_off_by_id, NULL, v_firm, NEW.client_id, NEW.id, 'signoff', 'db_trigger',
    NULL, false, 'signoff.recorded:' || NEW.id,
    jsonb_build_object('scope', NEW.scope)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_signoffs ON public.client_review_signoffs;
CREATE TRIGGER trg_analytics_signoffs
  AFTER INSERT ON public.client_review_signoffs
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_signoffs();

CREATE OR REPLACE FUNCTION analytics.trg_invite_tokens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_firm uuid;
BEGIN
  SELECT c.firm_id INTO v_firm FROM public.clients c WHERE c.id = NEW.client_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM analytics.record(
      'owner.invite.minted', NEW.created_at, analytics.actor_kind_for(NEW.created_by, NULL),
      NEW.created_by, NULL, v_firm, NEW.client_id, NEW.id, 'invite', 'db_trigger',
      NULL, false, 'owner.invite.minted:' || NEW.id, '{}'::jsonb
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.redeemed_at IS NULL AND NEW.redeemed_at IS NOT NULL THEN
    PERFORM analytics.record(
      'owner.invite.redeemed', NEW.redeemed_at,
      analytics.actor_kind_for(NEW.redeemed_by, NULL), NEW.redeemed_by, NULL,
      v_firm, NEW.client_id, NEW.id, 'invite', 'db_trigger',
      NULL, false, 'owner.invite.redeemed:' || NEW.id, '{}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_invite_tokens ON public.invite_tokens;
CREATE TRIGGER trg_analytics_invite_tokens
  AFTER INSERT OR UPDATE ON public.invite_tokens
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_invite_tokens();

CREATE OR REPLACE FUNCTION analytics.trg_staff_invites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM analytics.record(
      'seat.invited', NEW.created_at, analytics.actor_kind_for(NEW.invited_by, NULL),
      NEW.invited_by, NULL, NEW.firm_id, NULL, NEW.id, 'seat', 'db_trigger',
      NULL, false, 'seat.invited:' || NEW.id,
      jsonb_build_object('membership_role', NEW.membership_role, 'classification', NEW.classification)
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL THEN
    PERFORM analytics.record(
      'seat.accepted', NEW.accepted_at, analytics.actor_kind_for(NEW.accepted_by, NULL),
      NEW.accepted_by, NULL, NEW.firm_id, NULL, NEW.id, 'seat', 'db_trigger',
      NULL, false, 'seat.accepted:' || NEW.id,
      jsonb_build_object('membership_role', NEW.membership_role)
    );
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF to_regclass('public.firm_staff_invites') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_analytics_staff_invites ON public.firm_staff_invites;
    CREATE TRIGGER trg_analytics_staff_invites
      AFTER INSERT OR UPDATE ON public.firm_staff_invites
      FOR EACH ROW EXECUTE FUNCTION analytics.trg_staff_invites();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION analytics.trg_practice_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM analytics.record(
      'practice.access.granted', coalesce(NEW.owner_approved_at, NEW.updated_at, now()),
      analytics.actor_kind_for(NEW.owner_approved_by, NULL), NEW.owner_approved_by, NULL,
      NEW.firm_id, NEW.client_id, NEW.id, 'access', 'db_trigger',
      NULL, false, 'practice.access.granted:' || NEW.id,
      jsonb_build_object('classification', NEW.classification)
    );
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF to_regclass('public.client_practice_access') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_analytics_practice_access ON public.client_practice_access;
    CREATE TRIGGER trg_analytics_practice_access
      AFTER INSERT OR UPDATE ON public.client_practice_access
      FOR EACH ROW EXECUTE FUNCTION analytics.trg_practice_access();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION analytics.trg_impersonation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
BEGIN
  PERFORM analytics.record(
    'impersonation.started', NEW.started_at, 'accountant'::analytics.actor_kind,
    NEW.firm_user_id, NULL, NEW.firm_id, NEW.client_id, NEW.id, 'impersonation',
    'db_trigger', NULL, false, 'impersonation.started:' || NEW.id,
    jsonb_build_object('impersonation', true)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_impersonation ON public.impersonation_audit;
CREATE TRIGGER trg_analytics_impersonation
  AFTER INSERT ON public.impersonation_audit
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_impersonation();

CREATE OR REPLACE FUNCTION analytics.trg_ask_ai()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_firm uuid;
BEGIN
  SELECT c.firm_id INTO v_firm FROM public.clients c WHERE c.id = NEW.client_id;
  PERFORM analytics.record(
    'ask_ai.query.submitted', NEW.created_at, analytics.actor_kind_for(NEW.user_id, NULL),
    NEW.user_id, NULL, v_firm, NEW.client_id, NEW.id, 'ask_ai', 'db_trigger',
    NULL, false, 'ask_ai.query.submitted:' || NEW.id,
    jsonb_build_object('tier', NEW.tier, 'latency_ms', NEW.latency_ms)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_ask_ai ON public.ask_ai_log;
CREATE TRIGGER trg_analytics_ask_ai
  AFTER INSERT ON public.ask_ai_log
  FOR EACH ROW EXECUTE FUNCTION analytics.trg_ask_ai();

CREATE OR REPLACE FUNCTION analytics.trg_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
BEGIN
  PERFORM analytics.record(
    'payment.recorded', NEW.paid_at::timestamptz,
    analytics.actor_kind_for(NEW.created_by, NULL), NEW.created_by, NULL,
    NEW.firm_id, NULL, NEW.id, 'payment', 'db_trigger',
    NULL, false, 'payment.recorded:' || NEW.id,
    jsonb_build_object('status', NEW.status, 'plan_code', NEW.plan_code)
  );
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF to_regclass('public.milon_ops_payments') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_analytics_payments ON public.milon_ops_payments;
    CREATE TRIGGER trg_analytics_payments
      AFTER INSERT ON public.milon_ops_payments
      FOR EACH ROW EXECUTE FUNCTION analytics.trg_payments();
  END IF;
END $$;

-- ============================================================================
-- Historical backfill (idempotent keys). Flags already stamped on firms.
-- ============================================================================
INSERT INTO analytics.events (
  event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
  object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
)
SELECT
  'practice.created', f.created_at, 'practice_admin', f.owner_user_id, f.id, NULL,
  f.id, 'firm', 'db_trigger', f.is_internal, false,
  'practice.created:' || f.id, '{}'::jsonb
FROM public.firms f
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO analytics.events (
  event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
  object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
)
SELECT
  'practice.brand.configured', coalesce(f.brand_updated_at, f.created_at),
  'practice_admin', f.owner_user_id, f.id, NULL, f.id, 'firm', 'db_trigger',
  f.is_internal, false, 'practice.brand.configured:' || f.id,
  jsonb_build_object('has_logo', true)
FROM public.firms f
WHERE coalesce(f.logo_url, '') <> ''
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO analytics.events (
  event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
  object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
)
SELECT
  'entity.created', c.created_at,
  CASE WHEN c.firm_id IS NOT NULL THEN 'accountant' ELSE 'sme_owner' END,
  c.owner_user_id, c.firm_id, c.id, c.id, 'client', 'db_trigger',
  coalesce(f.is_internal, false), c.is_demo,
  'entity.created:' || c.id,
  jsonb_build_object(
    'via', CASE WHEN c.firm_id IS NOT NULL THEN 'firm_create' ELSE 'owner_rpc' END,
    'has_firm', c.firm_id IS NOT NULL
  )
FROM public.clients c
LEFT JOIN public.firms f ON f.id = c.firm_id
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO analytics.events (
  event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
  object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
)
SELECT
  'upload.succeeded', coalesce(c.financials_updated_at, c.created_at),
  CASE WHEN c.firm_id IS NOT NULL THEN 'accountant' ELSE 'sme_owner' END,
  c.owner_user_id, c.firm_id, c.id, c.id, 'client', 'db_trigger',
  coalesce(f.is_internal, false), c.is_demo,
  'upload.succeeded:' || c.id,
  jsonb_build_object('kind', 'unknown')
FROM public.clients c
LEFT JOIN public.firms f ON f.id = c.firm_id
WHERE NOT analytics.jsonb_is_blank(c.financials)
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO analytics.events (
  event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
  object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
)
SELECT
  'signup.completed', ur.created_at, analytics.actor_kind_for(ur.user_id, NULL),
  ur.user_id, NULL, NULL, ur.user_id, 'user', 'db_trigger',
  false, false, 'signup.completed:' || ur.user_id::text,
  jsonb_build_object(
    'signup_type', CASE
      WHEN ur.role::text IN ('firm_admin', 'accountant') THEN 'accountant'
      WHEN ur.role::text = 'client_member' THEN 'invited_member'
      ELSE 'owner'
    END
  )
FROM public.user_roles ur
INNER JOIN (
  SELECT user_id, min(created_at) AS created_at
  FROM public.user_roles
  GROUP BY user_id
) first ON first.user_id = ur.user_id AND first.created_at = ur.created_at
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO analytics.events (
  event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
  object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
)
SELECT
  'task.created', i.created_at, 'sme_owner', NULL, c.firm_id, i.client_id,
  i.id, 'task', 'db_trigger', coalesce(f.is_internal, false), c.is_demo,
  'task.created:' || i.id,
  jsonb_build_object('source', i.source::text, 'ratio_code', i.source_move_key)
FROM public.action_items i
JOIN public.clients c ON c.id = i.client_id
LEFT JOIN public.firms f ON f.id = c.firm_id
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO analytics.events (
  event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
  object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
)
SELECT
  'task.assigned', i.created_at, 'sme_owner', NULL, c.firm_id, i.client_id,
  i.id, 'task', 'db_trigger', coalesce(f.is_internal, false), c.is_demo,
  'task.assigned:' || i.id, jsonb_build_object('has_email', true)
FROM public.action_items i
JOIN public.clients c ON c.id = i.client_id
LEFT JOIN public.firms f ON f.id = c.firm_id
WHERE i.owner_id IS NOT NULL
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO analytics.events (
  event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
  object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
)
SELECT
  'task.completed', i.completed_at, 'sme_employee', NULL, c.firm_id, i.client_id,
  i.id, 'task', 'db_trigger', coalesce(f.is_internal, false), c.is_demo,
  'task.completed:' || i.id, '{}'::jsonb
FROM public.action_items i
JOIN public.clients c ON c.id = i.client_id
LEFT JOIN public.firms f ON f.id = c.firm_id
WHERE i.completed_at IS NOT NULL
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO analytics.events (
  event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
  object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
)
SELECT
  'task.email.dispatched', coalesce(e.sent_at, e.created_at), 'sme_owner', NULL,
  c.firm_id, e.client_id, e.action_item_id, 'task', 'db_trigger',
  coalesce(f.is_internal, false), c.is_demo,
  'task.email.dispatched:' || e.id,
  jsonb_build_object('email_type', e.email_type)
FROM public.action_emails e
JOIN public.clients c ON c.id = e.client_id
LEFT JOIN public.firms f ON f.id = c.firm_id
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO analytics.events (
  event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
  object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
)
SELECT
  CASE
    WHEN d.report_key = 'zip_all' THEN 'report.zip_all'
    WHEN d.channel = 'pdf_download' THEN 'report.downloaded'
    ELSE 'report.sent'
  END,
  d.created_at, 'accountant', d.created_by, d.firm_id, d.client_id,
  d.id, 'delivery', 'db_trigger',
  coalesce(f.is_internal, false), coalesce(c.is_demo, false),
  CASE
    WHEN d.report_key = 'zip_all' THEN 'report.zip_all:' || d.id
    WHEN d.channel = 'pdf_download' THEN 'report.downloaded:' || d.id
    ELSE 'report.sent:' || d.id
  END,
  jsonb_build_object('report_key', d.report_key, 'channel', d.channel, 'kind', d.kind)
FROM public.advisory_deliveries d
LEFT JOIN public.clients c ON c.id = d.client_id
LEFT JOIN public.firms f ON f.id = coalesce(d.firm_id, c.firm_id)
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO analytics.events (
  event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
  object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
)
SELECT
  'qbo.connected', coalesce(q.connected_at, now()), 'accountant', NULL,
  c.firm_id, q.client_id, q.id, 'qbo', 'db_trigger',
  coalesce(f.is_internal, false), c.is_demo,
  'qbo.connected:' || q.id, '{}'::jsonb
FROM public.qbo_connections q
JOIN public.clients c ON c.id = q.client_id
LEFT JOIN public.firms f ON f.id = c.firm_id
ON CONFLICT (idempotency_key) DO NOTHING;

DO $$ BEGIN
  IF to_regclass('public.milon_ops_payments') IS NOT NULL THEN
    INSERT INTO analytics.events (
      event_key, occurred_at, actor_kind, actor_id, practice_id, entity_id,
      object_id, object_type, source, is_internal, is_demo, idempotency_key, properties
    )
    SELECT
      'payment.recorded', p.paid_at::timestamptz, 'platform_owner', p.created_by,
      p.firm_id, NULL, p.id, 'payment', 'db_trigger', false, false,
      'payment.recorded:' || p.id,
      jsonb_build_object('status', p.status, 'plan_code', p.plan_code)
    FROM public.milon_ops_payments p
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
END $$;
