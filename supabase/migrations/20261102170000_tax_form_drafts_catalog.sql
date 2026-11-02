-- Tax form catalog and draft versions.
--
-- Any form in public.tax_form_catalog can have a draft. The app registry
-- (src/lib/tax-specialist/forms/registry.ts) is the field schema; this table
-- is the database allow-list, so a typo cannot land a row.
--
-- A save does not overwrite. save_tax_form_draft_version inserts the next
-- version. The new row's supersedes_id points at the previous version. The
-- previous row's superseded_by points at the new one, the same direction as
-- agent_findings title supersede. Old versions stay and cannot be edited.
-- One current row (superseded_by is null) per client, form, year, period,
-- and subject.
--
-- Milōn still does not log into SARS, submit a return, or email the sheet
-- to the client. Apply on prod (jxclnsbsqpixxqlbcapl) by hand. This file is
-- not in the CI apply scripts.
--
-- Runs as the signed-in user. The writer check and the table policies both apply.

CREATE TABLE IF NOT EXISTS public.tax_form_catalog (
  code    TEXT PRIMARY KEY,
  label   TEXT NOT NULL,
  entity  TEXT NOT NULL,
  status  TEXT NOT NULL CHECK (status IN ('ready', 'soon'))
);

INSERT INTO public.tax_form_catalog (code, label, entity, status) VALUES
  ('IRP5', 'IRP5 / IT3(a)', 'employer', 'soon'),
  ('EMP201', 'EMP201', 'employer', 'soon'),
  ('EMP501', 'EMP501', 'employer', 'soon'),
  ('IRP6', 'IRP6', 'company', 'ready'),
  ('ITR14', 'ITR14', 'company', 'soon'),
  ('VAT201', 'VAT201', 'vendor', 'soon'),
  ('ITR12', 'ITR12', 'individual', 'soon')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      entity = EXCLUDED.entity,
      status = EXCLUDED.status;

ALTER TABLE public.tax_form_catalog ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tax_form_catalog FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.tax_form_catalog TO authenticated;
GRANT ALL ON TABLE public.tax_form_catalog TO service_role;
GRANT REFERENCES ON TABLE public.tax_form_catalog TO authenticated;

DROP POLICY IF EXISTS "tax form catalog read" ON public.tax_form_catalog;
CREATE POLICY "tax form catalog read"
  ON public.tax_form_catalog FOR SELECT TO authenticated
  USING (true);

-- The original inline CHECK only allowed IRP6 and IRP5. Drop whichever
-- name Postgres gave it. Leave the status and period checks alone.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'tax_form_drafts'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%form_code%'
  LOOP
    EXECUTE format('ALTER TABLE public.tax_form_drafts DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.tax_form_drafts
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_id UUID,
  ADD COLUMN IF NOT EXISTS superseded_by UUID,
  ADD COLUMN IF NOT EXISTS rules_year INTEGER,
  ADD COLUMN IF NOT EXISTS field_sources JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.tax_form_drafts
  DROP CONSTRAINT IF EXISTS tax_form_drafts_version_check;
ALTER TABLE public.tax_form_drafts
  ADD CONSTRAINT tax_form_drafts_version_check CHECK (version >= 1);

ALTER TABLE public.tax_form_drafts
  DROP CONSTRAINT IF EXISTS tax_form_drafts_rules_year_check;
ALTER TABLE public.tax_form_drafts
  ADD CONSTRAINT tax_form_drafts_rules_year_check
  CHECK (rules_year IS NULL OR rules_year BETWEEN 2000 AND 2100);

ALTER TABLE public.tax_form_drafts
  DROP CONSTRAINT IF EXISTS tax_form_drafts_form_code_fkey;
ALTER TABLE public.tax_form_drafts
  ADD CONSTRAINT tax_form_drafts_form_code_fkey
  FOREIGN KEY (form_code) REFERENCES public.tax_form_catalog (code);

ALTER TABLE public.tax_form_drafts
  DROP CONSTRAINT IF EXISTS tax_form_drafts_supersedes_id_fkey;
ALTER TABLE public.tax_form_drafts
  ADD CONSTRAINT tax_form_drafts_supersedes_id_fkey
  FOREIGN KEY (supersedes_id) REFERENCES public.tax_form_drafts (id) ON DELETE SET NULL;

ALTER TABLE public.tax_form_drafts
  DROP CONSTRAINT IF EXISTS tax_form_drafts_superseded_by_fkey;
ALTER TABLE public.tax_form_drafts
  ADD CONSTRAINT tax_form_drafts_superseded_by_fkey
  FOREIGN KEY (superseded_by) REFERENCES public.tax_form_drafts (id) ON DELETE SET NULL;

-- The old unique constraint allowed one row per return, so a save overwrote
-- it. Versions need many rows. One current row stays unique.
ALTER TABLE public.tax_form_drafts
  DROP CONSTRAINT IF EXISTS tax_form_drafts_one_per_return;

CREATE UNIQUE INDEX IF NOT EXISTS tax_form_drafts_current_return_idx
  ON public.tax_form_drafts (client_id, form_code, tax_year, period, subject)
  NULLS NOT DISTINCT
  WHERE superseded_by IS NULL;

CREATE INDEX IF NOT EXISTS tax_form_drafts_history_idx
  ON public.tax_form_drafts (client_id, form_code, tax_year, version DESC);

-- Company IRP6 uses the 27% table (rules vintage 2023), not the assessment year.
UPDATE public.tax_form_drafts
SET rules_year = 2023
WHERE form_code = 'IRP6' AND rules_year IS NULL;

COMMENT ON COLUMN public.tax_form_drafts.version IS
  '1 on the first save. Each later save inserts version + 1.';
COMMENT ON COLUMN public.tax_form_drafts.supersedes_id IS
  'The version this row replaced. Null on version 1.';
COMMENT ON COLUMN public.tax_form_drafts.superseded_by IS
  'The version that replaced this row. Null on the current row.';
COMMENT ON COLUMN public.tax_form_drafts.rules_year IS
  'Rules vintage used to compute the sheet, not necessarily the year of assessment.';
COMMENT ON COLUMN public.tax_form_drafts.field_sources IS
  'field id to client file id. Empty when the figure is not from a file.';

-- Reject an in-place edit. The current row may only gain its superseded_by
-- pointer. A parked row (superseded_by = its own id, set inside the save
-- function so the unique index is free) may then point at the new version.
CREATE OR REPLACE FUNCTION public.tax_form_drafts_keep_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  content_changed boolean;
BEGIN
  content_changed :=
    NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.form_code IS DISTINCT FROM OLD.form_code
    OR NEW.tax_year IS DISTINCT FROM OLD.tax_year
    OR NEW.period IS DISTINCT FROM OLD.period
    OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.fields IS DISTINCT FROM OLD.fields
    OR NEW.approvals IS DISTINCT FROM OLD.approvals
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.approved_by_name IS DISTINCT FROM OLD.approved_by_name
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.downloaded_at IS DISTINCT FROM OLD.downloaded_at
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
    OR NEW.rules_year IS DISTINCT FROM OLD.rules_year
    OR NEW.field_sources IS DISTINCT FROM OLD.field_sources
    OR NEW.created_at IS DISTINCT FROM OLD.created_at;

  IF content_changed THEN
    RAISE EXCEPTION 'tax form draft versions are kept; save a new version'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.superseded_by IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.superseded_by = OLD.id AND NEW.superseded_by IS DISTINCT FROM OLD.id THEN
    RETURN NEW;
  END IF;

  IF NEW.superseded_by IS NOT DISTINCT FROM OLD.superseded_by THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'superseded tax form draft is read-only'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS tax_form_drafts_keep_history ON public.tax_form_drafts;
CREATE TRIGGER tax_form_drafts_keep_history
  BEFORE UPDATE ON public.tax_form_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tax_form_drafts_keep_history();

REVOKE ALL ON FUNCTION public.tax_form_drafts_keep_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tax_form_drafts_keep_history() TO service_role;

CREATE OR REPLACE FUNCTION public.save_tax_form_draft_version(
  p_client_id uuid,
  p_form_code text,
  p_tax_year integer,
  p_period integer,
  p_subject text,
  p_fields jsonb,
  p_approvals jsonb,
  p_status text,
  p_approved_by uuid,
  p_approved_by_name text,
  p_approved_at timestamptz,
  p_downloaded_at timestamptz,
  p_rules_year integer,
  p_field_sources jsonb
)
RETURNS public.tax_form_drafts
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old_id uuid;
  v_version integer;
  v_new public.tax_form_drafts;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_client_writer(auth.uid(), p_client_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tax_form_catalog WHERE code = p_form_code) THEN
    RAISE EXCEPTION 'unknown tax form' USING ERRCODE = '23514';
  END IF;

  SELECT id, version INTO v_old_id, v_version
  FROM public.tax_form_drafts
  WHERE client_id = p_client_id
    AND form_code = p_form_code
    AND tax_year = p_tax_year
    AND period IS NOT DISTINCT FROM p_period
    AND subject IS NOT DISTINCT FROM p_subject
    AND superseded_by IS NULL
  FOR UPDATE;

  -- Move the current row off the partial unique index before the insert.
  -- A failure rolls the transaction back, so the park does not stick.
  IF v_old_id IS NOT NULL THEN
    UPDATE public.tax_form_drafts
    SET superseded_by = id
    WHERE id = v_old_id;
  END IF;

  INSERT INTO public.tax_form_drafts (
    client_id, form_code, tax_year, period, subject,
    fields, approvals, status,
    approved_by, approved_by_name, approved_at, downloaded_at,
    version, supersedes_id, rules_year, field_sources
  ) VALUES (
    p_client_id, p_form_code, p_tax_year, p_period, p_subject,
    COALESCE(p_fields, '{}'::jsonb),
    COALESCE(p_approvals, '{}'::jsonb),
    COALESCE(p_status, 'draft'),
    p_approved_by, p_approved_by_name, p_approved_at, p_downloaded_at,
    COALESCE(v_version, 0) + 1,
    v_old_id,
    p_rules_year,
    COALESCE(p_field_sources, '{}'::jsonb)
  )
  RETURNING * INTO v_new;

  IF v_old_id IS NOT NULL THEN
    UPDATE public.tax_form_drafts
    SET superseded_by = v_new.id
    WHERE id = v_old_id;
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.save_tax_form_draft_version(
  uuid, text, integer, integer, text, jsonb, jsonb, text, uuid, text, timestamptz, timestamptz, integer, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tax_form_draft_version(
  uuid, text, integer, integer, text, jsonb, jsonb, text, uuid, text, timestamptz, timestamptz, integer, jsonb
) TO authenticated, service_role;
