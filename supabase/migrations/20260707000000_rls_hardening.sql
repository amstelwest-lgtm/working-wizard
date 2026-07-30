-- ============================================================================
-- RLS hardening — fixes two cross-tenant exposure findings from the July audit.
--
-- FINDING 1 (HIGH — privilege escalation):
--   public.user_roles had "users insert own roles" WITH CHECK (user_id = auth.uid()),
--   allowing ANY authenticated user to self-insert role 'accountant' or 'firm_admin'.
--   Several policies grant accountants/firm_admins broad read access, so self-
--   granting the role escalates a plain SME user into an accountant.
--
-- FINDING 2 (HIGH — over-broad accountant scope):
--   intervention_signoffs "read signoffs for own client" and the parallel
--   intervention_custom_steps read policy let ANY user holding the accountant/
--   firm_admin role read rows for ANY client_id — not just clients they actually
--   serve — because the role check is not joined to a firm/client relationship.
--   Combined with Finding 1, any user could read every client's intervention data.
--
-- NOTE on financial_submissions: its policy references c.accountant_id, a column
--   that does not exist on public.clients. That predicate silently evaluates to
--   false rather than erroring, so it is currently fail-closed (no leak) but also
--   means accountants cannot see submissions for their firm clients at all. This
--   migration does NOT change that behaviour — it is flagged for a product
--   decision (see audit notes) because the correct scoping depends on whether
--   submissions should follow firm membership or a direct assignment.
-- ============================================================================

-- ── Finding 1: remove self-service role insertion ──────────────────────────
-- Roles must be assigned server-side via the service-role key (as adminSignUp
-- already does), never by the authenticated user themselves.
DROP POLICY IF EXISTS "users insert own roles" ON public.user_roles;

-- (Read-own remains; users may still see their own roles. No authenticated
--  INSERT/UPDATE/DELETE policy means those operations are denied for the
--  anon/authenticated keys while RLS is enabled — the service role bypasses
--  RLS and continues to work.)

-- ── Finding 2: scope accountant intervention access to served clients ───────
-- Replace the role-only checks with checks that additionally require the
-- accountant to actually have access to that specific client, via the existing
-- has_client_access() SECURITY DEFINER helper (owner OR client membership OR
-- firm membership).

DROP POLICY IF EXISTS "read signoffs for own client" ON public.intervention_signoffs;
CREATE POLICY "read signoffs for own client"
  ON public.intervention_signoffs FOR SELECT
  TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- Sign-off writes: keep the requirement that the writer is an accountant/
-- firm_admin AND is stamping their own identity, but additionally require that
-- they actually serve this client.
DROP POLICY IF EXISTS "accountants insert signoffs" ON public.intervention_signoffs;
CREATE POLICY "accountants insert signoffs"
  ON public.intervention_signoffs FOR INSERT
  TO authenticated
  WITH CHECK (
    signed_off_by_id = auth.uid()
    AND public.has_client_access(auth.uid(), client_id)
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('accountant', 'firm_admin')
    )
  );

-- Custom steps read: same fix — accountant visibility must be scoped to served
-- clients; client owners still only see steps flagged visible_to_sme.
DROP POLICY IF EXISTS "read custom steps for own client" ON public.intervention_custom_steps;
CREATE POLICY "read custom steps for own client"
  ON public.intervention_custom_steps FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = intervention_custom_steps.client_id
        AND (
          -- Accountant/firm_admin who actually serves this client
          (
            public.has_client_access(auth.uid(), c.id)
            AND EXISTS (
              SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = auth.uid()
                AND ur.role IN ('accountant', 'firm_admin')
            )
          )
          -- Client owner sees only steps marked visible
          OR (c.owner_user_id = auth.uid() AND intervention_custom_steps.visible_to_sme = true)
        )
    )
  );
