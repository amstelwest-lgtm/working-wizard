-- ============================================================================
-- P1.1 — Advisory pack + review audit trail
--
-- The pack is the versioned, attributable deliverable a cycle produces from
-- the analysis that already exists (health, ratios, forecast, recommendations,
-- data gaps). `ai_draft` is frozen at generation; `content` is what the
-- reviewer edits and the owner reads. Every review action (edit, comment,
-- approve, request changes, reject, deliver) is an append-only row in
-- `advisory_pack_reviews` with before/after, so the AI-draft → final diff,
-- sign-off timestamp and actor are always reconstructible.
--
-- No direct write policies: all writes go through the two SECURITY DEFINER
-- RPCs below, which enforce the owner-or-firm boundary and the
-- "only the accountant seat can approve when a firm is attached" rule.
--
-- Additive only. Idempotent. Depends on 20260918120000_advisory_state.sql.
-- Vocabulary mirrors src/lib/advisory-pack.ts (test-guarded).
-- ============================================================================

-- ── advisory_packs ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.advisory_packs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cycle_id        uuid REFERENCES public.advisory_cycles(id) ON DELETE SET NULL,
  version         integer NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN (
                    'draft', 'in_review', 'changes_requested', 'approved', 'rejected', 'superseded'
                  )),
  -- true when a firm was attached at generation: the accountant seat must approve.
  requires_review boolean NOT NULL DEFAULT false,
  period_label    text,
  figures_as_of   date,
  snapshot_id     uuid REFERENCES public.client_financial_snapshots(id) ON DELETE SET NULL,
  generator       text NOT NULL DEFAULT 'rules' CHECK (generator IN ('rules', 'rules+claude')),
  ai_draft        jsonb NOT NULL,          -- frozen at generation
  content         jsonb NOT NULL,          -- current (edited) version
  edit_stats      jsonb,                   -- {sections_total, sections_changed, chars_total, chars_changed, edit_rate}
  generated_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by_kind text CHECK (reviewed_by_kind IS NULL OR reviewed_by_kind IN ('accountant', 'owner')),
  reviewed_at     timestamptz,
  review_note     text,
  delivered_at    timestamptz,
  delivered_to    text,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, version)
);

CREATE INDEX IF NOT EXISTS advisory_packs_client_idx
  ON public.advisory_packs (client_id, version DESC);
CREATE INDEX IF NOT EXISTS advisory_packs_open_idx
  ON public.advisory_packs (client_id)
  WHERE status IN ('draft', 'in_review', 'changes_requested', 'approved');

DROP TRIGGER IF EXISTS advisory_packs_touch_updated_at ON public.advisory_packs;
CREATE TRIGGER advisory_packs_touch_updated_at
  BEFORE UPDATE ON public.advisory_packs
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

COMMENT ON TABLE public.advisory_packs IS
  'Versioned advisory deliverable per client. ai_draft is immutable; content is the reviewed version. Writes only via advisory_pack_create / advisory_pack_review.';

-- ── advisory_pack_reviews (append-only) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.advisory_pack_reviews (
  id          bigserial PRIMARY KEY,
  pack_id     uuid NOT NULL REFERENCES public.advisory_packs(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  action      text NOT NULL CHECK (action IN (
                'generated', 'edit', 'comment', 'approve', 'request_changes', 'reject', 'deliver', 'supersede', 'read'
              )),
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_kind  text NOT NULL DEFAULT 'system' CHECK (actor_kind IN ('system', 'owner', 'accountant', 'service')),
  section     text,
  before      jsonb,
  after       jsonb,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advisory_pack_reviews_pack_idx
  ON public.advisory_pack_reviews (pack_id, created_at);
CREATE INDEX IF NOT EXISTS advisory_pack_reviews_client_idx
  ON public.advisory_pack_reviews (client_id, created_at DESC);

COMMENT ON TABLE public.advisory_pack_reviews IS
  'Append-only audit trail of everything done to a pack. Never updated or deleted.';

-- ── RLS: read by access; no direct writes ───────────────────────────────────

ALTER TABLE public.advisory_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisory_pack_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "advisory_packs read by access" ON public.advisory_packs;
CREATE POLICY "advisory_packs read by access"
  ON public.advisory_packs FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "advisory_pack_reviews read by access" ON public.advisory_pack_reviews;
CREATE POLICY "advisory_pack_reviews read by access"
  ON public.advisory_pack_reviews FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- ── advisory events ─────────────────────────────────────────────────────────
-- Keep in sync with ADVISORY_EVENTS / ADVISORY_TRANSITION_RULES in
-- src/lib/advisory-state.ts (test-guarded). pack.approved is the accountant's
-- review decision: accountant_review → client_decision.

ALTER TABLE public.advisory_events DROP CONSTRAINT IF EXISTS advisory_events_event_check;
ALTER TABLE public.advisory_events ADD CONSTRAINT advisory_events_event_check CHECK (event IN (
  'client.created', 'cycle.backfilled', 'cycle.restarted', 'cycle.review_due',
  'profile.completed', 'brain.question_answered',
  'data.uploaded', 'data.validated', 'data.request_opened', 'data.request_fulfilled',
  'diagnosis.reviewed', 'forecast.published',
  'recommendation.proposed', 'recommendation.approved', 'recommendation.rejected', 'recommendation.superseded',
  'review.signed_off', 'review.retracted',
  'pack.generated', 'pack.approved', 'pack.changes_requested', 'pack.rejected', 'pack.delivered',
  'action.created', 'action.started', 'action.completed', 'action.blocked',
  'outcome.recorded'
));

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
  (320, 'pack.approved', 'accountant_review', 'none', 'client_decision', false),
  (330, 'action.created', 'recommendations', 'none', 'action_execution', false),
  (340, 'action.created', 'accountant_review', 'none', 'action_execution', false),
  (350, 'action.created', 'client_decision', 'none', 'action_execution', false),
  (360, 'action.completed', 'action_execution', 'no_open_actions', 'outcome_monitoring', false),
  (370, 'cycle.review_due', 'action_execution', 'none', 'next_review', false),
  (380, 'cycle.review_due', 'outcome_monitoring', 'none', 'next_review', false),
  (390, 'cycle.restarted', '*', 'none', 'financial_data_collection', true);

-- Pack status changes → advisory events (exception-safe).
CREATE OR REPLACE FUNCTION public.advisory_trg_packs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := coalesce(auth.uid(), NEW.reviewed_by, NEW.generated_by);
  v_payload jsonb := jsonb_build_object(
    'pack_id', NEW.id, 'version', NEW.version, 'requires_review', NEW.requires_review,
    'generator', NEW.generator
  );
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.advisory_emit(NEW.client_id, 'pack.generated', v_actor, v_payload, 'advisory_packs', NEW.id);
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.advisory_emit(
        NEW.client_id, 'pack.approved', v_actor,
        v_payload || jsonb_build_object('reviewed_by_kind', NEW.reviewed_by_kind, 'edit_stats', NEW.edit_stats),
        'advisory_packs', NEW.id
      );
    ELSIF NEW.status = 'changes_requested' THEN
      PERFORM public.advisory_emit(NEW.client_id, 'pack.changes_requested', v_actor, v_payload, 'advisory_packs', NEW.id);
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.advisory_emit(NEW.client_id, 'pack.rejected', v_actor, v_payload, 'advisory_packs', NEW.id);
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.delivered_at IS NULL AND NEW.delivered_at IS NOT NULL THEN
    PERFORM public.advisory_emit(
      NEW.client_id, 'pack.delivered', v_actor,
      v_payload || jsonb_build_object('delivered_to', NEW.delivered_to), 'advisory_packs', NEW.id
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_trg_packs failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advisory_packs ON public.advisory_packs;
CREATE TRIGGER trg_advisory_packs
  AFTER INSERT OR UPDATE ON public.advisory_packs
  FOR EACH ROW EXECUTE FUNCTION public.advisory_trg_packs();

-- ── RPC: create a pack (supersedes any open one) ────────────────────────────

CREATE OR REPLACE FUNCTION public.advisory_pack_create(
  p_client_id     uuid,
  p_content       jsonb,
  p_period_label  text DEFAULT NULL,
  p_figures_as_of date DEFAULT NULL,
  p_snapshot_id   uuid DEFAULT NULL,
  p_generator     text DEFAULT 'rules'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_firm     uuid;
  v_cycle    uuid;
  v_version  integer;
  v_id       uuid;
  v_status   text;
  v_requires boolean;
  r          record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_action_plan_writer(v_uid, p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client';
  END IF;
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' THEN
    RAISE EXCEPTION 'Pack content must be a JSON object';
  END IF;

  SELECT c.firm_id, c.advisory_cycle_id INTO v_firm, v_cycle
  FROM public.clients c WHERE c.id = p_client_id FOR UPDATE;

  v_requires := v_firm IS NOT NULL;
  v_status := CASE WHEN v_requires THEN 'in_review' ELSE 'draft' END;

  -- Anything still open is superseded by the new version.
  FOR r IN
    SELECT id, status FROM public.advisory_packs
    WHERE client_id = p_client_id AND status IN ('draft', 'in_review', 'changes_requested', 'approved')
  LOOP
    UPDATE public.advisory_packs SET status = 'superseded' WHERE id = r.id;
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, before, note)
    VALUES (r.id, p_client_id, 'supersede', v_uid, public.advisory_actor_kind(v_uid),
            jsonb_build_object('status', r.status), 'Superseded by a newer version');
  END LOOP;

  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.advisory_packs WHERE client_id = p_client_id;

  INSERT INTO public.advisory_packs (
    client_id, cycle_id, version, status, requires_review, period_label, figures_as_of,
    snapshot_id, generator, ai_draft, content, generated_by
  ) VALUES (
    p_client_id, v_cycle, v_version, v_status, v_requires, p_period_label, p_figures_as_of,
    p_snapshot_id, coalesce(p_generator, 'rules'), p_content, p_content, v_uid
  )
  RETURNING id INTO v_id;

  INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, after, note)
  VALUES (v_id, p_client_id, 'generated', v_uid, public.advisory_actor_kind(v_uid),
          jsonb_build_object('version', v_version, 'status', v_status, 'requires_review', v_requires),
          NULL);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.advisory_pack_create(uuid, jsonb, text, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advisory_pack_create(uuid, jsonb, text, date, uuid, text) TO authenticated, service_role;

-- ── RPC: one review action (audit row + state change, atomically) ───────────
--   edit            p_section + p_after (new section object) — writer only
--   comment         p_note — anyone with access
--   approve         accountant seat when requires_review, else owner/writer
--   request_changes accountant seat only (needs a firm)
--   reject          accountant seat when requires_review, else writer
--   deliver         writer; stamps delivered_at (+ p_note = recipient)
--   read            anyone with access; first owner read stamps delivered_at

CREATE OR REPLACE FUNCTION public.advisory_pack_review(
  p_pack_id  uuid,
  p_action   text,
  p_section  text DEFAULT NULL,
  p_after    jsonb DEFAULT NULL,
  p_note     text DEFAULT NULL,
  p_edit_stats jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_pack       record;
  v_kind       text;
  v_is_writer  boolean;
  v_is_firm    boolean;
  v_is_owner   boolean;
  v_before     jsonb;
  v_sections   jsonb;
  v_new        jsonb;
  v_idx        integer;
  v_found      boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.*, c.firm_id, c.owner_user_id
    INTO v_pack
  FROM public.advisory_packs p
  JOIN public.clients c ON c.id = p.client_id
  WHERE p.id = p_pack_id
  FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pack not found';
  END IF;
  IF NOT public.has_client_access(v_uid, v_pack.client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client';
  END IF;

  v_is_writer := public.is_action_plan_writer(v_uid, v_pack.client_id);
  v_is_firm   := v_pack.firm_id IS NOT NULL AND public.is_firm_member(v_uid, v_pack.firm_id);
  v_is_owner  := v_pack.owner_user_id = v_uid;
  v_kind      := public.advisory_actor_kind(v_uid);

  IF p_action NOT IN ('edit', 'comment', 'approve', 'request_changes', 'reject', 'deliver', 'read') THEN
    RAISE EXCEPTION 'Unknown pack action %', p_action;
  END IF;

  IF p_action = 'comment' THEN
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, section, note)
    VALUES (p_pack_id, v_pack.client_id, 'comment', v_uid, v_kind, p_section, p_note);
    RETURN jsonb_build_object('status', v_pack.status);
  END IF;

  IF p_action = 'read' THEN
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind)
    VALUES (p_pack_id, v_pack.client_id, 'read', v_uid, v_kind);
    -- The owner opening an approved pack is delivery.
    IF v_is_owner AND v_pack.status = 'approved' AND v_pack.delivered_at IS NULL THEN
      UPDATE public.advisory_packs
         SET delivered_at = now(), delivered_to = coalesce(p_note, 'owner (in-app)')
       WHERE id = p_pack_id;
    END IF;
    RETURN jsonb_build_object('status', v_pack.status);
  END IF;

  IF v_pack.status IN ('superseded', 'rejected') THEN
    RAISE EXCEPTION 'Pack v% is %; generate a new version instead', v_pack.version, v_pack.status;
  END IF;

  IF p_action = 'edit' THEN
    IF NOT v_is_writer THEN
      RAISE EXCEPTION 'Only the owner or the firm can edit the pack';
    END IF;
    IF v_pack.status = 'approved' THEN
      RAISE EXCEPTION 'An approved pack is final; generate a new version to change it';
    END IF;
    IF p_section IS NULL OR p_after IS NULL OR jsonb_typeof(p_after) <> 'object' THEN
      RAISE EXCEPTION 'edit needs p_section and an object p_after';
    END IF;
    v_sections := coalesce(v_pack.content->'sections', '[]'::jsonb);
    v_new := '[]'::jsonb;
    FOR v_idx IN 0 .. jsonb_array_length(v_sections) - 1 LOOP
      IF v_sections->v_idx->>'key' = p_section THEN
        v_before := v_sections->v_idx;
        -- key is immutable; body / bullets / title are what gets edited
        v_new := v_new || (v_sections->v_idx || p_after || jsonb_build_object('key', p_section));
        v_found := true;
      ELSE
        v_new := v_new || (v_sections->v_idx);
      END IF;
    END LOOP;
    IF NOT v_found THEN
      RAISE EXCEPTION 'Section % not found in pack', p_section;
    END IF;
    UPDATE public.advisory_packs
       SET content = jsonb_set(content, '{sections}', v_new),
           edit_stats = coalesce(p_edit_stats, edit_stats)
     WHERE id = p_pack_id;
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, section, before, after, note)
    VALUES (p_pack_id, v_pack.client_id, 'edit', v_uid, v_kind, p_section, v_before, p_after, p_note);
    RETURN jsonb_build_object('status', v_pack.status);
  END IF;

  IF p_action IN ('approve', 'reject') THEN
    IF v_pack.requires_review AND NOT v_is_firm THEN
      RAISE EXCEPTION 'This pack needs the accountant''s sign-off';
    END IF;
    IF NOT v_pack.requires_review AND NOT v_is_writer THEN
      RAISE EXCEPTION 'Only the owner can accept this pack';
    END IF;
    IF v_pack.status = 'approved' THEN
      RAISE EXCEPTION 'Pack v% is already approved', v_pack.version;
    END IF;
    UPDATE public.advisory_packs
       SET status = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
           reviewed_by = v_uid,
           reviewed_by_kind = CASE WHEN v_is_firm THEN 'accountant' ELSE 'owner' END,
           reviewed_at = now(),
           review_note = p_note,
           edit_stats = coalesce(p_edit_stats, edit_stats)
     WHERE id = p_pack_id;
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, before, after, note)
    VALUES (p_pack_id, v_pack.client_id, p_action, v_uid, v_kind,
            jsonb_build_object('status', v_pack.status),
            jsonb_build_object('status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
                               'edit_stats', coalesce(p_edit_stats, v_pack.edit_stats)),
            p_note);
    RETURN jsonb_build_object('status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END);
  END IF;

  IF p_action = 'request_changes' THEN
    IF NOT v_is_firm THEN
      RAISE EXCEPTION 'Only the firm can request changes';
    END IF;
    UPDATE public.advisory_packs
       SET status = 'changes_requested', reviewed_by = v_uid, reviewed_by_kind = 'accountant',
           reviewed_at = now(), review_note = p_note
     WHERE id = p_pack_id;
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, section, before, after, note)
    VALUES (p_pack_id, v_pack.client_id, 'request_changes', v_uid, v_kind, p_section,
            jsonb_build_object('status', v_pack.status), jsonb_build_object('status', 'changes_requested'), p_note);
    RETURN jsonb_build_object('status', 'changes_requested');
  END IF;

  IF p_action = 'deliver' THEN
    IF NOT v_is_writer THEN
      RAISE EXCEPTION 'Only the owner or the firm can deliver the pack';
    END IF;
    IF v_pack.status <> 'approved' THEN
      RAISE EXCEPTION 'Only an approved pack can be delivered';
    END IF;
    UPDATE public.advisory_packs
       SET delivered_at = coalesce(delivered_at, now()), delivered_to = coalesce(p_note, delivered_to, 'owner')
     WHERE id = p_pack_id;
    INSERT INTO public.advisory_pack_reviews (pack_id, client_id, action, actor_id, actor_kind, after, note)
    VALUES (p_pack_id, v_pack.client_id, 'deliver', v_uid, v_kind, jsonb_build_object('delivered_to', p_note), p_note);
    RETURN jsonb_build_object('status', v_pack.status, 'delivered', true);
  END IF;

  RETURN jsonb_build_object('status', v_pack.status);
END;
$$;

REVOKE ALL ON FUNCTION public.advisory_pack_review(uuid, text, text, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advisory_pack_review(uuid, text, text, jsonb, text, jsonb) TO authenticated, service_role;
