-- Per-upload visibility for business-owner uploads.
--
-- Every file an owner uploads (bank statements, financial statements) is kept
-- in the private `client-documents` bucket with one row in client_artifacts
-- (kind = 'upload'). The row carries the owner's explicit choice:
--
--   private  — owner side only (client owner + client members). Accountants
--              cannot list, download or see it in Client Brain.
--   shared   — everyone with client access (linked firm, practice assignment,
--              firm managers) can list and download it.
--
-- Enforcement is in RLS, not the UI:
--   * client_artifacts SELECT/UPDATE/DELETE are gated on
--     can_view_client_artifact(uid, client_id, visibility).
--   * storage.objects for the bucket are gated through the artifact row that
--     owns the object path — no row, no access. Insert requires the row first
--     (created_by = uid), so an object can never exist without a visibility.
--
-- Default is private: nothing is shared unless the owner chose to share it.
-- Existing client_artifacts rows (snapshots, budgets, notes…) are backfilled
-- as 'shared' because they were always visible to the firm.

-- ── column ───────────────────────────────────────────────────────────────────

ALTER TABLE public.client_artifacts
  ADD COLUMN IF NOT EXISTS visibility text;

UPDATE public.client_artifacts SET visibility = 'shared' WHERE visibility IS NULL;

ALTER TABLE public.client_artifacts
  ALTER COLUMN visibility SET DEFAULT 'private',
  ALTER COLUMN visibility SET NOT NULL;

ALTER TABLE public.client_artifacts
  DROP CONSTRAINT IF EXISTS client_artifacts_visibility_check;
ALTER TABLE public.client_artifacts
  ADD CONSTRAINT client_artifacts_visibility_check
  CHECK (visibility IN ('private', 'shared'));

COMMENT ON COLUMN public.client_artifacts.visibility IS
  'private = owner side only (client owner + members); shared = anyone with client access (linked accountant). Chosen explicitly by the owner per upload.';

CREATE INDEX IF NOT EXISTS client_artifacts_client_kind_idx
  ON public.client_artifacts (client_id, kind, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS client_artifacts_storage_path_key
  ON public.client_artifacts (storage_path)
  WHERE storage_path IS NOT NULL;

-- ── helpers ──────────────────────────────────────────────────────────────────

-- Owner side of a client: the business owner or an invited client member.
-- Deliberately excludes practice / firm access and Milōn IT.
CREATE OR REPLACE FUNCTION public.is_client_owner_side(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = _client_id
      AND (
        c.owner_user_id = _user_id
        OR EXISTS (
          SELECT 1 FROM public.client_memberships m
          WHERE m.client_id = c.id AND m.user_id = _user_id
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_client_owner_side(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_client_owner_side(uuid, uuid) TO authenticated, service_role;

-- Owner side sees everything; everyone else with client access sees shared only.
CREATE OR REPLACE FUNCTION public.can_view_client_artifact(
  _user_id uuid,
  _client_id uuid,
  _visibility text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_client_owner_side(_user_id, _client_id)
    OR (
      _visibility = 'shared'
      AND public.has_client_access(_user_id, _client_id)
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_client_artifact(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_client_artifact(uuid, uuid, text) TO authenticated, service_role;

-- Storage object → artifact row → visibility check. Fails closed: an object
-- without a client_artifacts row is unreadable.
CREATE OR REPLACE FUNCTION public.can_read_client_document(_user_id uuid, _object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_artifacts a
    WHERE a.storage_path = _object_name
      AND public.can_view_client_artifact(_user_id, a.client_id, a.visibility)
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_client_document(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_client_document(uuid, text) TO authenticated, service_role;

-- Object may only be written by whoever created the artifact row for that
-- exact path, and only if they may view it (an accountant cannot create a
-- private object under someone else's client).
CREATE OR REPLACE FUNCTION public.can_write_client_document(_user_id uuid, _object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_artifacts a
    WHERE a.storage_path = _object_name
      AND a.created_by = _user_id
      AND public.can_view_client_artifact(_user_id, a.client_id, a.visibility)
  );
$$;

REVOKE ALL ON FUNCTION public.can_write_client_document(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_client_document(uuid, text) TO authenticated, service_role;

-- ── client_artifacts RLS ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "artifacts read by access" ON public.client_artifacts;
CREATE POLICY "artifacts read by access"
  ON public.client_artifacts FOR SELECT TO authenticated
  USING (public.can_view_client_artifact(auth.uid(), client_id, visibility));

-- Accountants may still record shared artifacts (e.g. their own uploads);
-- only the owner side may create private ones.
DROP POLICY IF EXISTS "artifacts insert by access" ON public.client_artifacts;
CREATE POLICY "artifacts insert by access"
  ON public.client_artifacts FOR INSERT TO authenticated
  WITH CHECK (
    (created_by IS NULL OR created_by = auth.uid())
    AND public.can_view_client_artifact(auth.uid(), client_id, visibility)
  );

-- Visibility changes: owner side can flip either way. An accountant can only
-- touch rows they can see (shared) and cannot make them private.
DROP POLICY IF EXISTS "artifacts update by access" ON public.client_artifacts;
CREATE POLICY "artifacts update by access"
  ON public.client_artifacts FOR UPDATE TO authenticated
  USING (public.can_view_client_artifact(auth.uid(), client_id, visibility))
  WITH CHECK (public.can_view_client_artifact(auth.uid(), client_id, visibility));

DROP POLICY IF EXISTS "artifacts delete by access" ON public.client_artifacts;
CREATE POLICY "artifacts delete by access"
  ON public.client_artifacts FOR DELETE TO authenticated
  USING (public.can_view_client_artifact(auth.uid(), client_id, visibility));

-- ── client-documents bucket ──────────────────────────────────────────────────
-- Objects live under {client_id}/{artifact_id}.{ext}. Unlike statement-uploads
-- (a waiting room the server empties), this bucket is the archive.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-documents',
  'client-documents',
  false,
  33554432,
  ARRAY[
    'application/pdf',
    'text/csv',
    'text/plain',
    'text/tab-separated-values',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroenabled.12',
    'application/vnd.oasis.opendocument.spreadsheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "client documents read by artifact" ON storage.objects;
CREATE POLICY "client documents read by artifact"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND public.can_read_client_document(auth.uid(), name)
  );

DROP POLICY IF EXISTS "client documents insert by artifact" ON storage.objects;
CREATE POLICY "client documents insert by artifact"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'client-documents'
    AND public.can_write_client_document(auth.uid(), name)
  );

-- Only the owner side may remove an archived document.
DROP POLICY IF EXISTS "client documents delete by owner side" ON storage.objects;
CREATE POLICY "client documents delete by owner side"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND EXISTS (
      SELECT 1 FROM public.client_artifacts a
      WHERE a.storage_path = storage.objects.name
        AND public.is_client_owner_side(auth.uid(), a.client_id)
    )
  );
