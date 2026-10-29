-- Figure proposals from the Financial Manager.
--
-- One table for cash (clients.cashflow), budget (clients.budget), and the
-- profitability waterfall (period P&L on clients.financials).
-- The agent inserts a pending row (service role). A person confirms with
-- apply_figure_proposal(id, true). That is the only write from this path.
-- Passing confirm false raises and changes nothing.
-- reject_figure_proposal does not update clients.
--
-- Apply order: after 20261027120000_client_deliverable_inputs.sql. This
-- file does not read deliverable_inputs. It needs public.clients,
-- public.agent_runs, public.is_client_writer, and public.has_client_access.
-- Chief of Staff applies this file in the SQL editor. It is not wired
-- into the CI apply script. Run it once.

CREATE TABLE IF NOT EXISTS public.figure_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id uuid REFERENCES public.firms(id) ON DELETE SET NULL,
  proposed_by text NOT NULL,
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  surface text NOT NULL,
  patch jsonb NOT NULL,
  before_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  applied_at timestamptz,
  CONSTRAINT figure_proposals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  CONSTRAINT figure_proposals_surface_check
    CHECK (surface IN ('cash', 'budget', 'waterfall')),
  CONSTRAINT figure_proposals_proposed_by_check
    CHECK (proposed_by = 'financial_manager'),
  CONSTRAINT figure_proposals_patch_object
    CHECK (jsonb_typeof(patch) = 'object' AND patch <> '{}'::jsonb)
);

CREATE INDEX IF NOT EXISTS figure_proposals_client_pending_idx
  ON public.figure_proposals (client_id, surface, created_at DESC)
  WHERE status = 'pending';

COMMENT ON TABLE public.figure_proposals IS
  'Pending cash, budget, or waterfall adjustments from the Financial Manager. The stored figures change only when a person confirms.';
COMMENT ON COLUMN public.figure_proposals.surface IS
  'cash → clients.cashflow. budget → clients.budget. waterfall → clients.financials (the period P&L the waterfall reads).';
COMMENT ON COLUMN public.figure_proposals.status IS
  'pending until a person decides. approved is a held yes. rejected leaves the stored figures unchanged. applied means the patch was written.';

ALTER TABLE public.figure_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "figure proposals read by access" ON public.figure_proposals;
CREATE POLICY "figure proposals read by access"
  ON public.figure_proposals
  FOR SELECT
  TO authenticated
  USING (public.has_client_access((select auth.uid()), client_id));

REVOKE ALL ON TABLE public.figure_proposals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.figure_proposals TO authenticated;
GRANT ALL ON TABLE public.figure_proposals TO service_role;

CREATE OR REPLACE FUNCTION public.figure_normalize_patch(p_surface text, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_allowed text[];
  v_out jsonb := '{}'::jsonb;
  v_num numeric;
BEGIN
  IF p_surface = 'cash' THEN
    v_allowed := ARRAY[
      'openingBalance', 'revAdj', 'expAdj', 'collectDelay', 'headcountDelta',
      'avgSalary', 'fixedCostDelta', 'revGrowthPct', 'capexAmount', 'capexWeek'
    ];
  ELSIF p_surface = 'budget' THEN
    v_allowed := ARRAY['openingCash', 'gpPct', 'debtorDays', 'creditorDays', 'inventoryDays'];
  ELSIF p_surface = 'waterfall' THEN
    v_allowed := ARRAY['revenue', 'cogs', 'grossProfit', 'fixedCosts', 'ebit', 'interest', 'tax', 'netIncome'];
  ELSE
    RAISE EXCEPTION 'figure_surface_invalid';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'figure_patch_invalid';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'figure_patch_key';
    END IF;
    BEGIN
      v_num := (p_patch ->> v_key)::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'figure_patch_value';
    END;
    IF v_num IS NULL THEN
      RAISE EXCEPTION 'figure_patch_value';
    END IF;

    IF p_surface = 'cash' AND v_key = 'revAdj' AND (v_num < 50 OR v_num > 150) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key = 'expAdj' AND (v_num < 50 OR v_num > 150) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key = 'collectDelay' AND (v_num <> trunc(v_num) OR v_num < 0 OR v_num > 6) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key = 'headcountDelta' AND (v_num <> trunc(v_num) OR v_num < -100 OR v_num > 100) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key = 'revGrowthPct' AND (v_num < -10 OR v_num > 10) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key = 'capexWeek' AND (v_num <> trunc(v_num) OR v_num < 1 OR v_num > 13) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key IN ('avgSalary', 'capexAmount') AND v_num < 0 THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'budget' AND v_key = 'gpPct' AND (v_num < 0 OR v_num > 100) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'budget' AND v_key IN ('debtorDays', 'creditorDays', 'inventoryDays')
      AND (v_num <> trunc(v_num) OR v_num < 0 OR v_num > 365) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'waterfall' AND v_key IN ('revenue', 'cogs', 'fixedCosts') AND v_num < 0 THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF abs(v_num) > 1000000000000 THEN
      RAISE EXCEPTION 'figure_patch_value';
    END IF;

    IF p_surface = 'cash' AND v_key IN ('openingBalance', 'avgSalary', 'fixedCostDelta', 'capexAmount') THEN
      v_out := v_out || jsonb_build_object(v_key, to_jsonb((round(v_num, 2))::text));
    ELSIF p_surface = 'cash' AND v_key IN ('collectDelay', 'headcountDelta', 'capexWeek') THEN
      v_out := v_out || jsonb_build_object(v_key, to_jsonb(v_num::int));
    ELSIF p_surface = 'budget' AND v_key IN ('debtorDays', 'creditorDays', 'inventoryDays') THEN
      v_out := v_out || jsonb_build_object(v_key, to_jsonb(v_num::int));
    ELSE
      v_out := v_out || jsonb_build_object(v_key, to_jsonb(round(v_num, 2)));
    END IF;
  END LOOP;

  IF v_out = '{}'::jsonb THEN
    RAISE EXCEPTION 'figure_patch_empty';
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.figure_normalize_patch(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_figure_proposal(p_id uuid, p_confirm boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.figure_proposals%ROWTYPE;
  v_patch jsonb;
  v_cash jsonb;
  v_budget jsonb;
  v_fin jsonb;
  v_wc jsonb;
  v_next jsonb;
  v_at timestamptz := now();
BEGIN
  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'figure_confirm_required';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'figure_not_allowed';
  END IF;

  SELECT * INTO v_row
  FROM public.figure_proposals
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'figure_proposal_missing';
  END IF;
  IF NOT public.is_client_writer(v_uid, v_row.client_id) THEN
    RAISE EXCEPTION 'figure_not_allowed';
  END IF;
  IF v_row.status = 'applied' THEN
    RAISE EXCEPTION 'figure_already_applied';
  END IF;
  IF v_row.status <> 'pending' AND v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'figure_not_pending';
  END IF;

  v_patch := public.figure_normalize_patch(v_row.surface, v_row.patch);

  IF v_row.surface = 'cash' THEN
    SELECT COALESCE(cashflow, '{}'::jsonb) INTO v_cash
    FROM public.clients
    WHERE id = v_row.client_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'figure_proposal_missing';
    END IF;
    v_next := COALESCE(v_cash, '{}'::jsonb) || v_patch || jsonb_build_object(
      'confirmedForecastAdjustments',
      jsonb_build_object(
        'proposalId', v_row.id,
        'appliedAt', v_at,
        'appliedBy', v_uid,
        'patch', v_patch
      )
    );
    UPDATE public.clients
    SET cashflow = v_next,
        last_forecast_at = v_at
    WHERE id = v_row.client_id;
  ELSIF v_row.surface = 'budget' THEN
    SELECT budget INTO v_budget
    FROM public.clients
    WHERE id = v_row.client_id
    FOR UPDATE;
    IF NOT FOUND OR v_budget IS NULL OR COALESCE(v_budget ->> 'version', '') <> '1' THEN
      RAISE EXCEPTION 'figure_budget_missing';
    END IF;
    v_wc := CASE
      WHEN jsonb_typeof(v_budget -> 'wc') = 'object' THEN v_budget -> 'wc'
      ELSE '{}'::jsonb
    END;
    IF v_patch ? 'debtorDays' THEN
      v_wc := v_wc || jsonb_build_object('debtorDays', v_patch -> 'debtorDays');
    END IF;
    IF v_patch ? 'creditorDays' THEN
      v_wc := v_wc || jsonb_build_object('creditorDays', v_patch -> 'creditorDays');
    END IF;
    IF v_patch ? 'inventoryDays' THEN
      v_wc := v_wc || jsonb_build_object('inventoryDays', v_patch -> 'inventoryDays');
    END IF;
    v_next := v_budget || jsonb_build_object('wc', v_wc, 'updatedAt', v_at);
    v_next := v_next - 'debtorDays' - 'creditorDays' - 'inventoryDays';
    IF v_patch ? 'openingCash' THEN
      v_next := v_next || jsonb_build_object('openingCash', v_patch -> 'openingCash');
    END IF;
    IF v_patch ? 'gpPct' THEN
      v_next := v_next || jsonb_build_object('gpPct', v_patch -> 'gpPct');
    END IF;
    UPDATE public.clients
    SET budget = v_next,
        budget_updated_at = v_at
    WHERE id = v_row.client_id;
  ELSE
    SELECT COALESCE(financials, '{}'::jsonb) INTO v_fin
    FROM public.clients
    WHERE id = v_row.client_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'figure_proposal_missing';
    END IF;
    v_next := COALESCE(v_fin, '{}'::jsonb) || v_patch;
    UPDATE public.clients
    SET financials = v_next,
        financials_updated_at = v_at
    WHERE id = v_row.client_id;
  END IF;

  UPDATE public.figure_proposals
  SET status = 'applied',
      patch = v_patch,
      decided_by = v_uid,
      decided_at = v_at,
      applied_at = v_at
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'status', 'applied',
    'proposal_id', v_row.id,
    'client_id', v_row.client_id,
    'surface', v_row.surface,
    'cashflow', CASE WHEN v_row.surface = 'cash' THEN v_next ELSE NULL END,
    'budget', CASE WHEN v_row.surface = 'budget' THEN v_next ELSE NULL END,
    'financials', CASE WHEN v_row.surface = 'waterfall' THEN v_next ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_figure_proposal(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_figure_proposal(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_figure_proposal(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.figure_proposals%ROWTYPE;
  v_at timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'figure_not_allowed';
  END IF;

  SELECT * INTO v_row
  FROM public.figure_proposals
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'figure_proposal_missing';
  END IF;
  IF NOT public.is_client_writer(v_uid, v_row.client_id) THEN
    RAISE EXCEPTION 'figure_not_allowed';
  END IF;
  IF v_row.status <> 'pending' AND v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'figure_not_pending';
  END IF;

  UPDATE public.figure_proposals
  SET status = 'rejected',
      decided_by = v_uid,
      decided_at = v_at,
      applied_at = NULL
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'status', 'rejected',
    'proposal_id', v_row.id,
    'client_id', v_row.client_id,
    'surface', v_row.surface
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_figure_proposal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_figure_proposal(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_figure_proposal(uuid, boolean) IS
  'Apply a pending cash, budget, or waterfall proposal. p_confirm must be true. Otherwise the function raises and writes nothing.';
COMMENT ON FUNCTION public.reject_figure_proposal(uuid) IS
  'Mark a figure proposal rejected. Does not update clients.';
