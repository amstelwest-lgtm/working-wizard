-- ============================================================================
-- Practice firm auto-provision + human-visible SME client codes (MLN-XXXXXX).
-- Safe to re-run.
-- ============================================================================

-- ── 1. Client code column ────────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_code text;

CREATE OR REPLACE FUNCTION public.generate_client_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_chars text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text;
  i int;
BEGIN
  LOOP
    v_code := 'MLN-';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.clients WHERE client_code = v_code
    );
  END LOOP;
  RETURN v_code;
END;
$$;

UPDATE public.clients
SET client_code = public.generate_client_code()
WHERE client_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clients_client_code_uidx
  ON public.clients (client_code)
  WHERE client_code IS NOT NULL;

COMMENT ON COLUMN public.clients.client_code IS
  'Short public identifier (MLN-XXXXXX) shown to accountants when adding/inviting SMEs.';

-- ── 2. Ensure the calling accountant has a practice firm ─────────────────────
CREATE OR REPLACE FUNCTION public.ensure_practice_firm(p_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_firm_id uuid;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT f.id INTO v_firm_id
  FROM public.firms f
  WHERE f.owner_user_id = v_uid
  ORDER BY f.created_at ASC
  LIMIT 1;

  IF v_firm_id IS NULL THEN
    SELECT fm.firm_id INTO v_firm_id
    FROM public.firm_memberships fm
    WHERE fm.user_id = v_uid
    ORDER BY fm.created_at ASC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_firm_id IS NOT NULL THEN
    INSERT INTO public.firm_memberships (firm_id, user_id, role)
    VALUES (v_firm_id, v_uid, 'owner')
    ON CONFLICT (firm_id, user_id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    SELECT v_uid, 'firm_admin'::public.app_role
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = v_uid AND ur.role = 'firm_admin'
    );

    RETURN v_firm_id;
  END IF;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN
    v_name := 'My practice';
  END IF;

  INSERT INTO public.firms (name, owner_user_id)
  VALUES (v_name, v_uid)
  RETURNING id INTO v_firm_id;

  INSERT INTO public.firm_memberships (firm_id, user_id, role)
  VALUES (v_firm_id, v_uid, 'owner')
  ON CONFLICT (firm_id, user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  SELECT v_uid, 'firm_admin'::public.app_role
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.role = 'firm_admin'
  );

  RETURN v_firm_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_practice_firm(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_practice_firm(text) TO authenticated;

COMMENT ON FUNCTION public.ensure_practice_firm(text) IS
  'Returns the caller''s practice firm, creating one (plus membership + firm_admin) if missing.';

-- ── 3. create_firm_client: optional firm id + return code ────────────────────
DROP FUNCTION IF EXISTS public.create_firm_client(text, uuid, text);

CREATE OR REPLACE FUNCTION public.create_firm_client(
  p_name text,
  p_firm_id uuid DEFAULT NULL,
  p_business_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_client_id uuid;
  v_firm_id uuid := p_firm_id;
  v_code text;
  v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Client name is required';
  END IF;

  IF v_firm_id IS NULL THEN
    v_firm_id := public.ensure_practice_firm();
  END IF;

  SELECT exists (
    SELECT 1 FROM public.firms f
    WHERE f.id = v_firm_id
      AND (
        f.owner_user_id = v_uid
        OR public.is_firm_member(v_uid, f.id)
      )
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Not a member of this firm';
  END IF;

  v_code := public.generate_client_code();

  INSERT INTO public.clients (name, owner_user_id, firm_id, business_type, client_code)
  VALUES (
    trim(p_name),
    v_uid,
    v_firm_id,
    nullif(trim(coalesce(p_business_type, '')), ''),
    v_code
  )
  RETURNING id INTO v_client_id;

  RETURN jsonb_build_object(
    'id', v_client_id,
    'client_code', v_code,
    'firm_id', v_firm_id,
    'name', trim(p_name)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_firm_client(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_firm_client(text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.create_firm_client(text, uuid, text) IS
  'Inserts a practice client under a firm (auto-provisions the firm if needed) and returns id + client_code.';
