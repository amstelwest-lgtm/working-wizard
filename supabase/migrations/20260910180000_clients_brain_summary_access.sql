-- Client Brain: brain_summary writes for has_client_access (not only is_client_writer)
-- ────────────────────────────────────────────────────────────────────────────────
-- Brain tables (proposed_next_steps, etc.) allow UPDATE via has_client_access.
-- clients UPDATE is gated by is_client_writer (owner, non-read_only practice assignment,
-- or firm owner). Firm managers / read-only practice staff with has_client_access could
-- approve steps but brain_summary / GAP / competitor patches silently 0-row.
--
-- Fix: add a narrow UPDATE policy for has_client_access and enforce column scope in the
-- existing BEFORE UPDATE trigger so non-writers may only touch brain_summary columns.

DROP POLICY IF EXISTS "clients update brain summary by access" ON public.clients;

CREATE POLICY "clients update brain summary by access"
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (public.has_client_access(auth.uid(), id))
  WITH CHECK (public.has_client_access(auth.uid(), id));

CREATE OR REPLACE FUNCTION public.clients_guard_owner_only_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Owners may change anything on their row.
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.owner_user_id THEN
    RETURN NEW;
  END IF;

  -- Service role / no JWT (migrations, edge functions) — leave alone.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Client Brain: has_client_access without is_client_writer may patch brain_summary only.
  IF public.has_client_access(auth.uid(), OLD.id)
     AND NOT public.is_client_writer(auth.uid(), OLD.id) THEN
    IF (to_jsonb(NEW) - 'brain_summary' - 'brain_summary_updated_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'brain_summary' - 'brain_summary_updated_at') THEN
      RAISE EXCEPTION 'clients update for non-writers is limited to brain_summary';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'clients.id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'clients.created_at is owner-only';
  END IF;
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'clients.owner_user_id is owner-only';
  END IF;
  IF NEW.firm_id IS DISTINCT FROM OLD.firm_id THEN
    RAISE EXCEPTION 'clients.firm_id is owner-only';
  END IF;
  IF NEW.last_login_at IS DISTINCT FROM OLD.last_login_at THEN
    RAISE EXCEPTION 'clients.last_login_at is owner-only';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON POLICY "clients update brain summary by access" ON public.clients IS
  'Narrow write path for Client Brain GAP/competitor/summary patches. Non-writer access is column-scoped by clients_guard_owner_only_columns.';
