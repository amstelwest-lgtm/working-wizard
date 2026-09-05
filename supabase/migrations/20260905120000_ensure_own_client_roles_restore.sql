-- Restore the client_owner membership/role writes in ensure_own_client.
--
-- 20260904180000_client_firm_market.sql re-created ensure_own_client to accept
-- a market but dropped the membership + user_roles inserts (added in
-- 20260818120000) and the empty-name fallback (20260818130000). A self-signup
-- owner who confirms by email therefore reached /app with zero rows in
-- user_roles. AccountantProfileProvider read "no roles" as "accountant",
-- minted a practice firm via ensure_practice_firm, and the owner landed on
-- /dashboard on the next sign-in. The client now guards against that too, but
-- the RPC should write the role it always used to.

CREATE OR REPLACE FUNCTION public.ensure_own_client(p_name text, p_market jsonb DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_client_id uuid;
  v_lock_key  bigint;
  v_market    jsonb := p_market;
  v_name      text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_market IS NOT NULL AND NOT public.market_json_ok(v_market) THEN
    RAISE EXCEPTION 'Invalid market selection';
  END IF;
  IF v_market IS NULL THEN
    v_market := '{"country":"ZA","regionCode":null}'::jsonb;
  END IF;

  v_lock_key := ('x' || left(md5('ensure_own_client:' || v_uid::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT id INTO v_client_id
  FROM public.clients
  WHERE owner_user_id = v_uid AND firm_id IS NULL
  LIMIT 1;

  IF v_client_id IS NULL THEN
    v_name := COALESCE(NULLIF(trim(p_name), ''), 'My Business');
    INSERT INTO public.clients (
      name,
      owner_user_id,
      market,
      financial_year_start_month
    )
    VALUES (
      v_name,
      v_uid,
      v_market,
      CASE WHEN v_market->>'country' = 'US' THEN 1 ELSE 3 END
    )
    RETURNING id INTO v_client_id;
  END IF;

  IF to_regclass('public.client_memberships') IS NOT NULL THEN
    INSERT INTO public.client_memberships (client_id, user_id, role)
    VALUES (v_client_id, v_uid, 'client_owner')
    ON CONFLICT (client_id, user_id) DO UPDATE
      SET role = EXCLUDED.role
      WHERE public.client_memberships.role IS DISTINCT FROM EXCLUDED.role;
  END IF;

  -- Only insert client_owner when the user has no role yet — never escalate
  -- or duplicate a practice role (dual-role founders keep firm_admin).
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, 'client_owner');
  END IF;

  RETURN v_client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_own_client(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_own_client(text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.ensure_own_client(text, jsonb) IS
  'Returns the caller''s own (firm-less) client, creating it with the given market when missing, and ensures client_owner membership + role (never escalates an existing practice role).';

-- ensure_practice_firm: a session whose JWT says it signed up as a business
-- owner never gets a practice firm, even if its user_roles row is not written
-- yet (the window between email confirmation and ensure_own_client).
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
  v_signup_type text;
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

  BEGIN
    v_signup_type := auth.jwt() -> 'user_metadata' ->> 'signup_type';
  EXCEPTION WHEN OTHERS THEN
    v_signup_type := NULL;
  END;

  -- Pure (or not-yet-promoted) business clients never get a practice firm here.
  IF v_is_client AND NOT v_is_practice THEN
    RETURN NULL;
  END IF;
  IF NOT v_is_practice AND v_signup_type = 'customer' THEN
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
  'Returns the caller''s practice firm, creating one (plus membership + firm_admin) if missing. No-ops for business-client accounts (by role, or by signup_type=customer in the JWT when roles are not written yet).';
