-- ============================================================================
-- P1.3 — Workflow emails
--
-- Advisory events become email only through `runWorkflow` (server fn), which
-- decides deterministically what is due, checks this log so nothing is sent
-- twice, and records every attempt. Recipients are resolved by a SECURITY
-- DEFINER RPC because the owner's RLS cannot read the firm's profiles and
-- vice versa.
--
-- Additive only. Idempotent. Depends on 20260918120000_advisory_state.sql.
-- Kinds mirror src/lib/workflow-emails.ts (test-guarded).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.workflow_email_log (
  id               bigserial PRIMARY KEY,
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN (
                     'pack_ready_for_review', 'pack_signed_off', 'pack_changes_requested',
                     'forecast_break', 'cycle_restarted'
                   )),
  -- What made this send unique (pack id, forecast timestamp, event id…).
  ref_key          text NOT NULL,
  recipient_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_email  text NOT NULL,
  recipient_role   text NOT NULL CHECK (recipient_role IN ('owner', 'accountant')),
  status           text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  subject          text,
  error            text,
  triggered_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- One successful send per (client, kind, ref, recipient).
CREATE UNIQUE INDEX IF NOT EXISTS workflow_email_log_sent_key
  ON public.workflow_email_log (client_id, kind, ref_key, recipient_email)
  WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS workflow_email_log_client_idx
  ON public.workflow_email_log (client_id, created_at DESC);

COMMENT ON TABLE public.workflow_email_log IS
  'Every workflow email attempt. The partial unique index is the idempotency guard runWorkflow relies on.';

ALTER TABLE public.workflow_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_email_log read by access" ON public.workflow_email_log;
CREATE POLICY "workflow_email_log read by access"
  ON public.workflow_email_log FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- The engine runs as the user whose page load triggered it; anyone with
-- access may record a send. Rows are immutable (no update / delete policy).
DROP POLICY IF EXISTS "workflow_email_log insert by access" ON public.workflow_email_log;
CREATE POLICY "workflow_email_log insert by access"
  ON public.workflow_email_log FOR INSERT TO authenticated
  WITH CHECK (
    (triggered_by IS NULL OR triggered_by = auth.uid())
    AND public.has_client_access(auth.uid(), client_id)
  );

-- ── recipients ──────────────────────────────────────────────────────────────
-- Owner (clients.owner_user_id) + every firm member of clients.firm_id, with
-- the email from profiles. Only callers with client access get an answer.

CREATE OR REPLACE FUNCTION public.workflow_recipients(p_client_id uuid)
RETURNS TABLE (user_id uuid, email text, full_name text, role text)
LANGUAGE plpgsql
STABLE
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
  RETURN QUERY
    SELECT pr.id, pr.email, pr.full_name, 'owner'::text
    FROM public.clients c
    JOIN public.profiles pr ON pr.id = c.owner_user_id
    WHERE c.id = p_client_id AND pr.email IS NOT NULL AND pr.email LIKE '%@%'
    UNION
    SELECT pr.id, pr.email, pr.full_name, 'accountant'::text
    FROM public.clients c
    JOIN public.firm_memberships fm ON fm.firm_id = c.firm_id
    JOIN public.profiles pr ON pr.id = fm.user_id
    WHERE c.id = p_client_id AND c.firm_id IS NOT NULL
      AND pr.email IS NOT NULL AND pr.email LIKE '%@%';
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_recipients(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workflow_recipients(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.workflow_recipients(uuid) IS
  'P1.3: owner + firm members with emails for workflow mail. SECURITY DEFINER because profiles RLS does not cross the owner/firm boundary.';
