-- Score trend history (for the 8-point sparkline) and a reports-issued counter,
-- both needed by the redesigned accountant portal.

-- ── Score history ────────────────────────────────────────────────────────────
-- One row per period. `is_estimated` marks rows that are a projected fallback
-- (not computed from a real uploaded snapshot) so the UI can visibly flag
-- them instead of presenting them as solid data.
CREATE TABLE IF NOT EXISTS public.client_score_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_date  DATE NOT NULL,
  score        NUMERIC NOT NULL,
  is_estimated BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, period_date)
);
CREATE INDEX IF NOT EXISTS idx_csh_client_period ON public.client_score_history(client_id, period_date DESC);
ALTER TABLE public.client_score_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "score history read"   ON public.client_score_history;
DROP POLICY IF EXISTS "score history insert" ON public.client_score_history;
DROP POLICY IF EXISTS "score history update" ON public.client_score_history;
DROP POLICY IF EXISTS "score history delete" ON public.client_score_history;

CREATE POLICY "score history read"   ON public.client_score_history FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "score history insert" ON public.client_score_history FOR INSERT TO authenticated WITH CHECK (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "score history update" ON public.client_score_history FOR UPDATE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "score history delete" ON public.client_score_history FOR DELETE TO authenticated USING (public.has_client_access(auth.uid(), client_id));

-- ── Reports-issued counter ────────────────────────────────────────────────────
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS reports_issued_count INT NOT NULL DEFAULT 0;
