-- ============================================================================
-- MILŌN advisory OS — P0.2 recommendation + outcome data model (additive only)
--
-- Run AFTER 20260918120000_advisory_state.sql.
--
-- The recommendation object is the EXISTING public.proposed_next_steps table,
-- extended in place (same RLS, same Client Brain UI keeps working). This adds:
--   * problem / evidence / priority / confidence / data_depth / expected impact
--   * cycle_id (defaults to the client's open advisory cycle on insert)
--   * status 'superseded' + superseded_by
--   * decided_at / decided_by (owner or accountant decision — sign-off columns
--     stay accountant-only)
--   * action_items.recommendation_id (nullable FK; legacy linked_action_item_id
--     is kept in sync both ways)
--   * public.recommendation_outcomes — expected vs actual impact per recommendation
--   * RPC advisory_create_action_from_recommendation — the default path from an
--     approved recommendation to a chased action_item
--   * advisory events: recommendation.superseded, outcome.recorded
-- ============================================================================

-- ── proposed_next_steps → recommendation object ─────────────────────────────

ALTER TABLE public.proposed_next_steps
  ADD COLUMN IF NOT EXISTS cycle_id                     uuid REFERENCES public.advisory_cycles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS problem                      text,
  ADD COLUMN IF NOT EXISTS evidence                     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS priority                     text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS confidence                   numeric,
  ADD COLUMN IF NOT EXISTS data_depth                   text NOT NULL DEFAULT 'statement',
  ADD COLUMN IF NOT EXISTS expected_impact_metric       text,
  ADD COLUMN IF NOT EXISTS expected_impact_amount       numeric,
  ADD COLUMN IF NOT EXISTS expected_impact_horizon_days integer,
  ADD COLUMN IF NOT EXISTS expected_impact_note         text,
  ADD COLUMN IF NOT EXISTS source                       text NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS superseded_by                uuid REFERENCES public.proposed_next_steps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at                   timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by                   uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.proposed_next_steps DROP CONSTRAINT IF EXISTS proposed_next_steps_status_check;
ALTER TABLE public.proposed_next_steps ADD CONSTRAINT proposed_next_steps_status_check
  CHECK (status IN ('proposed', 'approved', 'edited', 'rejected', 'superseded'));

ALTER TABLE public.proposed_next_steps DROP CONSTRAINT IF EXISTS proposed_next_steps_priority_check;
ALTER TABLE public.proposed_next_steps ADD CONSTRAINT proposed_next_steps_priority_check
  CHECK (priority IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE public.proposed_next_steps DROP CONSTRAINT IF EXISTS proposed_next_steps_confidence_check;
ALTER TABLE public.proposed_next_steps ADD CONSTRAINT proposed_next_steps_confidence_check
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));

ALTER TABLE public.proposed_next_steps DROP CONSTRAINT IF EXISTS proposed_next_steps_data_depth_check;
ALTER TABLE public.proposed_next_steps ADD CONSTRAINT proposed_next_steps_data_depth_check
  CHECK (data_depth IN ('statement', 'transaction'));

ALTER TABLE public.proposed_next_steps DROP CONSTRAINT IF EXISTS proposed_next_steps_impact_metric_check;
ALTER TABLE public.proposed_next_steps ADD CONSTRAINT proposed_next_steps_impact_metric_check
  CHECK (expected_impact_metric IS NULL OR expected_impact_metric IN (
    'cash', 'profit', 'revenue', 'gross_margin', 'debtor_days', 'creditor_days', 'stock_days', 'other'
  ));

ALTER TABLE public.proposed_next_steps DROP CONSTRAINT IF EXISTS proposed_next_steps_impact_horizon_check;
ALTER TABLE public.proposed_next_steps ADD CONSTRAINT proposed_next_steps_impact_horizon_check
  CHECK (expected_impact_horizon_days IS NULL OR expected_impact_horizon_days > 0);

ALTER TABLE public.proposed_next_steps DROP CONSTRAINT IF EXISTS proposed_next_steps_source_check;
ALTER TABLE public.proposed_next_steps ADD CONSTRAINT proposed_next_steps_source_check
  CHECK (source IN ('ai', 'accountant', 'owner', 'system'));

CREATE INDEX IF NOT EXISTS proposed_next_steps_cycle_idx
  ON public.proposed_next_steps (cycle_id, status);

COMMENT ON COLUMN public.proposed_next_steps.problem IS
  'Diagnosed problem this recommendation addresses (one sentence, grounded in evidence).';
COMMENT ON COLUMN public.proposed_next_steps.evidence IS
  'Array of {kind: ratio|pillar|forecast|fact|transaction, key, value, label, snapshot_id}. What the recommendation rests on.';
COMMENT ON COLUMN public.proposed_next_steps.data_depth IS
  'statement = built from period totals (no invoice/customer claims allowed); transaction = ledger-level evidence exists.';
COMMENT ON COLUMN public.proposed_next_steps.expected_impact_amount IS
  'Signed amount in the client currency over expected_impact_horizon_days (positive = improvement).';
COMMENT ON COLUMN public.proposed_next_steps.decided_at IS
  'When the recommendation was approved/rejected by owner or accountant (sign-off columns remain accountant-only).';

-- Default cycle_id to the client's open advisory cycle so every recommendation
-- is born inside a cycle without the app having to know about cycles yet.
CREATE OR REPLACE FUNCTION public.recommendation_default_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cycle_id IS NULL THEN
    SELECT c.advisory_cycle_id INTO NEW.cycle_id FROM public.clients c WHERE c.id = NEW.client_id;
  END IF;
  IF NEW.status IN ('approved', 'edited', 'rejected') AND NEW.decided_at IS NULL THEN
    NEW.decided_at := now();
    NEW.decided_by := coalesce(NEW.decided_by, auth.uid(), NEW.signed_off_by_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposed_next_steps_default_cycle ON public.proposed_next_steps;
CREATE TRIGGER proposed_next_steps_default_cycle
  BEFORE INSERT ON public.proposed_next_steps
  FOR EACH ROW EXECUTE FUNCTION public.recommendation_default_cycle();

-- Stamp the decision on status change (owner approvals have no sign-off row).
CREATE OR REPLACE FUNCTION public.recommendation_stamp_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('approved', 'edited', 'rejected', 'superseded') THEN
    NEW.decided_at := coalesce(NEW.decided_at, now());
    NEW.decided_by := coalesce(NEW.decided_by, auth.uid(), NEW.signed_off_by_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposed_next_steps_stamp_decision ON public.proposed_next_steps;
CREATE TRIGGER proposed_next_steps_stamp_decision
  BEFORE UPDATE ON public.proposed_next_steps
  FOR EACH ROW EXECUTE FUNCTION public.recommendation_stamp_decision();

-- ── action_items.recommendation_id ──────────────────────────────────────────

ALTER TABLE public.action_items
  ADD COLUMN IF NOT EXISTS recommendation_id uuid REFERENCES public.proposed_next_steps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS action_items_recommendation_idx
  ON public.action_items (recommendation_id)
  WHERE recommendation_id IS NOT NULL;

COMMENT ON COLUMN public.action_items.recommendation_id IS
  'Parent recommendation (proposed_next_steps.id). Null for manual / strategic-move tasks.';

-- Backfill from the legacy one-to-one pointer.
UPDATE public.action_items ai
   SET recommendation_id = p.id
  FROM public.proposed_next_steps p
 WHERE p.linked_action_item_id = ai.id
   AND ai.recommendation_id IS NULL;

-- Keep the legacy pointer coherent: first action linked becomes linked_action_item_id.
CREATE OR REPLACE FUNCTION public.action_item_sync_recommendation_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.recommendation_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.recommendation_id IS DISTINCT FROM NEW.recommendation_id) THEN
    UPDATE public.proposed_next_steps
       SET linked_action_item_id = NEW.id
     WHERE id = NEW.recommendation_id
       AND linked_action_item_id IS NULL;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'action_item_sync_recommendation_link failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_action_item_sync_recommendation_link ON public.action_items;
CREATE TRIGGER trg_action_item_sync_recommendation_link
  AFTER INSERT OR UPDATE OF recommendation_id ON public.action_items
  FOR EACH ROW EXECUTE FUNCTION public.action_item_sync_recommendation_link();

-- ── recommendation_outcomes ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recommendation_outcomes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  recommendation_id    uuid NOT NULL REFERENCES public.proposed_next_steps(id) ON DELETE CASCADE,
  cycle_id             uuid REFERENCES public.advisory_cycles(id) ON DELETE SET NULL,
  metric               text NOT NULL CHECK (metric IN (
                         'cash', 'profit', 'revenue', 'gross_margin', 'debtor_days', 'creditor_days', 'stock_days', 'other'
                       )),
  expected_amount      numeric,
  actual_amount        numeric,
  variance_amount      numeric GENERATED ALWAYS AS (actual_amount - expected_amount) STORED,
  method               text NOT NULL DEFAULT 'manual' CHECK (method IN ('snapshot_diff', 'forecast_vs_actual', 'manual')),
  baseline_snapshot_id uuid REFERENCES public.client_financial_snapshots(id) ON DELETE SET NULL,
  measured_snapshot_id uuid REFERENCES public.client_financial_snapshots(id) ON DELETE SET NULL,
  period_label         text,
  measured_at          timestamptz NOT NULL DEFAULT now(),
  notes                text,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recommendation_outcomes_client_idx
  ON public.recommendation_outcomes (client_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS recommendation_outcomes_rec_idx
  ON public.recommendation_outcomes (recommendation_id, measured_at DESC);

DROP TRIGGER IF EXISTS recommendation_outcomes_touch_updated_at ON public.recommendation_outcomes;
CREATE TRIGGER recommendation_outcomes_touch_updated_at
  BEFORE UPDATE ON public.recommendation_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

COMMENT ON TABLE public.recommendation_outcomes IS
  'Expected vs actual impact of a recommendation. One row per measurement; latest measured_at wins for display.';

ALTER TABLE public.recommendation_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outcomes read by access" ON public.recommendation_outcomes;
CREATE POLICY "outcomes read by access"
  ON public.recommendation_outcomes FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "outcomes insert by access" ON public.recommendation_outcomes;
CREATE POLICY "outcomes insert by access"
  ON public.recommendation_outcomes FOR INSERT TO authenticated
  WITH CHECK (
    (created_by IS NULL OR created_by = auth.uid())
    AND public.has_client_access(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "outcomes update by access" ON public.recommendation_outcomes;
CREATE POLICY "outcomes update by access"
  ON public.recommendation_outcomes FOR UPDATE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id))
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

-- No delete policy: outcomes are measurements; correct them with an UPDATE.

-- Default cycle + client from the recommendation.
CREATE OR REPLACE FUNCTION public.recommendation_outcome_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
BEGIN
  SELECT p.client_id, p.cycle_id, p.expected_impact_metric, p.expected_impact_amount
    INTO v_rec
  FROM public.proposed_next_steps p
  WHERE p.id = NEW.recommendation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recommendation % not found', NEW.recommendation_id;
  END IF;
  IF NEW.client_id IS DISTINCT FROM v_rec.client_id THEN
    RAISE EXCEPTION 'outcome client_id does not match the recommendation';
  END IF;
  NEW.cycle_id := coalesce(NEW.cycle_id, v_rec.cycle_id);
  IF NEW.expected_amount IS NULL AND NEW.metric = v_rec.expected_impact_metric THEN
    NEW.expected_amount := v_rec.expected_impact_amount;
  END IF;
  NEW.created_by := coalesce(NEW.created_by, auth.uid());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recommendation_outcomes_defaults ON public.recommendation_outcomes;
CREATE TRIGGER recommendation_outcomes_defaults
  BEFORE INSERT ON public.recommendation_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.recommendation_outcome_defaults();

-- ── advisory events: new audit-only events ──────────────────────────────────
-- Keep in sync with ADVISORY_EVENTS in src/lib/advisory-state.ts (test-guarded).

ALTER TABLE public.advisory_events DROP CONSTRAINT IF EXISTS advisory_events_event_check;
ALTER TABLE public.advisory_events ADD CONSTRAINT advisory_events_event_check CHECK (event IN (
  'client.created', 'cycle.backfilled', 'cycle.restarted', 'cycle.review_due',
  'profile.completed', 'brain.question_answered',
  'data.uploaded', 'data.validated', 'data.request_opened', 'data.request_fulfilled',
  'diagnosis.reviewed', 'forecast.published',
  'recommendation.proposed', 'recommendation.approved', 'recommendation.rejected', 'recommendation.superseded',
  'review.signed_off', 'review.retracted',
  'action.created', 'action.started', 'action.completed', 'action.blocked',
  'outcome.recorded'
));

-- Redefine the next-steps trigger to also emit recommendation.superseded and
-- carry priority / impact metric in the payload.
CREATE OR REPLACE FUNCTION public.advisory_trg_next_steps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := coalesce(auth.uid(), NEW.decided_by, NEW.signed_off_by_id, NEW.created_by);
  v_payload jsonb := jsonb_build_object(
    'priority', NEW.priority,
    'metric', NEW.expected_impact_metric,
    'data_depth', NEW.data_depth,
    'source', NEW.source
  );
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.advisory_emit(
      NEW.client_id, 'recommendation.proposed', v_actor,
      v_payload || jsonb_build_object('title', left(NEW.title, 120)), 'proposed_next_steps', NEW.id
    );
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status IN ('approved', 'edited') THEN
      PERFORM public.advisory_emit(
        NEW.client_id, 'recommendation.approved', v_actor,
        v_payload || jsonb_build_object('status', NEW.status), 'proposed_next_steps', NEW.id
      );
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.advisory_emit(
        NEW.client_id, 'recommendation.rejected', v_actor, v_payload, 'proposed_next_steps', NEW.id
      );
    ELSIF NEW.status = 'superseded' THEN
      PERFORM public.advisory_emit(
        NEW.client_id, 'recommendation.superseded', v_actor,
        v_payload || jsonb_build_object('superseded_by', NEW.superseded_by), 'proposed_next_steps', NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_trg_next_steps failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.advisory_trg_outcomes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.advisory_emit(
    NEW.client_id, 'outcome.recorded', coalesce(auth.uid(), NEW.created_by),
    jsonb_build_object(
      'recommendation_id', NEW.recommendation_id,
      'metric', NEW.metric,
      'method', NEW.method,
      'measured', NEW.actual_amount IS NOT NULL
    ),
    'recommendation_outcomes', NEW.id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_trg_outcomes failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advisory_outcomes ON public.recommendation_outcomes;
CREATE TRIGGER trg_advisory_outcomes
  AFTER INSERT ON public.recommendation_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.advisory_trg_outcomes();

-- Action trigger: carry the parent recommendation in the event payload.
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
    jsonb_build_object(
      'open_actions', v_open,
      'status', NEW.status::text,
      'recommendation_id', NEW.recommendation_id
    ),
    'action_items', NEW.id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_trg_action_items failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ── RPC: approved recommendation → action_item (default path) ──────────────

CREATE OR REPLACE FUNCTION public.advisory_create_action_from_recommendation(
  p_recommendation_id uuid,
  p_title             text DEFAULT NULL,
  p_due_date          date DEFAULT NULL,
  p_owner_id          uuid DEFAULT NULL,
  p_approve           boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_rec     record;
  v_plan_id uuid;
  v_seq     integer;
  v_item_id uuid;
  v_q       integer := extract(quarter FROM now())::integer;
  v_y       integer := extract(year FROM now())::integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.id, p.client_id, p.title, p.rationale, p.problem, p.status
    INTO v_rec
  FROM public.proposed_next_steps p
  WHERE p.id = p_recommendation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recommendation not found';
  END IF;
  -- SECURITY DEFINER bypasses the action_items RLS, so apply the same
  -- owner-or-firm boundary those policies use (invited members can read
  -- the plan but never write it).
  IF NOT public.is_action_plan_writer(v_uid, v_rec.client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client';
  END IF;

  IF v_rec.status = 'proposed' AND p_approve THEN
    UPDATE public.proposed_next_steps
       SET status = 'approved', decided_at = now(), decided_by = v_uid
     WHERE id = v_rec.id;
    v_rec.status := 'approved';
  END IF;
  IF v_rec.status NOT IN ('approved', 'edited') THEN
    RAISE EXCEPTION 'Recommendation must be approved before it becomes an action (status: %)', v_rec.status;
  END IF;

  -- Find or create the active plan (same defaults as the Action Plan tab).
  SELECT ap.id INTO v_plan_id
  FROM public.action_plans ap
  WHERE ap.client_id = v_rec.client_id AND ap.is_active
  ORDER BY ap.created_at DESC
  LIMIT 1;
  IF v_plan_id IS NULL THEN
    INSERT INTO public.action_plans (client_id, period_label, outcome_goal, target_date)
    VALUES (
      v_rec.client_id,
      'Q' || v_q || ' ' || v_y,
      'Set your outcome goal for this quarter',
      (make_date(v_y, v_q * 3, 1) + interval '1 month' - interval '1 day')::date
    )
    RETURNING id INTO v_plan_id;
  END IF;

  SELECT coalesce(max(ai.seq), 0) + 1 INTO v_seq FROM public.action_items ai WHERE ai.plan_id = v_plan_id;

  INSERT INTO public.action_items (
    plan_id, client_id, seq, title, outcome_why, owner_id, due_date, source, recommendation_id
  ) VALUES (
    v_plan_id, v_rec.client_id, v_seq,
    coalesce(nullif(trim(p_title), ''), v_rec.title),
    coalesce(v_rec.problem, v_rec.rationale),
    p_owner_id, p_due_date, 'manual', v_rec.id
  )
  RETURNING id INTO v_item_id;

  RETURN v_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.advisory_create_action_from_recommendation(uuid, text, date, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advisory_create_action_from_recommendation(uuid, text, date, uuid, boolean) TO authenticated, service_role;
