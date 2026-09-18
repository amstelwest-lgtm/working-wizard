-- ============================================================================
-- MILŌN advisory OS — P0.1 advisory state + events (additive only)
--
-- One persistent advisory state per client, advanced by append-only events.
-- Transition rules are DATA (public.advisory_transition_rules) seeded from the
-- TypeScript source of truth in src/lib/advisory-state.ts; `pnpm
-- test:advisory-state` fails if the two drift. Guards are evaluated in
-- public.advisory_next_state().
--
-- Emission points (DB triggers, exception-safe — a bug here never blocks the
-- user's write):
--   clients            INSERT                  → client.created
--   clients            operating_profile set   → profile.completed
--   clients            financials / bank draft → data.uploaded
--   clients            last_forecast_at moved  → forecast.published
--   client_financial_snapshots INSERT          → data.validated
--   client_brain_questions status→answered     → brain.question_answered
--   proposed_next_steps INSERT / status change → recommendation.*
--   client_review_signoffs INSERT / DELETE     → review.signed_off / retracted
--   action_items INSERT / status change        → action.*
--   pg_cron (daily) next_review_at elapsed     → cycle.review_due
--
-- App-writable events go through public.advisory_record_event (allowlisted).
-- No destructive changes. Ratio / health / forecast tables untouched.
-- ============================================================================

-- ── clients columns ─────────────────────────────────────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS advisory_state    text,
  ADD COLUMN IF NOT EXISTS advisory_cycle_id uuid,
  ADD COLUMN IF NOT EXISTS next_review_at    timestamptz;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_advisory_state_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_advisory_state_check CHECK (
  advisory_state IS NULL OR advisory_state IN (
    'onboarding', 'context_collection', 'financial_data_collection', 'data_validation',
    'diagnosis', 'forecasting', 'recommendations', 'accountant_review', 'client_decision',
    'action_execution', 'outcome_monitoring', 'next_review'
  )
);

COMMENT ON COLUMN public.clients.advisory_state IS
  'Current advisory-OS state (what MILŌN is waiting for). Written only by advisory_apply_event.';
COMMENT ON COLUMN public.clients.advisory_cycle_id IS
  'Open advisory_cycles row for this client.';
COMMENT ON COLUMN public.clients.next_review_at IS
  'When cycle.review_due should fire (set on entering outcome_monitoring).';

-- ── advisory_cycles ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.advisory_cycles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  seq            integer NOT NULL,
  state          text NOT NULL,
  trigger_event  text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  closed_reason  text CHECK (closed_reason IS NULL OR closed_reason IN ('superseded', 'restarted')),
  next_review_at timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, seq)
);

CREATE INDEX IF NOT EXISTS advisory_cycles_client_open_idx
  ON public.advisory_cycles (client_id, started_at DESC)
  WHERE closed_at IS NULL;

DROP TRIGGER IF EXISTS advisory_cycles_touch_updated_at ON public.advisory_cycles;
CREATE TRIGGER advisory_cycles_touch_updated_at
  BEFORE UPDATE ON public.advisory_cycles
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_advisory_cycle_id_fkey;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_advisory_cycle_id_fkey
  FOREIGN KEY (advisory_cycle_id) REFERENCES public.advisory_cycles(id) ON DELETE SET NULL;

-- ── advisory_events (append-only) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.advisory_events (
  id          bigserial PRIMARY KEY,
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cycle_id    uuid REFERENCES public.advisory_cycles(id) ON DELETE SET NULL,
  event       text NOT NULL CHECK (event IN (
                'client.created', 'cycle.backfilled', 'cycle.restarted', 'cycle.review_due',
                'profile.completed', 'brain.question_answered',
                'data.uploaded', 'data.validated', 'data.request_opened', 'data.request_fulfilled',
                'diagnosis.reviewed', 'forecast.published',
                'recommendation.proposed', 'recommendation.approved', 'recommendation.rejected',
                'review.signed_off', 'review.retracted',
                'action.created', 'action.started', 'action.completed', 'action.blocked'
              )),
  from_state  text,
  to_state    text NOT NULL,
  changed     boolean NOT NULL DEFAULT false,
  actor_kind  text NOT NULL DEFAULT 'system'
              CHECK (actor_kind IN ('system', 'owner', 'accountant', 'service')),
  actor_id    uuid,
  source      text NOT NULL DEFAULT 'db_trigger'
              CHECK (source IN ('db_trigger', 'rpc', 'cron', 'backfill')),
  ref_table   text,
  ref_id      uuid,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advisory_events_client_idx
  ON public.advisory_events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS advisory_events_cycle_idx
  ON public.advisory_events (cycle_id, created_at);

-- ── advisory_transition_rules (seeded from src/lib/advisory-state.ts) ───────

CREATE TABLE IF NOT EXISTS public.advisory_transition_rules (
  seq        integer PRIMARY KEY,
  event      text NOT NULL,
  from_state text NOT NULL,   -- a state, 'none' (no state yet) or '*' (any)
  guard      text NOT NULL CHECK (guard IN (
               'none', 'has_firm', 'no_firm', 'has_financials', 'no_open_actions', 'scope_advisory'
             )),
  to_state   text NOT NULL,
  new_cycle  boolean NOT NULL DEFAULT false
);

-- Re-seed on every run so the table always matches the TS source of truth.
DELETE FROM public.advisory_transition_rules;
INSERT INTO public.advisory_transition_rules (seq, event, from_state, guard, to_state, new_cycle) VALUES
  (10, 'client.created', 'none', 'has_financials', 'data_validation', true),
  (20, 'client.created', 'none', 'none', 'onboarding', true),
  (30, 'profile.completed', 'onboarding', 'none', 'financial_data_collection', false),
  (40, 'profile.completed', 'context_collection', 'none', 'financial_data_collection', false),
  (50, 'brain.question_answered', 'onboarding', 'none', 'context_collection', false),
  (60, 'data.uploaded', 'onboarding', 'none', 'data_validation', false),
  (70, 'data.uploaded', 'context_collection', 'none', 'data_validation', false),
  (80, 'data.uploaded', 'financial_data_collection', 'none', 'data_validation', false),
  (90, 'data.uploaded', 'diagnosis', 'none', 'data_validation', false),
  (100, 'data.uploaded', 'forecasting', 'none', 'data_validation', false),
  (110, 'data.uploaded', 'recommendations', 'none', 'data_validation', false),
  (120, 'data.uploaded', 'accountant_review', 'none', 'data_validation', false),
  (130, 'data.uploaded', 'client_decision', 'none', 'data_validation', false),
  (140, 'data.uploaded', 'action_execution', 'none', 'data_validation', true),
  (150, 'data.uploaded', 'outcome_monitoring', 'none', 'data_validation', true),
  (160, 'data.uploaded', 'next_review', 'none', 'data_validation', true),
  (170, 'data.validated', 'onboarding', 'none', 'diagnosis', false),
  (180, 'data.validated', 'context_collection', 'none', 'diagnosis', false),
  (190, 'data.validated', 'financial_data_collection', 'none', 'diagnosis', false),
  (200, 'data.validated', 'data_validation', 'none', 'diagnosis', false),
  (210, 'diagnosis.reviewed', 'diagnosis', 'none', 'forecasting', false),
  (220, 'forecast.published', 'diagnosis', 'none', 'recommendations', false),
  (230, 'forecast.published', 'forecasting', 'none', 'recommendations', false),
  (240, 'recommendation.proposed', 'diagnosis', 'has_firm', 'accountant_review', false),
  (250, 'recommendation.proposed', 'forecasting', 'has_firm', 'accountant_review', false),
  (260, 'recommendation.proposed', 'recommendations', 'has_firm', 'accountant_review', false),
  (270, 'recommendation.proposed', 'diagnosis', 'no_firm', 'client_decision', false),
  (280, 'recommendation.proposed', 'forecasting', 'no_firm', 'client_decision', false),
  (290, 'recommendation.proposed', 'recommendations', 'no_firm', 'client_decision', false),
  (300, 'recommendation.approved', 'accountant_review', 'none', 'client_decision', false),
  (310, 'review.signed_off', 'accountant_review', 'scope_advisory', 'client_decision', false),
  (320, 'action.created', 'recommendations', 'none', 'action_execution', false),
  (330, 'action.created', 'accountant_review', 'none', 'action_execution', false),
  (340, 'action.created', 'client_decision', 'none', 'action_execution', false),
  (350, 'action.completed', 'action_execution', 'no_open_actions', 'outcome_monitoring', false),
  (360, 'cycle.review_due', 'action_execution', 'none', 'next_review', false),
  (370, 'cycle.review_due', 'outcome_monitoring', 'none', 'next_review', false),
  (380, 'cycle.restarted', '*', 'none', 'financial_data_collection', true);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Read: anyone with client access. Write: nobody directly — only the
-- SECURITY DEFINER functions below insert/update these rows.

ALTER TABLE public.advisory_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisory_transition_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "advisory_cycles select access" ON public.advisory_cycles;
CREATE POLICY "advisory_cycles select access"
  ON public.advisory_cycles FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "advisory_events select access" ON public.advisory_events;
CREATE POLICY "advisory_events select access"
  ON public.advisory_events FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "advisory_transition_rules select all" ON public.advisory_transition_rules;
CREATE POLICY "advisory_transition_rules select all"
  ON public.advisory_transition_rules FOR SELECT TO authenticated
  USING (true);

-- ── helpers ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.advisory_jsonb_is_blank(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p IS NULL OR p = 'null'::jsonb OR p = '{}'::jsonb OR p = '[]'::jsonb;
$$;

-- Actor kind for the audit row. Mirrors src/lib/advisory-state.ts ADVISORY_ACTOR_KINDS.
CREATE OR REPLACE FUNCTION public.advisory_actor_kind(p_uid uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roles text[];
BEGIN
  IF p_uid IS NULL THEN
    RETURN 'system';
  END IF;
  SELECT coalesce(array_agg(ur.role::text), ARRAY[]::text[])
    INTO v_roles
  FROM public.user_roles ur
  WHERE ur.user_id = p_uid;
  IF 'firm_admin' = ANY (v_roles) OR 'accountant' = ANY (v_roles) THEN
    RETURN 'accountant';
  END IF;
  RETURN 'owner';
END;
$$;

-- Pure resolver over the rules table. Mirrors nextAdvisoryState() in TS:
-- exact from_state beats '*', then lowest seq whose guard passes.
-- Returns NULL when no rule matches (event is still recorded, state unchanged).
CREATE OR REPLACE FUNCTION public.advisory_next_state(
  p_state    text,
  p_event    text,
  p_has_firm boolean,
  p_ctx      jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (to_state text, new_cycle boolean, rule_seq integer)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  r record;
  v_from text := coalesce(p_state, 'none');
  v_scope text := coalesce(p_ctx->>'scope', '');
  v_open_actions integer := coalesce((p_ctx->>'open_actions')::integer, 0);
  v_has_financials boolean := coalesce((p_ctx->>'has_financials')::boolean, false);
BEGIN
  FOR r IN
    SELECT tr.seq, tr.guard, tr.to_state, tr.new_cycle
    FROM public.advisory_transition_rules tr
    WHERE tr.event = p_event
      AND (tr.from_state = v_from OR tr.from_state = '*')
    ORDER BY (tr.from_state = '*')::int, tr.seq
  LOOP
    IF (r.guard = 'none')
       OR (r.guard = 'has_firm' AND coalesce(p_has_firm, false))
       OR (r.guard = 'no_firm' AND NOT coalesce(p_has_firm, false))
       OR (r.guard = 'has_financials' AND v_has_financials)
       OR (r.guard = 'no_open_actions' AND v_open_actions = 0)
       OR (r.guard = 'scope_advisory' AND v_scope IN ('advisory', 'action_plan'))
    THEN
      to_state := r.to_state;
      new_cycle := r.new_cycle;
      rule_seq := r.seq;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;
  RETURN;
END;
$$;

-- ── core: apply one event ───────────────────────────────────────────────────
-- Locks the client row, resolves the transition, opens/closes cycles, appends
-- the event, updates clients.advisory_*. Raises on hard errors; triggers wrap
-- it in advisory_emit() so user writes are never blocked.

CREATE OR REPLACE FUNCTION public.advisory_apply_event(
  p_client_id  uuid,
  p_event      text,
  p_actor_id   uuid DEFAULT NULL,
  p_source     text DEFAULT 'db_trigger',
  p_payload    jsonb DEFAULT '{}'::jsonb,
  p_ref_table  text DEFAULT NULL,
  p_ref_id     uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state       text;
  v_cycle_id    uuid;
  v_firm_id     uuid;
  v_from        text;
  v_to          text;
  v_new_cycle   boolean := false;
  v_changed     boolean := false;
  v_rule_seq    integer;
  v_next_review timestamptz;
  v_seq         integer;
  v_event_id    bigint;
  v_payload     jsonb := coalesce(p_payload, '{}'::jsonb);
  v_ns_to       text;
  v_ns_new      boolean;
  v_ns_seq      integer;
BEGIN
  IF p_client_id IS NULL OR p_event IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.advisory_state, c.advisory_cycle_id, c.firm_id, c.next_review_at
    INTO v_state, v_cycle_id, v_firm_id, v_next_review
  FROM public.clients c
  WHERE c.id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_from := v_state;

  -- Implicit bootstrap: a client without a state is client.created first.
  IF v_state IS NULL AND p_event <> 'client.created' THEN
    SELECT ns.to_state INTO v_ns_to
    FROM public.advisory_next_state(NULL, 'client.created', v_firm_id IS NOT NULL, v_payload) ns;
    v_state := coalesce(v_ns_to, 'onboarding');
    v_new_cycle := true;
    v_changed := true;
    v_ns_to := NULL;
  END IF;

  SELECT ns.to_state, ns.new_cycle, ns.rule_seq INTO v_ns_to, v_ns_new, v_ns_seq
  FROM public.advisory_next_state(v_state, p_event, v_firm_id IS NOT NULL, v_payload) ns;
  IF v_ns_to IS NOT NULL THEN
    v_to := v_ns_to;
    v_rule_seq := v_ns_seq;
    v_new_cycle := v_new_cycle OR coalesce(v_ns_new, false);
    v_changed := v_changed OR (v_to IS DISTINCT FROM v_state);
  ELSE
    v_to := coalesce(v_state, 'onboarding');
  END IF;

  -- Cycle bookkeeping.
  IF v_new_cycle OR v_cycle_id IS NULL THEN
    IF v_cycle_id IS NOT NULL THEN
      UPDATE public.advisory_cycles
         SET closed_at = now(),
             closed_reason = CASE WHEN p_event = 'cycle.restarted' THEN 'restarted' ELSE 'superseded' END,
             state = v_from
       WHERE id = v_cycle_id AND closed_at IS NULL;
    END IF;
    SELECT coalesce(max(seq), 0) + 1 INTO v_seq FROM public.advisory_cycles WHERE client_id = p_client_id;
    INSERT INTO public.advisory_cycles (client_id, seq, state, trigger_event)
    VALUES (p_client_id, v_seq, v_to, p_event)
    RETURNING id INTO v_cycle_id;
    v_next_review := NULL;
  ELSE
    UPDATE public.advisory_cycles SET state = v_to WHERE id = v_cycle_id;
  END IF;

  -- Review cadence: arm when entering outcome_monitoring, clear once due.
  IF v_to = 'outcome_monitoring' AND v_from IS DISTINCT FROM 'outcome_monitoring' THEN
    v_next_review := now() + interval '30 days';
  ELSIF v_to = 'next_review' THEN
    v_next_review := NULL;
  END IF;
  UPDATE public.advisory_cycles SET next_review_at = v_next_review WHERE id = v_cycle_id;

  INSERT INTO public.advisory_events (
    client_id, cycle_id, event, from_state, to_state, changed,
    actor_kind, actor_id, source, ref_table, ref_id, payload
  ) VALUES (
    p_client_id, v_cycle_id, p_event, v_from, v_to, v_changed,
    public.advisory_actor_kind(p_actor_id), p_actor_id,
    coalesce(p_source, 'db_trigger'), p_ref_table, p_ref_id,
    v_payload || CASE WHEN v_rule_seq IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('rule_seq', v_rule_seq) END
  )
  RETURNING id INTO v_event_id;

  -- Only advisory_* columns change here, so the clients trigger below is a no-op
  -- on this nested UPDATE (it diffs specific business columns).
  UPDATE public.clients
     SET advisory_state = v_to,
         advisory_cycle_id = v_cycle_id,
         next_review_at = v_next_review
   WHERE id = p_client_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.advisory_apply_event(uuid, text, uuid, text, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advisory_apply_event(uuid, text, uuid, text, jsonb, text, uuid) TO service_role;

-- Exception-safe wrapper for triggers.
CREATE OR REPLACE FUNCTION public.advisory_emit(
  p_client_id  uuid,
  p_event      text,
  p_actor_id   uuid DEFAULT NULL,
  p_payload    jsonb DEFAULT '{}'::jsonb,
  p_ref_table  text DEFAULT NULL,
  p_ref_id     uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.advisory_apply_event(p_client_id, p_event, p_actor_id, 'db_trigger', p_payload, p_ref_table, p_ref_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_emit(%, %) failed: %', p_client_id, p_event, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.advisory_emit(uuid, text, uuid, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;

-- ── app-facing RPC (allowlisted events, has_client_access) ──────────────────

CREATE OR REPLACE FUNCTION public.advisory_record_event(
  p_client_id uuid,
  p_event     text,
  p_payload   jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_client_access(v_uid, p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client';
  END IF;
  -- Keep in sync with APP_WRITABLE_ADVISORY_EVENTS in src/lib/advisory-state.ts
  IF p_event NOT IN ('diagnosis.reviewed', 'cycle.restarted', 'data.request_opened', 'data.request_fulfilled') THEN
    RAISE EXCEPTION 'event % is not app-writable', p_event;
  END IF;
  RETURN public.advisory_apply_event(
    p_client_id, p_event, v_uid, 'rpc',
    coalesce(p_payload, '{}'::jsonb) - ARRAY['revenue','profit','balance','email','token','secret'],
    NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.advisory_record_event(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advisory_record_event(uuid, text, jsonb) TO authenticated, service_role;

-- ── triggers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.advisory_trg_clients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := coalesce(auth.uid(), NEW.owner_user_id);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.advisory_emit(
      NEW.id, 'client.created', v_actor,
      jsonb_build_object(
        'has_financials', NOT public.advisory_jsonb_is_blank(NEW.financials),
        'has_firm', NEW.firm_id IS NOT NULL
      ),
      'clients', NEW.id
    );
    RETURN NEW;
  END IF;

  -- Nested UPDATE from advisory_apply_event only touches advisory_* columns:
  -- none of the checks below fire for it.
  IF public.advisory_jsonb_is_blank(OLD.operating_profile)
     AND NOT public.advisory_jsonb_is_blank(NEW.operating_profile) THEN
    PERFORM public.advisory_emit(NEW.id, 'profile.completed', v_actor, '{}'::jsonb, 'clients', NEW.id);
  END IF;

  IF (public.advisory_jsonb_is_blank(OLD.financials) AND NOT public.advisory_jsonb_is_blank(NEW.financials))
     OR (NEW.financials_updated_at IS NOT NULL
         AND OLD.financials_updated_at IS DISTINCT FROM NEW.financials_updated_at) THEN
    PERFORM public.advisory_emit(
      NEW.id, 'data.uploaded', v_actor,
      jsonb_build_object('kind', 'financials'), 'clients', NEW.id
    );
  -- cashflow_bank_draft is an optional column (no migration in-repo); read it
  -- through to_jsonb so a missing column is NULL instead of a runtime error.
  ELSIF public.advisory_jsonb_is_blank(to_jsonb(OLD)->'cashflow_bank_draft')
     AND NOT public.advisory_jsonb_is_blank(to_jsonb(NEW)->'cashflow_bank_draft') THEN
    PERFORM public.advisory_emit(
      NEW.id, 'data.uploaded', v_actor,
      jsonb_build_object('kind', 'bank_statement'), 'clients', NEW.id
    );
  END IF;

  IF NEW.last_forecast_at IS NOT NULL
     AND OLD.last_forecast_at IS DISTINCT FROM NEW.last_forecast_at THEN
    PERFORM public.advisory_emit(NEW.id, 'forecast.published', v_actor, '{}'::jsonb, 'clients', NEW.id);
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_trg_clients failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advisory_clients ON public.clients;
CREATE TRIGGER trg_advisory_clients
  AFTER INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.advisory_trg_clients();

CREATE OR REPLACE FUNCTION public.advisory_trg_snapshots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.advisory_emit(
    NEW.client_id, 'data.validated', coalesce(auth.uid(), NEW.created_by),
    '{}'::jsonb, 'client_financial_snapshots', NEW.id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_trg_snapshots failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advisory_snapshots ON public.client_financial_snapshots;
CREATE TRIGGER trg_advisory_snapshots
  AFTER INSERT ON public.client_financial_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.advisory_trg_snapshots();

CREATE OR REPLACE FUNCTION public.advisory_trg_brain_questions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'answered'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'answered') THEN
    PERFORM public.advisory_emit(
      NEW.client_id, 'brain.question_answered', coalesce(auth.uid(), NEW.answered_by),
      jsonb_build_object('question_key', NEW.question_key), 'client_brain_questions', NEW.id
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_trg_brain_questions failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advisory_brain_questions ON public.client_brain_questions;
CREATE TRIGGER trg_advisory_brain_questions
  AFTER INSERT OR UPDATE ON public.client_brain_questions
  FOR EACH ROW EXECUTE FUNCTION public.advisory_trg_brain_questions();

CREATE OR REPLACE FUNCTION public.advisory_trg_next_steps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := coalesce(auth.uid(), NEW.signed_off_by_id, NEW.created_by);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.advisory_emit(
      NEW.client_id, 'recommendation.proposed', v_actor,
      jsonb_build_object('title', left(NEW.title, 120)), 'proposed_next_steps', NEW.id
    );
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status IN ('approved', 'edited') THEN
      PERFORM public.advisory_emit(
        NEW.client_id, 'recommendation.approved', v_actor,
        jsonb_build_object('status', NEW.status), 'proposed_next_steps', NEW.id
      );
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.advisory_emit(
        NEW.client_id, 'recommendation.rejected', v_actor, '{}'::jsonb, 'proposed_next_steps', NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_trg_next_steps failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advisory_next_steps ON public.proposed_next_steps;
CREATE TRIGGER trg_advisory_next_steps
  AFTER INSERT OR UPDATE ON public.proposed_next_steps
  FOR EACH ROW EXECUTE FUNCTION public.advisory_trg_next_steps();

CREATE OR REPLACE FUNCTION public.advisory_trg_signoffs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.advisory_emit(
      OLD.client_id, 'review.retracted', coalesce(auth.uid(), OLD.signed_off_by_id),
      jsonb_build_object('scope', OLD.scope), 'client_review_signoffs', OLD.id
    );
    RETURN OLD;
  END IF;
  PERFORM public.advisory_emit(
    NEW.client_id, 'review.signed_off', coalesce(auth.uid(), NEW.signed_off_by_id),
    jsonb_build_object('scope', NEW.scope), 'client_review_signoffs', NEW.id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_trg_signoffs failed: %', SQLERRM;
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_advisory_signoffs ON public.client_review_signoffs;
CREATE TRIGGER trg_advisory_signoffs
  AFTER INSERT OR DELETE ON public.client_review_signoffs
  FOR EACH ROW EXECUTE FUNCTION public.advisory_trg_signoffs();

CREATE OR REPLACE FUNCTION public.advisory_trg_action_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open integer;
  v_event text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := 'action.created';
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    v_event := CASE NEW.status::text
      WHEN 'done' THEN 'action.completed'
      WHEN 'in_progress' THEN 'action.started'
      WHEN 'blocked' THEN 'action.blocked'
      ELSE NULL END;
  END IF;
  IF v_event IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_open
  FROM public.action_items ai
  WHERE ai.client_id = NEW.client_id AND ai.status <> 'done';

  PERFORM public.advisory_emit(
    NEW.client_id, v_event, auth.uid(),
    jsonb_build_object('open_actions', v_open, 'status', NEW.status::text),
    'action_items', NEW.id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_trg_action_items failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advisory_action_items ON public.action_items;
CREATE TRIGGER trg_advisory_action_items
  AFTER INSERT OR UPDATE ON public.action_items
  FOR EACH ROW EXECUTE FUNCTION public.advisory_trg_action_items();

-- ── cron: review due ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.advisory_mark_reviews_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT c.id
    FROM public.clients c
    WHERE c.next_review_at IS NOT NULL
      AND c.next_review_at <= now()
      AND c.advisory_state IN ('action_execution', 'outcome_monitoring')
  LOOP
    PERFORM public.advisory_apply_event(r.id, 'cycle.review_due', NULL, 'cron', '{}'::jsonb, NULL, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.advisory_mark_reviews_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advisory_mark_reviews_due() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('advisory-mark-reviews-due');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule('advisory-mark-reviews-due', '15 4 * * *', 'SELECT public.advisory_mark_reviews_due();');
    RAISE NOTICE 'advisory-mark-reviews-due scheduled daily 04:15 UTC';
  ELSE
    RAISE NOTICE 'pg_cron not installed: run SELECT public.advisory_mark_reviews_due(); on a schedule of your own';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'advisory-mark-reviews-due NOT scheduled: %', SQLERRM;
END $$;

-- ── backfill existing clients ───────────────────────────────────────────────
-- Same precedence as inferAdvisoryStateFromFacts() in src/lib/advisory-state.ts.

DO $$
DECLARE
  r record;
  v_state text;
  v_cycle uuid;
BEGIN
  FOR r IN
    SELECT
      c.id,
      c.firm_id IS NOT NULL AS has_firm,
      NOT public.advisory_jsonb_is_blank(c.operating_profile) AS has_profile,
      NOT public.advisory_jsonb_is_blank(c.financials) AS has_financials,
      EXISTS (SELECT 1 FROM public.client_financial_snapshots s WHERE s.client_id = c.id) AS has_snapshot,
      c.last_forecast_at IS NOT NULL AS has_forecast,
      (SELECT count(*) FROM public.proposed_next_steps p WHERE p.client_id = c.id AND p.status = 'proposed') AS proposed_steps,
      (SELECT count(*) FROM public.proposed_next_steps p WHERE p.client_id = c.id AND p.status IN ('approved', 'edited')) AS approved_steps,
      (SELECT count(*) FROM public.action_items a WHERE a.client_id = c.id AND a.status <> 'done') AS open_actions,
      (SELECT count(*) FROM public.action_items a WHERE a.client_id = c.id AND a.status = 'done') AS done_actions
    FROM public.clients c
    WHERE c.advisory_state IS NULL
  LOOP
    v_state := CASE
      WHEN r.open_actions > 0 THEN 'action_execution'
      WHEN r.done_actions > 0 THEN 'outcome_monitoring'
      WHEN r.approved_steps > 0 THEN 'client_decision'
      WHEN r.proposed_steps > 0 THEN CASE WHEN r.has_firm THEN 'accountant_review' ELSE 'client_decision' END
      WHEN r.has_forecast THEN 'recommendations'
      WHEN r.has_snapshot THEN 'diagnosis'
      WHEN r.has_financials THEN 'data_validation'
      WHEN r.has_profile THEN 'financial_data_collection'
      ELSE 'onboarding'
    END;

    INSERT INTO public.advisory_cycles (client_id, seq, state, trigger_event, next_review_at)
    VALUES (
      r.id, 1, v_state, 'cycle.backfilled',
      CASE WHEN v_state = 'outcome_monitoring' THEN now() + interval '30 days' END
    )
    RETURNING id INTO v_cycle;

    INSERT INTO public.advisory_events (client_id, cycle_id, event, from_state, to_state, changed, actor_kind, source, payload)
    VALUES (r.id, v_cycle, 'cycle.backfilled', NULL, v_state, true, 'system', 'backfill',
            jsonb_build_object('has_firm', r.has_firm, 'has_financials', r.has_financials));

    UPDATE public.clients
       SET advisory_state = v_state,
           advisory_cycle_id = v_cycle,
           next_review_at = CASE WHEN v_state = 'outcome_monitoring' THEN now() + interval '30 days' END
     WHERE id = r.id;
  END LOOP;
END $$;
