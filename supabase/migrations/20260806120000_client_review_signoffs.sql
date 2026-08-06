-- ── Client Review Sign-offs ───────────────────────────────────────────────────
-- Generalizes the intervention_signoffs one-click pattern to two period-level
-- scopes: the overall financials snapshot and the cash forecast. Unlike
-- intervention_signoffs (keyed per ratio/step/period), this table holds at most
-- one active row per (client_id, scope) — signing again simply replaces it.
--
-- Staleness is computed by callers by comparing signed_off_at against the
-- relevant freshness column: clients.financials_updated_at for scope
-- 'financials', clients.last_forecast_at (already exists) for scope
-- 'cash_forecast'.

CREATE TABLE IF NOT EXISTS public.client_review_signoffs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scope                 TEXT NOT NULL CHECK (scope IN ('financials', 'cash_forecast')),
  signed_off_by_id      UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  signed_off_by_name    TEXT NOT NULL,
  signed_off_by_title   TEXT,
  firm_name             TEXT,
  note                  TEXT,
  signed_off_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, scope)
);

CREATE INDEX IF NOT EXISTS client_review_signoffs_client_idx
  ON public.client_review_signoffs (client_id);

ALTER TABLE public.client_review_signoffs ENABLE ROW LEVEL SECURITY;

-- Read: anyone with access to the client (owner, member, or serving accountant/firm_admin).
CREATE POLICY "read review signoffs for own client"
  ON public.client_review_signoffs FOR SELECT
  TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- Insert: must be a serving accountant/firm_admin, stamping their own identity.
CREATE POLICY "accountants insert review signoffs"
  ON public.client_review_signoffs FOR INSERT
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

-- Update: any serving accountant/firm_admin may re-sign a stale period (not
-- just the original signer) — re-review is a firm-level action, not personal.
-- The new row must still attribute signed_off_by_id to whoever is re-signing.
CREATE POLICY "accountants update review signoffs"
  ON public.client_review_signoffs FOR UPDATE
  TO authenticated
  USING (
    public.has_client_access(auth.uid(), client_id)
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('accountant', 'firm_admin')
    )
  )
  WITH CHECK (
    signed_off_by_id = auth.uid()
    AND public.has_client_access(auth.uid(), client_id)
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('accountant', 'firm_admin')
    )
  );

-- Delete: any serving accountant/firm_admin may retract the client's sign-off.
CREATE POLICY "accountants delete review signoffs"
  ON public.client_review_signoffs FOR DELETE
  TO authenticated
  USING (
    public.has_client_access(auth.uid(), client_id)
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('accountant', 'firm_admin')
    )
  );

-- Staleness reference for the 'financials' scope. 'cash_forecast' already has
-- clients.last_forecast_at, updated on every forecast autosave.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS financials_updated_at TIMESTAMPTZ;
