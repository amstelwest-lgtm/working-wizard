-- Snapshots of client financials over time, used for trendlines
CREATE TABLE public.client_financial_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_label text NOT NULL,
  period_date date NOT NULL,
  financials jsonb NOT NULL DEFAULT '{}'::jsonb,
  ratios jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'pdf_upload',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX idx_cfs_client_period ON public.client_financial_snapshots(client_id, period_date DESC);

ALTER TABLE public.client_financial_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshots read by client access"
  ON public.client_financial_snapshots FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "snapshots insert by client access"
  ON public.client_financial_snapshots FOR INSERT TO authenticated
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "snapshots update by client access"
  ON public.client_financial_snapshots FOR UPDATE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "snapshots delete by client access"
  ON public.client_financial_snapshots FOR DELETE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));