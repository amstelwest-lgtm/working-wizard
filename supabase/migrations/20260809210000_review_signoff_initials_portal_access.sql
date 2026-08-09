-- Allow any practice user with client access to sign off (not only users with an
-- accountant/firm_admin row). Client owners/members remain blocked.
-- Also persist initials derived from signup full_name for stamp display.

ALTER TABLE public.client_review_signoffs
  ADD COLUMN IF NOT EXISTS signed_off_by_initials TEXT;

DROP POLICY IF EXISTS "accountants insert review signoffs" ON public.client_review_signoffs;
DROP POLICY IF EXISTS "accountants update review signoffs" ON public.client_review_signoffs;
DROP POLICY IF EXISTS "accountants delete review signoffs" ON public.client_review_signoffs;

CREATE POLICY "practice users insert review signoffs"
  ON public.client_review_signoffs FOR INSERT
  TO authenticated
  WITH CHECK (
    signed_off_by_id = auth.uid()
    AND public.has_client_access(auth.uid(), client_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('client_owner', 'client_member')
        AND NOT EXISTS (
          SELECT 1 FROM public.user_roles ur2
          WHERE ur2.user_id = auth.uid()
            AND ur2.role IN ('accountant', 'firm_admin')
        )
    )
  );

CREATE POLICY "practice users update review signoffs"
  ON public.client_review_signoffs FOR UPDATE
  TO authenticated
  USING (
    public.has_client_access(auth.uid(), client_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('client_owner', 'client_member')
        AND NOT EXISTS (
          SELECT 1 FROM public.user_roles ur2
          WHERE ur2.user_id = auth.uid()
            AND ur2.role IN ('accountant', 'firm_admin')
        )
    )
  )
  WITH CHECK (
    signed_off_by_id = auth.uid()
    AND public.has_client_access(auth.uid(), client_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('client_owner', 'client_member')
        AND NOT EXISTS (
          SELECT 1 FROM public.user_roles ur2
          WHERE ur2.user_id = auth.uid()
            AND ur2.role IN ('accountant', 'firm_admin')
        )
    )
  );

CREATE POLICY "practice users delete review signoffs"
  ON public.client_review_signoffs FOR DELETE
  TO authenticated
  USING (
    public.has_client_access(auth.uid(), client_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('client_owner', 'client_member')
        AND NOT EXISTS (
          SELECT 1 FROM public.user_roles ur2
          WHERE ur2.user_id = auth.uid()
            AND ur2.role IN ('accountant', 'firm_admin')
        )
    )
  );
