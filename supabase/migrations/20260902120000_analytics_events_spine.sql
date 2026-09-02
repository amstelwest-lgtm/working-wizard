-- ============================================================================
-- MILŌN analytics spine (Phase 1)
-- Append-only validated-learning events. Deny-all RLS.
-- Rollback: docs/metrics/ROLLBACK.sql
--
-- Apply this in the Supabase SQL editor. Safe to re-run (idempotent DDL).
-- Set firms.is_internal / is_founding_practice and clients.is_demo BEFORE
-- relying on backfill numbers — this migration flags firms owned by the
-- founder email as internal, then backfills.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS analytics;

-- ── Product flags (stamp at write time; do not invent demo-by-name) ──────────
ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS is_founding_practice boolean NOT NULL DEFAULT false;
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF to_regclass('public.milon_ops_payments') IS NOT NULL THEN
    ALTER TABLE public.milon_ops_payments
      ADD COLUMN IF NOT EXISTS firm_id uuid REFERENCES public.firms(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.firms.is_internal IS
  'Founder/staff test firm. Analytics stamps is_internal from this at write time.';
COMMENT ON COLUMN public.firms.is_founding_practice IS
  'Founding Practice cohort — segment out of headline PMF numbers.';
COMMENT ON COLUMN public.clients.is_demo IS
  'Sandbox / sample client. Never treat as a real-entity commitment.';
DO $$ BEGIN
  IF to_regclass('public.milon_ops_payments') IS NOT NULL THEN
    EXECUTE $c$COMMENT ON COLUMN public.milon_ops_payments.firm_id IS
      'Optional practice this payment belongs to (commitment ladder).'$c$;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.milon_ops_payments') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS milon_ops_payments_firm_idx
      ON public.milon_ops_payments (firm_id)
      WHERE firm_id IS NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  CREATE TYPE analytics.actor_kind AS ENUM (
    'anonymous',
    'accountant',
    'practice_admin',
    'sme_owner',
    'sme_member',
    'sme_employee',
    'milon_it',
    'platform_owner',
    'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE analytics.event_source AS ENUM (
    'client',
    'server',
    'db_trigger',
    'job'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS analytics.founder_emails (
  email text PRIMARY KEY
);

INSERT INTO analytics.founder_emails (email)
VALUES ('amstel.west@gmail.com')
ON CONFLICT (email) DO NOTHING;

CREATE TABLE IF NOT EXISTS analytics.events (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key         text        NOT NULL,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  received_at       timestamptz NOT NULL DEFAULT now(),
  actor_kind        analytics.actor_kind NOT NULL,
  actor_id          uuid,
  actor_hash        text,
  practice_id       uuid,
  entity_id         uuid,
  object_id         uuid,
  object_type       text,
  source            analytics.event_source NOT NULL,
  session_id        text,
  is_internal       boolean NOT NULL DEFAULT false,
  is_demo           boolean NOT NULL DEFAULT false,
  is_bot            boolean NOT NULL DEFAULT false,
  idempotency_key   text,
  properties        jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT analytics_events_idempotency UNIQUE (idempotency_key),
  CONSTRAINT analytics_no_financial_payload CHECK (
    NOT (properties ?| ARRAY['revenue','profit','turnover','balance','bank_account','id_number'])
  )
);

CREATE INDEX IF NOT EXISTS analytics_events_real_traffic_idx
  ON analytics.events (event_key, occurred_at DESC)
  WHERE NOT is_internal AND NOT is_demo AND NOT is_bot;

CREATE INDEX IF NOT EXISTS analytics_events_practice_idx
  ON analytics.events (practice_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_entity_idx
  ON analytics.events (entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_actor_idx
  ON analytics.events (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_object_idx
  ON analytics.events (object_id, occurred_at DESC)
  WHERE object_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS analytics_events_props_idx
  ON analytics.events USING gin (properties);

COMMENT ON TABLE analytics.events IS
  'Append-only founder validated-learning log. Never UPDATE/DELETE rows.';

ALTER TABLE analytics.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.founder_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_events deny all" ON analytics.events;
CREATE POLICY "analytics_events deny all"
  ON analytics.events FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "analytics_founder_emails deny all" ON analytics.founder_emails;
CREATE POLICY "analytics_founder_emails deny all"
  ON analytics.founder_emails FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

GRANT USAGE ON SCHEMA analytics TO postgres, service_role;

-- ── Flag firms owned by the founder email (before backfill) ──────────────────
UPDATE public.firms f
SET is_internal = true
FROM auth.users u
WHERE f.owner_user_id = u.id
  AND lower(u.email::text) IN (SELECT email FROM analytics.founder_emails)
  AND f.is_internal = false;

-- ============================================================================
-- Core insert (stamps is_internal / is_demo; never throws to the caller)
-- ============================================================================
CREATE OR REPLACE FUNCTION analytics.jsonb_is_blank(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p IS NULL OR p = 'null'::jsonb OR p = '{}'::jsonb;
$$;

CREATE OR REPLACE FUNCTION analytics.actor_kind_for(p_uid uuid, p_surface text)
RETURNS analytics.actor_kind
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_email text;
  v_roles text[];
  v_surface text := coalesce(p_surface, '');
BEGIN
  IF p_uid IS NULL THEN
    RETURN 'system'::analytics.actor_kind;
  END IF;

  SELECT lower(u.email::text) INTO v_email FROM auth.users u WHERE u.id = p_uid;
  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM analytics.founder_emails fe WHERE fe.email = v_email
  ) THEN
    RETURN 'platform_owner'::analytics.actor_kind;
  END IF;

  BEGIN
    IF public.is_milon_it_member(p_uid) THEN
      RETURN 'milon_it'::analytics.actor_kind;
    END IF;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  SELECT coalesce(array_agg(ur.role::text), ARRAY[]::text[])
    INTO v_roles
  FROM public.user_roles ur
  WHERE ur.user_id = p_uid;

  IF v_surface IN ('accountant_portal', 'reports')
     AND ('firm_admin' = ANY (v_roles) OR 'accountant' = ANY (v_roles)) THEN
    IF 'firm_admin' = ANY (v_roles) THEN
      RETURN 'practice_admin'::analytics.actor_kind;
    END IF;
    RETURN 'accountant'::analytics.actor_kind;
  END IF;

  IF v_surface = 'owner_app' AND 'client_owner' = ANY (v_roles) THEN
    RETURN 'sme_owner'::analytics.actor_kind;
  END IF;

  IF 'firm_admin' = ANY (v_roles) THEN
    RETURN 'practice_admin'::analytics.actor_kind;
  END IF;
  IF 'accountant' = ANY (v_roles) THEN
    RETURN 'accountant'::analytics.actor_kind;
  END IF;
  IF 'client_owner' = ANY (v_roles) THEN
    RETURN 'sme_owner'::analytics.actor_kind;
  END IF;
  IF 'client_member' = ANY (v_roles) THEN
    RETURN 'sme_member'::analytics.actor_kind;
  END IF;

  RETURN 'anonymous'::analytics.actor_kind;
END;
$$;

CREATE OR REPLACE FUNCTION analytics.record(
  p_event_key       text,
  p_occurred_at     timestamptz DEFAULT now(),
  p_actor_kind      analytics.actor_kind DEFAULT 'system',
  p_actor_id        uuid DEFAULT NULL,
  p_actor_hash      text DEFAULT NULL,
  p_practice_id     uuid DEFAULT NULL,
  p_entity_id       uuid DEFAULT NULL,
  p_object_id       uuid DEFAULT NULL,
  p_object_type     text DEFAULT NULL,
  p_source          analytics.event_source DEFAULT 'server',
  p_session_id      text DEFAULT NULL,
  p_is_bot          boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL,
  p_properties      jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_practice uuid := p_practice_id;
  v_demo boolean := false;
  v_internal boolean := false;
  v_email text;
  v_props jsonb := coalesce(p_properties, '{}'::jsonb);
  v_firm_internal boolean;
BEGIN
  IF p_event_key IS NULL OR length(trim(p_event_key)) = 0 THEN
    RETURN;
  END IF;

  v_props := v_props - ARRAY[
    'revenue','profit','turnover','balance','bank_account','id_number',
    'email','password','token','secret','authorization','cookie'
  ];

  IF p_entity_id IS NOT NULL THEN
    SELECT coalesce(c.is_demo, false), coalesce(v_practice, c.firm_id)
      INTO v_demo, v_practice
    FROM public.clients c
    WHERE c.id = p_entity_id;
  END IF;

  IF v_practice IS NOT NULL THEN
    SELECT coalesce(f.is_internal, false)
      INTO v_firm_internal
    FROM public.firms f
    WHERE f.id = v_practice;
    v_internal := coalesce(v_firm_internal, false);
  END IF;

  IF p_actor_id IS NOT NULL THEN
    SELECT lower(u.email::text) INTO v_email FROM auth.users u WHERE u.id = p_actor_id;
    IF v_email IS NOT NULL AND EXISTS (
      SELECT 1 FROM analytics.founder_emails fe WHERE fe.email = v_email
    ) THEN
      v_internal := true;
    END IF;
    BEGIN
      IF public.is_milon_it_member(p_actor_id) THEN
        v_internal := true;
      END IF;
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END IF;

  INSERT INTO analytics.events (
    event_key, occurred_at, actor_kind, actor_id, actor_hash,
    practice_id, entity_id, object_id, object_type, source, session_id,
    is_internal, is_demo, is_bot, idempotency_key, properties
  ) VALUES (
    left(trim(p_event_key), 120),
    coalesce(p_occurred_at, now()),
    p_actor_kind,
    p_actor_id,
    p_actor_hash,
    v_practice,
    p_entity_id,
    p_object_id,
    p_object_type,
    p_source,
    p_session_id,
    v_internal,
    coalesce(v_demo, false),
    coalesce(p_is_bot, false),
    p_idempotency_key,
    v_props
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
EXCEPTION
  WHEN unique_violation THEN
    NULL;
  WHEN others THEN
    RAISE WARNING 'analytics.record failed (%) %', p_event_key, SQLERRM;
END;
$$;

-- ============================================================================
-- Client-writable RPC (allowlist). Flags stamped server-side.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.analytics_track(
  p_event_key       text,
  p_properties      jsonb DEFAULT '{}'::jsonb,
  p_session_id      text DEFAULT NULL,
  p_entity_id       uuid DEFAULT NULL,
  p_practice_id     uuid DEFAULT NULL,
  p_object_id       uuid DEFAULT NULL,
  p_object_type     text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_key text := trim(p_event_key);
  v_surface text;
  v_kind analytics.actor_kind;
  v_practice uuid := p_practice_id;
BEGIN
  IF v_key NOT IN (
    'view.opened','view_mode.toggled','pillar.drilldown.opened','ratio.expanded',
    'playbook.opened','playbook.step.expanded','plan.opened','report.previewed',
    'upload.started','upload.abandoned','ask_ai.query.abandoned',
    'task.link.rendered','task.link.engaged',
    'pricing.viewed','landing.viewed','landing.quiz.completed',
    'friction.dead_click'
  ) THEN
    RAISE EXCEPTION 'event_key % is not client-writable', v_key;
  END IF;

  -- Magic-link engagement is written by /api/task-engaged (service role), not the browser RPC.
  IF v_key IN ('task.link.rendered','task.link.engaged') THEN
    RAISE EXCEPTION 'event_key % must be written via the task-engaged POST beacon', v_key;
  END IF;

  v_surface := coalesce(p_properties->>'surface', '');
  IF v_actor IS NULL THEN
    v_kind := 'anonymous'::analytics.actor_kind;
  ELSE
    v_kind := analytics.actor_kind_for(v_actor, v_surface);
  END IF;

  IF v_practice IS NULL AND v_actor IS NOT NULL THEN
    SELECT fm.firm_id INTO v_practice
    FROM public.firm_memberships fm
    WHERE fm.user_id = v_actor
    LIMIT 1;
  END IF;

  PERFORM analytics.record(
    v_key,
    now(),
    v_kind,
    v_actor,
    NULL,
    v_practice,
    p_entity_id,
    p_object_id,
    p_object_type,
    'client'::analytics.event_source,
    p_session_id,
    false,
    p_idempotency_key,
    coalesce(p_properties, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_track(
  text, jsonb, text, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_track(
  text, jsonb, text, uuid, uuid, uuid, text, text
) TO authenticated, service_role;

-- Service-role / trigger emit (any key). Not granted to authenticated or anon.
CREATE OR REPLACE FUNCTION public.analytics_emit(
  p_event_key       text,
  p_occurred_at     timestamptz DEFAULT now(),
  p_actor_kind      text DEFAULT 'system',
  p_actor_id        uuid DEFAULT NULL,
  p_actor_hash      text DEFAULT NULL,
  p_practice_id     uuid DEFAULT NULL,
  p_entity_id       uuid DEFAULT NULL,
  p_object_id       uuid DEFAULT NULL,
  p_object_type     text DEFAULT NULL,
  p_source          text DEFAULT 'server',
  p_session_id      text DEFAULT NULL,
  p_is_bot          boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL,
  p_properties      jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public
AS $$
BEGIN
  PERFORM analytics.record(
    p_event_key,
    p_occurred_at,
    p_actor_kind::analytics.actor_kind,
    p_actor_id,
    p_actor_hash,
    p_practice_id,
    p_entity_id,
    p_object_id,
    p_object_type,
    p_source::analytics.event_source,
    p_session_id,
    p_is_bot,
    p_idempotency_key,
    coalesce(p_properties, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_emit(
  text, timestamptz, text, uuid, text, uuid, uuid, uuid, text, text, text, boolean, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_emit(
  text, timestamptz, text, uuid, text, uuid, uuid, uuid, text, text, text, boolean, text, jsonb
) TO service_role;

-- Read-only ack preview (GET-safe). Does not write.
CREATE OR REPLACE FUNCTION public.preview_advisory_delivery_ack(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ack timestamptz;
BEGIN
  IF _token IS NULL OR length(trim(_token)) < 16 THEN
    RETURN jsonb_build_object('found', false, 'already', false);
  END IF;
  SELECT d.acknowledged_at INTO v_ack
  FROM public.advisory_deliveries d
  WHERE d.ack_token = _token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'already', false);
  END IF;
  RETURN jsonb_build_object('found', true, 'already', v_ack IS NOT NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_advisory_delivery_ack(text) TO anon, authenticated, service_role;

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
