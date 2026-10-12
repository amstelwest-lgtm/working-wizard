-- Source documents to a ledger proposal. Slice 1 stores the file, the
-- extraction, and a proposal. It does not post to Xero, QuickBooks, or Sage.
--
-- A proposal starts as proposed. Only a named human can approve it, and the
-- approval stores the hash of the exact payload. A later payload edit clears
-- that approval. Posting as final stays locked until the supplier has N clean
-- approved drafts (ledger_posting_config.final_unlock_after_clean_drafts,
-- default 3). Source files are kept for 5 years.
--
-- Approving a posting is not a sign-off. The decision values are approve and
-- reject. When the client has a firm, a firm member approves. When the client
-- has no firm, the owner approves.
--
-- UI hooks:
--   upload: bucket source-docs, path {client_id}/{object_name},
--           then register_source_document
--   proposals list: select ledger_post_proposals where client_id = ?
--   approve/reject: decide_ledger_post_proposal(id, 'approve'|'reject', note)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Config. N is editable by the service role. Retention stays 5 years.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_posting_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  final_unlock_after_clean_drafts integer NOT NULL DEFAULT 3 CHECK (final_unlock_after_clean_drafts >= 1),
  source_retention_years integer NOT NULL DEFAULT 5 CHECK (source_retention_years = 5),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ledger_posting_config (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

COMMENT ON TABLE public.ledger_posting_config IS
  'final_unlock_after_clean_drafts is the N=3 rule. source_retention_years stays 5.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_payload_sha256(p_canonical text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(convert_to(p_canonical, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.ledger_note_is_sign_off(p_note text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_note, '') ~* '\m(signed[[:space:]-]*off|sign[[:space:]-]*off)\M';
$$;

CREATE OR REPLACE FUNCTION public.normalise_supplier_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both FROM regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(COALESCE(p_name, '')), '&', ' and ', 'g'),
        '\m(proprietary|pty|ltd|limited|cc|inc|incorporated|llc|co|company)\M',
        ' ',
        'g'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    ),
    '[[:space:]]+',
    ' ',
    'g'
  ));
$$;

CREATE OR REPLACE FUNCTION public.normalise_document_number(p_number text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(COALESCE(p_number, ''), '[^A-Za-z0-9]+', '', 'g'));
$$;

-- Authenticated callers are checked as auth.uid(). The user-id argument is
-- only honoured for service_role (extract-source-document) and SQL sessions.
CREATE OR REPLACE FUNCTION public.source_doc_can_read(p_user_id uuid, p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_client_id IS NOT NULL AND public.has_client_access(
    CASE
      WHEN coalesce(auth.role(), '') = 'service_role' THEN p_user_id
      WHEN coalesce(auth.role(), '') = 'authenticated' THEN auth.uid()
      ELSE p_user_id
    END,
    p_client_id
  );
$$;

CREATE OR REPLACE FUNCTION public.source_doc_can_upload(p_user_id uuid, p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH actor AS (
    SELECT CASE
      WHEN coalesce(auth.role(), '') = 'service_role' THEN p_user_id
      WHEN coalesce(auth.role(), '') = 'authenticated' THEN auth.uid()
      ELSE p_user_id
    END AS user_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.clients c
    CROSS JOIN actor
    WHERE c.id = p_client_id
      AND (
        c.owner_user_id = actor.user_id
        OR (c.firm_id IS NOT NULL AND public.is_firm_member(actor.user_id, c.firm_id))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.source_doc_client_id_from_path(p_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  folder text;
BEGIN
  folder := split_part(COALESCE(p_name, ''), '/', 1);
  IF folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN folder::uuid;
  END IF;
  RETURN NULL;
END;
$$;

-- Not granted to authenticated. A signed-in session only sees the role for a
-- client auth.uid() can already access, so a client id cannot be probed.
CREATE OR REPLACE FUNCTION public.ledger_post_approver_role(p_client_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN c.firm_id IS NOT NULL THEN 'accountant'
    ELSE 'owner'
  END
  FROM public.clients c
  WHERE c.id = p_client_id
    AND (
      coalesce(auth.role(), '') IS DISTINCT FROM 'authenticated'
      OR public.has_client_access(auth.uid(), c.id)
    );
$$;

CREATE OR REPLACE FUNCTION public.ledger_post_caller_may_decide(p_user_id uuid, p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN c.firm_id IS NOT NULL THEN public.is_firm_member(p_user_id, c.firm_id)
    ELSE c.owner_user_id = p_user_id
  END
  FROM public.clients c
  WHERE c.id = p_client_id;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  channel text NOT NULL DEFAULT 'upload' CHECK (channel IN ('upload', 'camera', 'email')),
  storage_path text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  mime text NOT NULL CHECK (mime IN (
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
  )),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  status text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'extracting', 'extracted', 'extract_failed', 'rejected_intake', 'duplicate', 'proposed'
  )),
  received_at timestamptz NOT NULL DEFAULT now(),
  retention_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_documents_path_chk CHECK (
    storage_path = lower(client_id::text) || '/' || split_part(storage_path, '/', 2)
    AND split_part(storage_path, '/', 2) ~ '^[A-Za-z0-9._-]{1,200}$'
    AND split_part(storage_path, '/', 3) = ''
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS source_documents_client_sha256_uidx
  ON public.source_documents (client_id, sha256)
  WHERE status <> 'rejected_intake';

CREATE INDEX IF NOT EXISTS source_documents_client_idx
  ON public.source_documents (client_id, received_at DESC);

COMMENT ON TABLE public.source_documents IS
  'Private source file. retention_until is received_at plus 5 years. The bucket object uses the same path.';

CREATE TABLE IF NOT EXISTS public.supplier_trust (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  supplier_key text NOT NULL CHECK (length(supplier_key) > 0),
  display_name text,
  vat_number text,
  bank_fingerprint text,
  clean_approved_drafts integer NOT NULL DEFAULT 0 CHECK (clean_approved_drafts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, supplier_key)
);

COMMENT ON COLUMN public.supplier_trust.clean_approved_drafts IS
  'Clean approved drafts for this supplier. Final posting unlocks at ledger_posting_config.final_unlock_after_clean_drafts.';
COMMENT ON COLUMN public.supplier_trust.bank_fingerprint IS
  'Hash of bank details already held for this supplier. A source document must not write this column.';

CREATE TABLE IF NOT EXISTS public.document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.source_documents(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  model text NOT NULL,
  prompt_version text NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN (
    'bill', 'receipt', 'sales_invoice', 'credit_note', 'bank_statement', 'other'
  )),
  supplier_name text,
  supplier_vat_number text,
  supplier_key text,
  fields jsonb NOT NULL,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  totals_check jsonb NOT NULL,
  arithmetic_ok boolean NOT NULL,
  vat_claimable boolean NOT NULL DEFAULT false,
  tax_treatment text NOT NULL DEFAULT 'non_claimable' CHECK (tax_treatment IN ('claimable', 'non_claimable')),
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_usd numeric(12, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_extractions_fields_obj CHECK (jsonb_typeof(fields) = 'object'),
  CONSTRAINT document_extractions_lines_arr CHECK (jsonb_typeof(line_items) = 'array'),
  CONSTRAINT document_extractions_totals_obj CHECK (jsonb_typeof(totals_check) = 'object'),
  CONSTRAINT document_extractions_vat_chk CHECK (
    (
      vat_claimable = false
      AND tax_treatment = 'non_claimable'
    )
    OR (
      vat_claimable = true
      AND tax_treatment = 'claimable'
      AND supplier_vat_number IS NOT NULL
      AND supplier_vat_number ~ '^4[0-9]{9}$'
    )
  )
);

CREATE INDEX IF NOT EXISTS document_extractions_document_idx
  ON public.document_extractions (document_id, created_at DESC);

COMMENT ON COLUMN public.document_extractions.vat_claimable IS
  'SA input VAT defaults to non-claimable unless the document is a valid tax invoice with the supplier VAT number.';

CREATE TABLE IF NOT EXISTS public.ledger_post_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.source_documents(id) ON DELETE CASCADE,
  extraction_id uuid REFERENCES public.document_extractions(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  target_ledger text NOT NULL CHECK (target_ledger IN ('xero', 'qbo', 'sage')),
  doc_type text NOT NULL CHECK (doc_type IN ('bill', 'receipt')),
  mode text NOT NULL DEFAULT 'draft' CHECK (mode IN ('draft', 'final')),
  draft_holding text NOT NULL CHECK (draft_holding IN ('ledger_draft', 'held_in_milon')),
  canonical_payload text NOT NULL,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'approved', 'rejected', 'posted', 'failed'
  )),
  approver_role text CHECK (approver_role IS NULL OR approver_role IN ('accountant', 'owner')),
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  approval_payload_sha256 text CHECK (
    approval_payload_sha256 IS NULL OR approval_payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejection_note text,
  supplier_key text NOT NULL,
  supplier_display_name text,
  supplier_vat_number text,
  document_number text NOT NULL,
  amount numeric(14, 2) NOT NULL,
  issued_on date NOT NULL,
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  clean boolean NOT NULL DEFAULT false,
  trust_counted boolean NOT NULL DEFAULT false,
  proposed_by text NOT NULL DEFAULT 'agent' CHECK (proposed_by = 'agent'),
  posted_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_post_proposals_hash_chk CHECK (
    payload_sha256 = public.ledger_payload_sha256(canonical_payload)
  ),
  CONSTRAINT ledger_post_proposals_payload_chk CHECK (
    payload = canonical_payload::jsonb
  ),
  CONSTRAINT ledger_post_proposals_flags_obj CHECK (jsonb_typeof(flags) = 'object'),
  CONSTRAINT ledger_post_proposals_holding_chk CHECK (
    (target_ledger = 'xero' AND draft_holding = 'ledger_draft')
    OR (target_ledger IN ('qbo', 'sage') AND draft_holding = 'held_in_milon')
  ),
  CONSTRAINT ledger_post_proposals_approval_lock CHECK (
    status NOT IN ('approved', 'posted')
    OR (
      approved_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND approval_payload_sha256 IS NOT NULL
      AND approval_payload_sha256 = payload_sha256
      AND approver_role IN ('accountant', 'owner')
    )
  ),
  CONSTRAINT ledger_post_proposals_rejected_chk CHECK (
    status <> 'rejected'
    OR (
      rejected_by IS NOT NULL
      AND rejected_at IS NOT NULL
      AND approved_by IS NULL
      AND approval_payload_sha256 IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS ledger_post_proposals_client_idx
  ON public.ledger_post_proposals (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ledger_post_proposals_semantic_idx
  ON public.ledger_post_proposals (client_id, supplier_key, document_number, issued_on);

COMMENT ON TABLE public.ledger_post_proposals IS
  'Agent proposal. approved_by is a human. approval_payload_sha256 must equal payload_sha256. An edit clears the approval.';
COMMENT ON COLUMN public.ledger_post_proposals.draft_holding IS
  'Xero can hold a real ledger draft. QuickBooks and Sage stay held in Milōn until a final post.';

-- Created after supplier_trust. A SQL function body is checked at CREATE time.
CREATE OR REPLACE FUNCTION public.supplier_final_unlocked(p_client_id uuid, p_supplier_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT COALESCE(t.clean_approved_drafts, 0) >= c.final_unlock_after_clean_drafts
    FROM public.ledger_posting_config c
    LEFT JOIN public.supplier_trust t
      ON t.client_id = p_client_id
     AND t.supplier_key = p_supplier_key
    WHERE c.singleton
  ), false);
$$;

REVOKE ALL ON FUNCTION public.supplier_final_unlocked(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_final_unlocked(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.source_documents_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_years integer;
BEGIN
  SELECT source_retention_years INTO v_years
  FROM public.ledger_posting_config
  WHERE singleton;
  IF v_years IS NULL OR v_years < 5 THEN
    v_years := 5;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- auth.role() <> 'service_role' is unknown when there is no JWT, so a SQL
    -- session can still set received_at. Signed-in users cannot.
    IF auth.role() <> 'service_role' THEN
      NEW.received_at := now();
      NEW.status := 'received';
    END IF;
    NEW.sha256 := lower(NEW.sha256);
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.received_at := OLD.received_at;
    NEW.uploaded_by := OLD.uploaded_by;
    NEW.client_id := OLD.client_id;
    NEW.sha256 := OLD.sha256;
    NEW.storage_path := OLD.storage_path;
  END IF;
  NEW.retention_until := COALESCE(NEW.received_at, now()) + make_interval(years => v_years);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_documents_guard ON public.source_documents;
CREATE TRIGGER source_documents_guard
  BEFORE INSERT OR UPDATE ON public.source_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.source_documents_guard();

CREATE OR REPLACE FUNCTION public.document_extractions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.source_documents d
    WHERE d.id = NEW.document_id
      AND d.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'extraction_client_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_extractions_guard ON public.document_extractions;
CREATE TRIGGER document_extractions_guard
  BEFORE INSERT OR UPDATE ON public.document_extractions
  FOR EACH ROW
  EXECUTE FUNCTION public.document_extractions_guard();

CREATE OR REPLACE FUNCTION public.supplier_trust_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.bank_fingerprint IS DISTINCT FROM OLD.bank_fingerprint THEN
    RAISE EXCEPTION 'supplier_bank_details_locked';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_trust_guard ON public.supplier_trust;
CREATE TRIGGER supplier_trust_guard
  BEFORE UPDATE ON public.supplier_trust
  FOR EACH ROW
  EXECUTE FUNCTION public.supplier_trust_guard();

CREATE OR REPLACE FUNCTION public.ledger_post_proposals_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_key text;
  v_clean_keys text[] := ARRAY[
    'low_confidence',
    'arithmetic_mismatch',
    'duplicate_file',
    'duplicate_document',
    'bank_details_changed',
    'new_supplier'
  ];
BEGIN
  NEW.supplier_key := public.normalise_supplier_key(NEW.supplier_key);
  NEW.document_number := public.normalise_document_number(NEW.document_number);
  IF NEW.supplier_key = '' OR NEW.document_number = '' THEN
    RAISE EXCEPTION 'supplier_or_number_required';
  END IF;

  IF NEW.payload IS NULL OR jsonb_typeof(NEW.payload) <> 'object' THEN
    RAISE EXCEPTION 'payload_invalid';
  END IF;
  IF NEW.payload -> 'guards' IS NULL OR jsonb_typeof(NEW.payload -> 'guards') <> 'object' THEN
    RAISE EXCEPTION 'payload_guards_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.source_documents d
    WHERE d.id = NEW.document_id
      AND d.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'proposal_client_mismatch';
  END IF;

  FOREACH v_key IN ARRAY v_clean_keys LOOP
    IF COALESCE(NEW.flags -> v_key, 'false'::jsonb)
       IS DISTINCT FROM COALESCE(NEW.payload -> 'guards' -> v_key, 'false'::jsonb) THEN
      RAISE EXCEPTION 'payload_guards_mismatch';
    END IF;
  END LOOP;

  NEW.clean :=
    NOT COALESCE((NEW.flags -> 'low_confidence') = 'true'::jsonb, false)
    AND NOT COALESCE((NEW.flags -> 'arithmetic_mismatch') = 'true'::jsonb, false)
    AND NOT COALESCE((NEW.flags -> 'duplicate_file') = 'true'::jsonb, false)
    AND NOT COALESCE((NEW.flags -> 'duplicate_document') = 'true'::jsonb, false)
    AND NOT COALESCE((NEW.flags -> 'bank_details_changed') = 'true'::jsonb, false);

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' THEN
      RAISE EXCEPTION 'proposal_must_start_proposed';
    END IF;
    IF NEW.approved_by IS NOT NULL OR NEW.approval_payload_sha256 IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'proposal_cannot_arrive_approved';
    END IF;
    NEW.proposed_by := 'agent';
    NEW.trust_counted := false;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status = 'posted' AND (
    NEW.canonical_payload IS DISTINCT FROM OLD.canonical_payload
    OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.status IS DISTINCT FROM 'posted'
    OR NEW.supplier_key IS DISTINCT FROM OLD.supplier_key
    OR NEW.document_number IS DISTINCT FROM OLD.document_number
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.issued_on IS DISTINCT FROM OLD.issued_on
    OR NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
    OR NEW.target_ledger IS DISTINCT FROM OLD.target_ledger
    OR NEW.mode IS DISTINCT FROM OLD.mode
    OR NEW.draft_holding IS DISTINCT FROM OLD.draft_holding
  ) THEN
    RAISE EXCEPTION 'posted_payload_locked';
  END IF;

  IF OLD.trust_counted IS TRUE AND (
    NEW.status NOT IN ('approved', 'posted')
    OR NEW.canonical_payload IS DISTINCT FROM OLD.canonical_payload
  ) THEN
    UPDATE public.supplier_trust
      SET clean_approved_drafts = GREATEST(0, clean_approved_drafts - 1)
      WHERE client_id = OLD.client_id
        AND supplier_key = OLD.supplier_key;
    NEW.trust_counted := false;
  END IF;

  IF NEW.canonical_payload IS DISTINCT FROM OLD.canonical_payload
     OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
     OR NEW.payload IS DISTINCT FROM OLD.payload THEN
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.approval_payload_sha256 := NULL;
    NEW.approver_role := NULL;
    NEW.version := OLD.version + 1;
    IF NEW.status IN ('approved', 'posted') OR OLD.status = 'approved' THEN
      NEW.status := 'proposed';
    END IF;
  END IF;

  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'approval_requires_human';
    END IF;
    IF NOT COALESCE(public.ledger_post_caller_may_decide(auth.uid(), NEW.client_id), false) THEN
      RAISE EXCEPTION 'approver_forbidden';
    END IF;
    IF public.ledger_note_is_sign_off(NEW.rejection_note) THEN
      RAISE EXCEPTION 'signed_off_refused';
    END IF;
    v_role := public.ledger_post_approver_role(NEW.client_id);
    IF v_role IS NULL OR v_role NOT IN ('accountant', 'owner') THEN
      RAISE EXCEPTION 'approver_forbidden';
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
    NEW.approval_payload_sha256 := NEW.payload_sha256;
    NEW.approver_role := v_role;
    NEW.rejected_by := NULL;
    NEW.rejected_at := NULL;
    NEW.rejection_note := NULL;
    IF NEW.clean AND NOT NEW.trust_counted AND length(COALESCE(NEW.supplier_key, '')) > 0 THEN
      INSERT INTO public.supplier_trust AS trust (
        client_id, supplier_key, display_name, vat_number, clean_approved_drafts
      )
      VALUES (
        NEW.client_id,
        NEW.supplier_key,
        NULLIF(NEW.supplier_display_name, ''),
        NULLIF(NEW.supplier_vat_number, ''),
        1
      )
      ON CONFLICT (client_id, supplier_key) DO UPDATE
        SET clean_approved_drafts = trust.clean_approved_drafts + 1,
            display_name = COALESCE(trust.display_name, EXCLUDED.display_name),
            vat_number = COALESCE(trust.vat_number, EXCLUDED.vat_number),
            updated_at = now();
      NEW.trust_counted := true;
    END IF;
  END IF;

  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'rejection_requires_human';
    END IF;
    IF NOT COALESCE(public.ledger_post_caller_may_decide(auth.uid(), NEW.client_id), false) THEN
      RAISE EXCEPTION 'approver_forbidden';
    END IF;
    IF public.ledger_note_is_sign_off(NEW.rejection_note) THEN
      RAISE EXCEPTION 'signed_off_refused';
    END IF;
    NEW.rejected_by := auth.uid();
    NEW.rejected_at := now();
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.approval_payload_sha256 := NULL;
    NEW.approver_role := NULL;
  END IF;

  IF NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    IF OLD.status <> 'approved' THEN
      RAISE EXCEPTION 'post_requires_approval';
    END IF;
    IF NEW.approved_by IS NULL
       OR NEW.approved_at IS NULL
       OR NEW.approval_payload_sha256 IS NULL
       OR NEW.approval_payload_sha256 IS DISTINCT FROM NEW.payload_sha256 THEN
      RAISE EXCEPTION 'payload_hash_mismatch';
    END IF;
    NEW.posted_at := COALESCE(NEW.posted_at, now());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_post_proposals_guard ON public.ledger_post_proposals;
CREATE TRIGGER ledger_post_proposals_guard
  BEFORE INSERT OR UPDATE ON public.ledger_post_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.ledger_post_proposals_guard();

-- ---------------------------------------------------------------------------
-- Duplicate lookup. Same file hash, or same supplier + number + amount + date
-- (date within 3 days). Rejected rows do not count.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.find_source_document_duplicates(
  p_client_id uuid,
  p_sha256 text,
  p_supplier_key text,
  p_document_number text,
  p_amount numeric,
  p_issued_on date,
  p_exclude_document_id uuid DEFAULT NULL
)
RETURNS TABLE (kind text, document_id uuid, proposal_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'file'::text, d.id, NULL::uuid
  FROM public.source_documents d
  WHERE d.client_id = p_client_id
    AND d.sha256 = lower(COALESCE(p_sha256, ''))
    AND d.status <> 'rejected_intake'
    AND (p_exclude_document_id IS NULL OR d.id <> p_exclude_document_id)
  UNION ALL
  SELECT 'semantic'::text, p.document_id, p.id
  FROM public.ledger_post_proposals p
  WHERE p.client_id = p_client_id
    AND p.status <> 'rejected'
    AND public.normalise_supplier_key(p_supplier_key) <> ''
    AND public.normalise_document_number(p_document_number) <> ''
    AND p.supplier_key = public.normalise_supplier_key(p_supplier_key)
    AND p.document_number = public.normalise_document_number(p_document_number)
    AND abs(p.amount - p_amount) <= 0.01
    AND abs(p.issued_on - p_issued_on) <= 3
    AND (p_exclude_document_id IS NULL OR p.document_id <> p_exclude_document_id);
$$;

-- ---------------------------------------------------------------------------
-- Register and decide. Humans call these. The agent does not.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_source_document(
  p_client_id uuid,
  p_storage_path text,
  p_sha256 text,
  p_mime text,
  p_size_bytes bigint,
  p_channel text DEFAULT 'upload'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sha text := lower(COALESCE(p_sha256, ''));
  v_mime text := lower(split_part(COALESCE(p_mime, ''), ';', 1));
  v_channel text := COALESCE(NULLIF(p_channel, ''), 'upload');
  v_name text;
  v_path text;
  v_existing uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorised');
  END IF;
  IF NOT COALESCE(public.source_doc_can_upload(v_uid, p_client_id), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'upload_forbidden');
  END IF;
  IF v_mime = 'image/jpg' THEN
    v_mime := 'image/jpeg';
  END IF;
  IF v_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mime_not_allowed');
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 20971520 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'size_not_allowed');
  END IF;
  IF v_sha !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sha256_invalid');
  END IF;
  IF v_channel NOT IN ('upload', 'camera', 'email') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'channel_invalid');
  END IF;
  v_name := split_part(COALESCE(p_storage_path, ''), '/', 2);
  IF split_part(COALESCE(p_storage_path, ''), '/', 1) IS DISTINCT FROM p_client_id::text
     OR v_name !~ '^[A-Za-z0-9._-]{1,200}$'
     OR split_part(p_storage_path, '/', 3) <> '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'storage_path_invalid');
  END IF;
  v_path := p_client_id::text || '/' || v_name;

  SELECT d.id INTO v_existing
  FROM public.source_documents d
  WHERE d.client_id = p_client_id
    AND d.sha256 = v_sha
    AND d.status <> 'rejected_intake'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'document_id', v_existing);
  END IF;

  BEGIN
    INSERT INTO public.source_documents (
      client_id, uploaded_by, channel, storage_path, sha256, mime, size_bytes, status
    )
    VALUES (
      p_client_id, v_uid, v_channel, v_path, v_sha, v_mime, p_size_bytes, 'received'
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT d.id INTO v_existing
      FROM public.source_documents d
      WHERE d.client_id = p_client_id
        AND d.sha256 = v_sha
        AND d.status <> 'rejected_intake'
      LIMIT 1;
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'document_id', v_existing);
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'document_id', v_id,
    'storage_path', v_path,
    'retention_until', (SELECT retention_until FROM public.source_documents WHERE id = v_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_ledger_post_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.ledger_post_proposals%ROWTYPE;
  v_updated public.ledger_post_proposals%ROWTYPE;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorised');
  END IF;
  IF public.ledger_note_is_sign_off(p_decision) OR public.ledger_note_is_sign_off(p_note) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'signed_off_refused');
  END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'decision_invalid');
  END IF;

  SELECT * INTO v_row
  FROM public.ledger_post_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  v_role := public.ledger_post_approver_role(v_row.client_id);
  IF NOT COALESCE(public.ledger_post_caller_may_decide(v_uid, v_row.client_id), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'approver_forbidden', 'approver_role', v_role);
  END IF;

  IF p_decision = 'approve'
     AND v_row.status = 'approved'
     AND v_row.approved_by = v_uid
     AND v_row.approval_payload_sha256 = v_row.payload_sha256
     AND v_row.approved_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already', true,
      'proposal_id', v_row.id,
      'status', 'approved',
      'approved_by', v_row.approved_by,
      'approved_at', v_row.approved_at,
      'approval_payload_sha256', v_row.approval_payload_sha256,
      'approver_role', v_row.approver_role
    );
  END IF;

  IF v_row.status <> 'proposed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_proposed', 'status', v_row.status, 'approver_role', v_role);
  END IF;

  BEGIN
    IF p_decision = 'approve' THEN
      UPDATE public.ledger_post_proposals
        SET status = 'approved'
        WHERE id = p_proposal_id
          AND status = 'proposed'
        RETURNING * INTO v_updated;
    ELSE
      UPDATE public.ledger_post_proposals
        SET status = 'rejected',
            rejection_note = NULLIF(left(COALESCE(p_note, ''), 2000), '')
        WHERE id = p_proposal_id
          AND status = 'proposed'
        RETURNING * INTO v_updated;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  IF v_updated.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_proposed', 'approver_role', v_role);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already', false,
    'proposal_id', v_updated.id,
    'status', v_updated.status,
    'approved_by', v_updated.approved_by,
    'approved_at', v_updated.approved_at,
    'approval_payload_sha256', v_updated.approval_payload_sha256,
    'approver_role', v_updated.approver_role,
    'rejected_by', v_updated.rejected_by
  );
END;
$$;

COMMENT ON FUNCTION public.decide_ledger_post_proposal IS
  'Human approve or reject. Stores approval_payload_sha256 of the current payload. Not a sign-off.';

-- ---------------------------------------------------------------------------
-- RLS. Client members read. Owners and the client firm upload.
-- Proposals and extractions are written by the service role. Approval goes
-- through decide_ledger_post_proposal.
-- ---------------------------------------------------------------------------

ALTER TABLE public.ledger_posting_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_post_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_trust ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger posting config read" ON public.ledger_posting_config;
CREATE POLICY "ledger posting config read"
  ON public.ledger_posting_config FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "source documents read by client access" ON public.source_documents;
CREATE POLICY "source documents read by client access"
  ON public.source_documents FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "source documents insert by owner or firm" ON public.source_documents;
CREATE POLICY "source documents insert by owner or firm"
  ON public.source_documents FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.source_doc_can_upload(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "document extractions read by client access" ON public.document_extractions;
CREATE POLICY "document extractions read by client access"
  ON public.document_extractions FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "ledger post proposals read by client access" ON public.ledger_post_proposals;
CREATE POLICY "ledger post proposals read by client access"
  ON public.ledger_post_proposals FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

DROP POLICY IF EXISTS "supplier trust read by client access" ON public.supplier_trust;
CREATE POLICY "supplier trust read by client access"
  ON public.supplier_trust FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

REVOKE ALL ON public.ledger_posting_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.source_documents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.document_extractions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ledger_post_proposals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.supplier_trust FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.ledger_posting_config TO authenticated;
GRANT SELECT, INSERT ON public.source_documents TO authenticated;
GRANT SELECT ON public.document_extractions TO authenticated;
GRANT SELECT ON public.ledger_post_proposals TO authenticated;
GRANT SELECT ON public.supplier_trust TO authenticated;

GRANT ALL ON public.ledger_posting_config TO service_role;
GRANT ALL ON public.source_documents TO service_role;
GRANT ALL ON public.document_extractions TO service_role;
GRANT ALL ON public.ledger_post_proposals TO service_role;
GRANT ALL ON public.supplier_trust TO service_role;

REVOKE ALL ON FUNCTION public.ledger_payload_sha256(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_note_is_sign_off(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalise_supplier_key(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalise_document_number(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.source_doc_can_read(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.source_doc_can_upload(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.source_doc_client_id_from_path(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_post_approver_role(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_post_caller_may_decide(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.find_source_document_duplicates(uuid, text, text, text, numeric, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_source_document(uuid, text, text, text, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_ledger_post_proposal(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.source_doc_can_read(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_doc_can_upload(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_doc_client_id_from_path(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_post_approver_role(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_source_document(uuid, text, text, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_ledger_post_proposal(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_source_document_duplicates(uuid, text, text, text, numeric, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ledger_payload_sha256(text) TO service_role;

-- ---------------------------------------------------------------------------
-- Private bucket. Client members read. Owners and firm members upload.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'source-docs',
  'source-docs',
  false,
  20971520,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "source docs read by client access" ON storage.objects;
CREATE POLICY "source docs read by client access"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'source-docs'
    AND public.source_doc_can_read(auth.uid(), public.source_doc_client_id_from_path(name))
  );

DROP POLICY IF EXISTS "source docs insert by owner or firm" ON storage.objects;
CREATE POLICY "source docs insert by owner or firm"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'source-docs'
    AND public.source_doc_can_upload(auth.uid(), public.source_doc_client_id_from_path(name))
  );
