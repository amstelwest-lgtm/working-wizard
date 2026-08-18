-- Harden ensure_own_client empty-name insert (NOT NULL clients.name).
CREATE OR REPLACE FUNCTION public.ensure_own_client(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_client_id uuid;
  v_lock_key  bigint;
  v_name      text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_lock_key := ('x' || left(md5('ensure_own_client:' || v_uid::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT id INTO v_client_id
  FROM public.clients
  WHERE owner_user_id = v_uid AND firm_id IS NULL
  LIMIT 1;

  IF v_client_id IS NULL THEN
    v_name := COALESCE(NULLIF(trim(p_name), ''), 'My Business');
    INSERT INTO public.clients (name, owner_user_id)
    VALUES (v_name, v_uid)
    RETURNING id INTO v_client_id;
  END IF;

  IF to_regclass('public.client_memberships') IS NOT NULL THEN
    INSERT INTO public.client_memberships (client_id, user_id, role)
    VALUES (v_client_id, v_uid, 'client_owner')
    ON CONFLICT (client_id, user_id) DO UPDATE
      SET role = EXCLUDED.role
      WHERE public.client_memberships.role IS DISTINCT FROM EXCLUDED.role;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, 'client_owner');
  END IF;

  RETURN v_client_id;
END;
$$;
