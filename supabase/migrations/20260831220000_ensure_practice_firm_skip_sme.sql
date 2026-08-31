-- Do not mint a practice firm (or firm_admin) for a business-client login.
-- Visiting /auth or hydrating AccountantProfileProvider used to call
-- ensure_practice_firm for every authenticated user with zero firms, which
-- promoted SME owners (e.g. Karoo Traders) into the accountant portal.

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
  v_is_client boolean;
  v_is_practice boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.role IN ('client_owner', 'client_member')
  ) INTO v_is_client;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.role IN ('accountant', 'firm_admin')
  ) INTO v_is_practice;

  -- Pure (or not-yet-promoted) business clients never get a practice firm here.
  IF v_is_client AND NOT v_is_practice THEN
    RETURN NULL;
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

  -- Existing practice role but no firm yet (true accountant provisioning).
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

COMMENT ON FUNCTION public.ensure_practice_firm(text) IS
  'Returns the caller''s practice firm, creating one (plus membership + firm_admin) if missing. No-ops for business-client accounts that do not already hold a practice role.';
