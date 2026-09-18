-- ============================================================================
-- P0.6 — Active data requests
--
-- When the spine finds a critical gap (stale figures, no bank balance for the
-- forecast, high debtor days with no ageing to explain it) it opens a tracked
-- request instead of silently producing a weaker diagnosis / forecast. The
-- request surfaces as the Next Step (blocking) and can be emailed; it closes
-- itself when the matching data lands.
--
-- Additive only. Idempotent: safe to apply twice.
-- Depends on: 20260918120000_advisory_state.sql (advisory_emit, advisory_cycles).
-- Keep kinds / statuses in sync with src/lib/data-requests.ts (test-guarded).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cycle_id         uuid REFERENCES public.advisory_cycles(id) ON DELETE SET NULL,
  kind             text NOT NULL CHECK (kind IN (
                     'bank_statement', 'management_accounts', 'aged_debtors', 'aged_creditors',
                     'bank_balance', 'payroll', 'accounting_connection', 'other'
                   )),
  title            text NOT NULL,
  reason           text,
  severity         text NOT NULL DEFAULT 'important'
                   CHECK (severity IN ('critical', 'important', 'nice_to_have')),
  status           text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'sent', 'fulfilled', 'waived', 'expired')),
  source           text NOT NULL DEFAULT 'system'
                   CHECK (source IN ('system', 'accountant', 'owner', 'ai')),
  -- Stable key so the detector can upsert the same gap without duplicates
  -- (e.g. 'stale_figures', 'forecast_opening_balance', 'debtor_days_no_ageing').
  rule_key         text,
  requested_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  due_at           timestamptz,
  sent_at          timestamptz,
  sent_to          text,
  last_reminded_at timestamptz,
  fulfilled_at     timestamptz,
  fulfilled_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- How it was satisfied: {"snapshot_id": ...} | {"artifact_id": ...} | {"auto": true, "note": ...}
  fulfilled_with   jsonb,
  waived_reason    text,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_requests_client_open_idx
  ON public.data_requests (client_id, requested_at DESC)
  WHERE status IN ('open', 'sent');

-- One live request per (client, rule) — the detector upserts against this.
CREATE UNIQUE INDEX IF NOT EXISTS data_requests_client_rule_open_key
  ON public.data_requests (client_id, rule_key)
  WHERE rule_key IS NOT NULL AND status IN ('open', 'sent');

DROP TRIGGER IF EXISTS data_requests_touch_updated_at ON public.data_requests;
CREATE TRIGGER data_requests_touch_updated_at
  BEFORE UPDATE ON public.data_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

COMMENT ON TABLE public.data_requests IS
  'Tracked asks for missing / stale data. Opened by the detector (system), an accountant or the owner; closed by matching uploads or by hand.';

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.data_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_requests read by access" ON public.data_requests;
CREATE POLICY "data_requests read by access"
  ON public.data_requests FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- Owner or firm member may open / close requests; invited members only read.
DROP POLICY IF EXISTS "data_requests insert by writer" ON public.data_requests;
CREATE POLICY "data_requests insert by writer"
  ON public.data_requests FOR INSERT TO authenticated
  WITH CHECK (
    (requested_by IS NULL OR requested_by = auth.uid())
    AND public.is_action_plan_writer(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "data_requests update by writer" ON public.data_requests;
CREATE POLICY "data_requests update by writer"
  ON public.data_requests FOR UPDATE TO authenticated
  USING (public.is_action_plan_writer(auth.uid(), client_id))
  WITH CHECK (public.is_action_plan_writer(auth.uid(), client_id));

-- No delete policy: waive or expire instead so the audit trail stays whole.

-- ── defaults ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.data_request_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.requested_by := coalesce(NEW.requested_by, auth.uid());
  IF NEW.cycle_id IS NULL THEN
    SELECT c.advisory_cycle_id INTO NEW.cycle_id FROM public.clients c WHERE c.id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_requests_defaults ON public.data_requests;
CREATE TRIGGER data_requests_defaults
  BEFORE INSERT ON public.data_requests
  FOR EACH ROW EXECUTE FUNCTION public.data_request_defaults();

-- ── advisory events (audit only; no state change) ────────────────────────────

CREATE OR REPLACE FUNCTION public.advisory_trg_data_requests()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := coalesce(auth.uid(), NEW.fulfilled_by, NEW.requested_by);
  v_payload jsonb := jsonb_build_object(
    'kind', NEW.kind, 'severity', NEW.severity, 'rule_key', NEW.rule_key, 'source', NEW.source
  );
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.advisory_emit(
      NEW.client_id, 'data.request_opened', v_actor,
      v_payload || jsonb_build_object('title', left(NEW.title, 120)), 'data_requests', NEW.id
    );
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('fulfilled', 'waived', 'expired') THEN
    PERFORM public.advisory_emit(
      NEW.client_id, 'data.request_fulfilled', v_actor,
      v_payload || jsonb_build_object('status', NEW.status, 'fulfilled_with', NEW.fulfilled_with),
      'data_requests', NEW.id
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'advisory_trg_data_requests failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS advisory_on_data_requests ON public.data_requests;
CREATE TRIGGER advisory_on_data_requests
  AFTER INSERT OR UPDATE OF status ON public.data_requests
  FOR EACH ROW EXECUTE FUNCTION public.advisory_trg_data_requests();

-- ── auto-fulfilment ──────────────────────────────────────────────────────────
-- A new snapshot satisfies every open ask for figures; a bank-balance ask is
-- satisfied when the forecast saves an opening balance. Ageing reports and
-- payroll are closed by hand (or by the detector when the gap disappears).

CREATE OR REPLACE FUNCTION public.data_requests_fulfil(
  p_client_id uuid,
  p_kinds     text[],
  p_with      jsonb,
  p_actor     uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.data_requests
     SET status = 'fulfilled',
         fulfilled_at = now(),
         fulfilled_by = coalesce(p_actor, auth.uid()),
         fulfilled_with = p_with
   WHERE client_id = p_client_id
     AND status IN ('open', 'sent')
     AND kind = ANY (p_kinds);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.data_requests_trg_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.data_requests_fulfil(
    NEW.client_id,
    ARRAY['bank_statement', 'management_accounts'],
    jsonb_build_object('snapshot_id', NEW.id, 'period_label', NEW.period_label, 'auto', true),
    coalesce(auth.uid(), NEW.created_by)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'data_requests_trg_snapshot failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_requests_on_snapshot ON public.client_financial_snapshots;
CREATE TRIGGER data_requests_on_snapshot
  AFTER INSERT ON public.client_financial_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.data_requests_trg_snapshot();

CREATE OR REPLACE FUNCTION public.data_requests_trg_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening text := nullif(trim(coalesce(NEW.cashflow->>'openingBalance', '')), '');
BEGIN
  IF v_opening IS NOT NULL AND v_opening <> '0'
     AND (OLD.cashflow->>'openingBalance') IS DISTINCT FROM (NEW.cashflow->>'openingBalance') THEN
    PERFORM public.data_requests_fulfil(
      NEW.id, ARRAY['bank_balance'],
      jsonb_build_object('opening_balance', v_opening, 'auto', true), auth.uid()
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'data_requests_trg_client failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_requests_on_client ON public.clients;
CREATE TRIGGER data_requests_on_client
  AFTER UPDATE OF cashflow ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.data_requests_trg_client();

-- ── detector upsert (called by syncDataRequests) ─────────────────────────────
-- Opens missing system requests, closes system requests whose rule no longer
-- fires, and leaves human-opened requests alone. Access check inside because
-- it is SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public.data_requests_sync(
  p_client_id uuid,
  p_wanted    jsonb   -- [{rule_key, kind, title, reason, severity, due_at}]
)
RETURNS TABLE (opened integer, closed integer, open_total integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_row      jsonb;
  v_inserted boolean;
  v_opened   integer := 0;
  v_closed   integer := 0;
  v_keys     text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_client_access(v_uid, p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(coalesce(p_wanted, '[]'::jsonb)) LOOP
    CONTINUE WHEN nullif(v_row->>'rule_key', '') IS NULL OR nullif(v_row->>'kind', '') IS NULL;
    v_keys := v_keys || (v_row->>'rule_key');
    INSERT INTO public.data_requests (
      client_id, kind, title, reason, severity, source, rule_key, requested_by, due_at
    ) VALUES (
      p_client_id,
      v_row->>'kind',
      v_row->>'title',
      v_row->>'reason',
      coalesce(v_row->>'severity', 'important'),
      'system',
      v_row->>'rule_key',
      NULL,
      nullif(v_row->>'due_at', '')::timestamptz
    )
    ON CONFLICT (client_id, rule_key) WHERE rule_key IS NOT NULL AND status IN ('open', 'sent')
    DO UPDATE SET
      title = EXCLUDED.title,
      reason = EXCLUDED.reason,
      severity = EXCLUDED.severity
    RETURNING (xmax = 0) INTO v_inserted;
    IF v_inserted THEN
      v_opened := v_opened + 1;
    END IF;
  END LOOP;

  -- System requests whose rule stopped firing are satisfied by definition.
  UPDATE public.data_requests d
     SET status = 'fulfilled',
         fulfilled_at = now(),
         fulfilled_by = v_uid,
         fulfilled_with = jsonb_build_object('auto', true, 'note', 'rule no longer applies')
   WHERE d.client_id = p_client_id
     AND d.source = 'system'
     AND d.rule_key IS NOT NULL
     AND d.status IN ('open', 'sent')
     AND NOT (d.rule_key = ANY (v_keys));
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN QUERY
    SELECT v_opened, v_closed,
           (SELECT count(*)::integer FROM public.data_requests d
             WHERE d.client_id = p_client_id AND d.status IN ('open', 'sent'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.data_requests_sync(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.data_requests_fulfil(uuid, text[], jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.data_requests_sync(uuid, jsonb) IS
  'P0.6 detector upsert: open missing system requests for the given rules, auto-fulfil system requests whose rule no longer fires.';
