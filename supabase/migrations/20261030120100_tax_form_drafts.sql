-- Tax Specialist form drafts (IRP6 now, IRP5 next). Milōn prepares the sheet,
-- the accountant checks and approves it, then captures it on SARS eFiling.
-- Nothing here talks to SARS: no login, no API, no submission.
--
-- fields: { [fieldId]: { value, source } } where source is books, client,
-- input, worked, or nil. approvals: { [sectionId]: true }.
-- subject is null for IRP6 and names the employee for IRP5.
-- The app falls back to browser storage until this table exists.

CREATE TABLE IF NOT EXISTS public.tax_form_drafts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  form_code         TEXT NOT NULL CHECK (form_code IN ('IRP6', 'IRP5')),
  tax_year          INTEGER NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
  period            INTEGER CHECK (period BETWEEN 1 AND 3),
  subject           TEXT,
  fields            JSONB NOT NULL DEFAULT '{}'::jsonb,
  approvals         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'approved', 'downloaded')),
  approved_by       UUID REFERENCES auth.users(id),
  approved_by_name  TEXT,
  approved_at       TIMESTAMPTZ,
  downloaded_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tax_form_drafts_one_per_return
    UNIQUE NULLS NOT DISTINCT (client_id, form_code, tax_year, period, subject)
);

CREATE INDEX IF NOT EXISTS tax_form_drafts_client_idx
  ON public.tax_form_drafts (client_id, updated_at DESC);

ALTER TABLE public.tax_form_drafts ENABLE ROW LEVEL SECURITY;

-- Same split as the other client tables: read with access, write as a writer.
DROP POLICY IF EXISTS "tax form drafts read by access" ON public.tax_form_drafts;
CREATE POLICY "tax form drafts read by access"
  ON public.tax_form_drafts FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "tax form drafts insert by writer" ON public.tax_form_drafts;
CREATE POLICY "tax form drafts insert by writer"
  ON public.tax_form_drafts FOR INSERT TO authenticated
  WITH CHECK (public.is_client_writer(auth.uid(), client_id));

DROP POLICY IF EXISTS "tax form drafts update by writer" ON public.tax_form_drafts;
CREATE POLICY "tax form drafts update by writer"
  ON public.tax_form_drafts FOR UPDATE TO authenticated
  USING (public.is_client_writer(auth.uid(), client_id))
  WITH CHECK (public.is_client_writer(auth.uid(), client_id));

CREATE OR REPLACE FUNCTION public.touch_tax_form_draft_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_form_drafts_touch_updated_at ON public.tax_form_drafts;
CREATE TRIGGER tax_form_drafts_touch_updated_at
  BEFORE UPDATE ON public.tax_form_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_tax_form_draft_updated_at();
