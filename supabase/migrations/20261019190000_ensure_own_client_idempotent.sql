-- ensure_own_client stays idempotent after a firm link.
--
-- The previous body treated only owner_user_id = me AND firm_id IS NULL as the
-- existing seat. Once that business was linked to a firm, every owner-door
-- Google sign-in, landing signup, and /app step 4 inserted another blank client.
--
-- Keep the advisory lock. Return the firm-unlinked owned client, else the
-- oldest owned client that has a client_owner membership, else the oldest
-- owned client. Insert only when the user owns nothing.
--
-- Owners legitimately own several clients in one firm. This migration does
-- not add a unique index on (owner_user_id, firm_id), and it does not update
-- or delete existing client rows.

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

  SELECT c.id INTO v_client_id
  FROM public.clients c
  WHERE c.owner_user_id = v_uid
    AND c.firm_id IS NULL
  ORDER BY c.created_at ASC, c.id ASC
  LIMIT 1;

  IF v_client_id IS NULL AND to_regclass('public.client_memberships') IS NOT NULL THEN
    SELECT c.id INTO v_client_id
    FROM public.clients c
    INNER JOIN public.client_memberships m
      ON m.client_id = c.id
     AND m.user_id = v_uid
     AND m.role = 'client_owner'
    WHERE c.owner_user_id = v_uid
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT 1;
  END IF;

  IF v_client_id IS NULL THEN
    SELECT c.id INTO v_client_id
    FROM public.clients c
    WHERE c.owner_user_id = v_uid
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT 1;
  END IF;

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
  'Returns the caller''s existing owned client (firm-unlinked, else oldest client_owner membership, else oldest owned) and creates one only when the caller owns nothing. Ensures client_owner membership + role without escalating a practice role.';
