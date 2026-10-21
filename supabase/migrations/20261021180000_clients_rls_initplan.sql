-- Cache auth.uid() once per statement on the clients policies, and index
-- clients.owner_user_id. The predicates are unchanged: a scalar subquery
-- around auth.uid() is an initplan, not a different boolean.
--
-- Live policies this replaces:
--   clients read by access
--   clients insert own                         (firm link columns stay null)
--   clients update by owner or firm
--   clients update brain summary by access
--   clients delete by owner
--
-- Do not apply this from the app. Apply it in the SQL editor and read the
-- policies back.

DROP POLICY IF EXISTS "clients read by access" ON public.clients;
CREATE POLICY "clients read by access"
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (public.has_client_access((select auth.uid()), id));

DROP POLICY IF EXISTS "clients insert own" ON public.clients;
CREATE POLICY "clients insert own"
  ON public.clients
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (select auth.uid())
    AND firm_id IS NULL
    AND firm_link_accepted_at IS NULL
    AND firm_link_accepted_by IS NULL
  );

DROP POLICY IF EXISTS "clients update by owner or firm" ON public.clients;
CREATE POLICY "clients update by owner or firm"
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (public.is_client_writer((select auth.uid()), id))
  WITH CHECK (public.is_client_writer((select auth.uid()), id));

DROP POLICY IF EXISTS "clients update brain summary by access" ON public.clients;
CREATE POLICY "clients update brain summary by access"
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (public.has_client_access((select auth.uid()), id))
  WITH CHECK (public.has_client_access((select auth.uid()), id));

COMMENT ON POLICY "clients update brain summary by access" ON public.clients IS
  'Narrow write path for Client Brain GAP/competitor/summary patches. Non-writer access is column-scoped by clients_guard_owner_only_columns.';

DROP POLICY IF EXISTS "clients delete by owner" ON public.clients;
CREATE POLICY "clients delete by owner"
  ON public.clients
  FOR DELETE
  TO authenticated
  USING (owner_user_id = (select auth.uid()));

CREATE INDEX IF NOT EXISTS clients_owner_user_id_idx
  ON public.clients (owner_user_id);
