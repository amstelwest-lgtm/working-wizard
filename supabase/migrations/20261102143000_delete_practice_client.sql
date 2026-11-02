-- Hard-delete a practice client.
-- Soft-archive (clients.active = false) stays the reversible Remove path.
-- This function is the irreversible path: the caller must be allowed to edit
-- the client, and the typed name must match the stored name.
-- Child rows that already cascade from clients go with the row
-- (memberships, books, packs, notes, artifacts, agent sends, and the rest
-- of that graph). Storage objects keyed by this client are removed when
-- storage.objects is writable; a storage failure does not keep the row.
-- CoS applies this file on merge. It is not applied from the app.

CREATE OR REPLACE FUNCTION public.delete_practice_client(
  p_client_id uuid,
  p_confirm text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_expected text;
  v_given text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'Missing client';
  END IF;
  IF NOT public.is_client_writer(v_uid, p_client_id) THEN
    RAISE EXCEPTION 'You cannot delete this client';
  END IF;

  SELECT c.name INTO v_name
  FROM public.clients c
  WHERE c.id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  v_expected := lower(btrim(coalesce(v_name, '')));
  v_given := lower(btrim(coalesce(p_confirm, '')));
  IF v_expected = '' THEN
    IF v_given <> 'delete permanently' THEN
      RAISE EXCEPTION 'Type Delete permanently to confirm';
    END IF;
  ELSIF v_given IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Type the client name to confirm';
  END IF;

  -- Best-effort file cleanup. Paths follow the buckets this app writes.
  BEGIN
    DELETE FROM storage.objects o
    WHERE (
      o.bucket_id IN ('client-documents', 'source-docs')
      AND (
        o.name LIKE p_client_id::text || '/%'
        OR o.name LIKE lower(p_client_id::text) || '/%'
      )
    )
    OR (
      o.bucket_id = 'advisory-pdfs'
      AND o.name LIKE '%/' || p_client_id::text || '/%'
    )
    OR (
      o.bucket_id = 'client-agent-sends'
      AND EXISTS (
        SELECT 1
        FROM public.client_agent_sends s
        WHERE s.client_id = p_client_id
          AND o.name LIKE s.id::text || '/%'
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  DELETE FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not delete this client';
  END IF;
  RETURN p_client_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_practice_client(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_practice_client(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.delete_practice_client(uuid, text) IS
  'Permanently deletes a client the caller can edit, after the typed name matches. Related rows cascade. CoS applies this migration on merge.';
