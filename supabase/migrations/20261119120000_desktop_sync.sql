-- Desktop folder-sync (IM P3). New tables only. Does not alter existing
-- tables, policies, or functions. Apply on your schedule.
-- Service role writes devices and pairing. Device hashes are not readable from the browser.
-- Device tokens are SHA-256 hex hashes only.

CREATE TABLE IF NOT EXISTS public.desktop_sync_firms (
  firm_id uuid PRIMARY KEY REFERENCES public.firms(id) ON DELETE CASCADE,
  enabled_at timestamptz NOT NULL,
  enabled_by uuid NOT NULL REFERENCES auth.users(id),
  consent_notice_version text NOT NULL,
  consent_folder_labels text[] NOT NULL DEFAULT '{}',
  disabled_at timestamptz,
  CONSTRAINT desktop_sync_firms_consent_len CHECK (
    length(btrim(consent_notice_version)) BETWEEN 1 AND 80
  ),
  CONSTRAINT desktop_sync_firms_consent_pair CHECK (
  enabled_at IS NOT NULL AND consent_notice_version IS NOT NULL)
);

COMMENT ON TABLE public.desktop_sync_firms IS
  'Firm opt-in for desktop folder sync. Absent row means off.';

CREATE TABLE IF NOT EXISTS public.desktop_sync_folder_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  folder_label text NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT desktop_sync_folder_maps_label_len CHECK (
    length(btrim(folder_label)) BETWEEN 1 AND 80
  ),
  CONSTRAINT desktop_sync_folder_maps_label_unique UNIQUE (firm_id, folder_label)
);

CREATE INDEX IF NOT EXISTS desktop_sync_folder_maps_firm_idx
  ON public.desktop_sync_folder_maps (firm_id);

CREATE TABLE IF NOT EXISTS public.desktop_sync_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  device_label text NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  refresh_token_hash text NOT NULL CHECK (refresh_token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  paired_by uuid NOT NULL REFERENCES auth.users(id),
  paired_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  linked_upload_user_id uuid NOT NULL REFERENCES auth.users(id),
  usage_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Johannesburg')::date),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  usage_byte_count bigint NOT NULL DEFAULT 0 CHECK (usage_byte_count >= 0),
  CONSTRAINT desktop_sync_devices_token_hash_key UNIQUE (token_hash),
  CONSTRAINT desktop_sync_devices_refresh_hash_key UNIQUE (refresh_token_hash),
  CONSTRAINT desktop_sync_devices_label_len CHECK (
    length(btrim(device_label)) BETWEEN 1 AND 120
  )
);

CREATE INDEX IF NOT EXISTS desktop_sync_devices_firm_idx
  ON public.desktop_sync_devices (firm_id, paired_at DESC);

COMMENT ON COLUMN public.desktop_sync_devices.usage_date IS
  'SAST calendar day for daily upload caps. Server resets usage_count when the day changes.';
COMMENT ON COLUMN public.desktop_sync_devices.usage_byte_count IS
  'Bytes uploaded on usage_date. Paired with usage_count for daily caps.';

CREATE TABLE IF NOT EXISTS public.desktop_sync_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  device_label text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT desktop_sync_pairing_codes_hash_key UNIQUE (code_hash),
  CONSTRAINT desktop_sync_pairing_labels_len CHECK (
    length(btrim(device_label)) BETWEEN 1 AND 120
  )
);

CREATE INDEX IF NOT EXISTS desktop_sync_pairing_codes_firm_idx
  ON public.desktop_sync_pairing_codes (firm_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.desktop_sync_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.desktop_sync_devices(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id),
  kind text NOT NULL CHECK (kind IN (
    'enabled', 'disabled', 'paired', 'disconnected', 'upload', 'upload_rejected'
  )),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS desktop_sync_activity_firm_idx
  ON public.desktop_sync_activity (firm_id, created_at DESC);

-- Register a source document from a paired device upload. Service role only.
-- Does not grant execute to authenticated or anon.
CREATE OR REPLACE FUNCTION public.register_desktop_sync_source_document(
  p_client_id uuid,
  p_storage_path text,
  p_sha256 text,
  p_mime text,
  p_size_bytes bigint,
  p_uploaded_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sha text := lower(COALESCE(p_sha256, ''));
  v_mime text := lower(split_part(COALESCE(p_mime, ''), ';', 1));
  v_name text;
  v_path text;
  v_existing uuid;
  v_id uuid;
BEGIN
  IF p_uploaded_by IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'upload_forbidden');
  END IF;
  IF NOT COALESCE(public.source_doc_can_upload(p_uploaded_by, p_client_id), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'upload_forbidden');
  END IF;
  IF v_mime = 'image/jpg' THEN
    v_mime := 'image/jpeg';
  END IF;
  IF v_mime NOT IN (
    'application/pdf',
    'image/jpeg',
    'image/png',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mime_not_allowed');
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 20971520 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'size_not_allowed');
  END IF;
  IF v_sha !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sha256_invalid');
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

  INSERT INTO public.source_documents (
    client_id, uploaded_by, channel, storage_path, sha256, mime, size_bytes, status
  )
  VALUES (
    p_client_id, p_uploaded_by, 'upload', v_path, v_sha, v_mime, p_size_bytes, 'received'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'document_id', v_id
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT d.id INTO v_existing
    FROM public.source_documents d
    WHERE d.client_id = p_client_id AND d.sha256 = v_sha LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'document_id', v_existing);
END;
$$;

REVOKE ALL ON FUNCTION public.register_desktop_sync_source_document(
  uuid, text, text, text, bigint, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_desktop_sync_source_document(
  uuid, text, text, text, bigint, uuid
) TO service_role;

ALTER TABLE public.desktop_sync_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desktop_sync_folder_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desktop_sync_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desktop_sync_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desktop_sync_activity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.desktop_sync_firms FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.desktop_sync_folder_maps FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.desktop_sync_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.desktop_sync_pairing_codes FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.desktop_sync_activity FROM PUBLIC, anon;

CREATE POLICY desktop_sync_firms_select ON public.desktop_sync_firms
  FOR SELECT TO authenticated
  USING (public.is_firm_member(auth.uid(), firm_id));

CREATE POLICY desktop_sync_folder_maps_select ON public.desktop_sync_folder_maps
  FOR SELECT TO authenticated
  USING (public.is_firm_member(auth.uid(), firm_id));

CREATE POLICY desktop_sync_activity_select ON public.desktop_sync_activity
  FOR SELECT TO authenticated
  USING (public.is_firm_member(auth.uid(), firm_id));

GRANT SELECT ON TABLE public.desktop_sync_firms TO authenticated;
GRANT SELECT ON TABLE public.desktop_sync_folder_maps TO authenticated;
GRANT SELECT ON TABLE public.desktop_sync_activity TO authenticated;

GRANT ALL ON TABLE public.desktop_sync_firms TO service_role;
GRANT ALL ON TABLE public.desktop_sync_folder_maps TO service_role;
GRANT ALL ON TABLE public.desktop_sync_devices TO service_role;
GRANT ALL ON TABLE public.desktop_sync_pairing_codes TO service_role;
GRANT ALL ON TABLE public.desktop_sync_activity TO service_role;