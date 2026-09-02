-- ============================================================================
-- MILŌN analytics spine (Phase 1) — SQL 1 of 2
-- Schema, flags, RPCs. Run this first.
-- Then run 20260902121000_analytics_events_triggers.sql
-- Rollback: docs/metrics/ROLLBACK.sql
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
