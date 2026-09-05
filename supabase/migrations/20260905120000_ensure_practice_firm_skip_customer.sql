-- Fresh owner signups have no user_roles yet. The previous skip only
-- no-op'd when a client_owner row already existed, so hydrating
-- AccountantProfileProvider minted a practice + firm_admin and dumped
-- US/ZA business owners into the accountant portal.
--
-- Only create or attach a practice firm when the caller already holds a
-- practice role, or their auth metadata is an accountant signup.

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
  v_is_practice boolean;
  v_signup_type text;
  v_firm_name text;
  v_practice_signup boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.role IN ('accountant', 'firm_admin')
  ) INTO v_is_practice;

  SELECT
    nullif(trim(coalesce(u.raw_user_meta_data->>'signup_type', '')), ''),
    nullif(trim(coalesce(u.raw_user_meta_data->>'firm_name', '')), '')
  INTO v_signup_type, v_firm_name
  FROM auth.users u
  WHERE u.id = v_uid;

  v_practice_signup := (v_signup_type = 'accountant') OR (v_firm_name IS NOT NULL);

  IF NOT v_is_practice AND NOT v_practice_signup THEN
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

  v_name := nullif(trim(coalesce(p_name, v_firm_name, '')), '');
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
  'Returns the caller''s practice firm, creating one (plus membership + firm_admin) if missing. No-ops unless the caller already has a practice role or accountant signup metadata.';
