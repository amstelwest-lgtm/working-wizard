-- Re-apply the link_client_firm lockdown.
-- 20261013150000 may already be applied with EXECUTE granted to authenticated.
-- That grant let any firm member attach any unlinked client. This migration
-- is the same function text as the corrected 20261013150000, so a fresh
-- database and an already-applied one both end on the locked definition.
-- Signed-in users do not execute link_client_firm. Invite redeem uses
-- service_role. Marketplace accept calls it from accountant_request_respond,
-- which is SECURITY DEFINER and runs as the function owner.

-- Service role (invite redeem) and SECURITY DEFINER callers (marketplace
-- accept) attach a client. Signed-in users cannot execute this. When a JWT
-- is present anyway, the caller must own the client or the client must have
-- an open or accepted request for this firm.
CREATE OR REPLACE FUNCTION public.link_client_firm(
  p_client_id uuid,
  p_firm_id uuid,
  p_accepted_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_role text := coalesce(auth.role(), '');
  v_owner uuid;
BEGIN
  IF p_client_id IS NULL OR p_firm_id IS NULL THEN
    RAISE EXCEPTION 'client and firm are required';
  END IF;

  IF v_uid IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;
    v_actor := p_accepted_by;
  ELSE
    v_actor := v_uid;
    SELECT c.owner_user_id INTO v_owner
    FROM public.clients c
    WHERE c.id = p_client_id;
    IF v_owner IS DISTINCT FROM v_uid AND NOT EXISTS (
      SELECT 1
      FROM public.accountant_requests r
      WHERE r.client_id = p_client_id
        AND r.firm_id = p_firm_id
        AND r.status IN ('open', 'accepted')
    ) THEN
      RAISE EXCEPTION 'Only the business owner or an accepted firm request can link this client';
    END IF;
  END IF;

  IF v_actor IS NULL OR NOT public.is_firm_member(v_actor, p_firm_id) THEN
    RAISE EXCEPTION 'Only a member of the firm can link this client';
  END IF;

  PERFORM set_config('milon.firm_link', 'accept', true);

  UPDATE public.clients
  SET
    firm_id = p_firm_id,
    firm_connected_at = COALESCE(firm_connected_at, now()),
    firm_link_accepted_at = COALESCE(firm_link_accepted_at, now()),
    firm_link_accepted_by = COALESCE(firm_link_accepted_by, v_actor)
  WHERE id = p_client_id
    AND (firm_id IS NULL OR firm_id = p_firm_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client is linked to a different firm';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.link_client_firm(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_client_firm(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.link_client_firm(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.link_client_firm(uuid, uuid, uuid) TO service_role;

-- Dashboard orphan attach. The caller must own the client and belong to the firm.
CREATE OR REPLACE FUNCTION public.link_own_client_to_firm(
  p_client_id uuid,
  p_firm_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_client_id IS NULL OR p_firm_id IS NULL THEN
    RAISE EXCEPTION 'client and firm are required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = p_client_id
      AND c.owner_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Only the business owner can link this client';
  END IF;
  IF NOT public.is_firm_member(v_uid, p_firm_id) THEN
    RAISE EXCEPTION 'Only a member of the firm can link this client';
  END IF;

  PERFORM set_config('milon.firm_link', 'accept', true);

  UPDATE public.clients
  SET
    firm_id = p_firm_id,
    firm_connected_at = COALESCE(firm_connected_at, now()),
    firm_link_accepted_at = COALESCE(firm_link_accepted_at, now()),
    firm_link_accepted_by = COALESCE(firm_link_accepted_by, v_uid)
  WHERE id = p_client_id
    AND owner_user_id = v_uid
    AND (firm_id IS NULL OR firm_id = p_firm_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client is linked to a different firm';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.link_own_client_to_firm(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_own_client_to_firm(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_own_client_to_firm(uuid, uuid) TO authenticated;

-- Firm-created clients stamp acceptance in the same insert.
CREATE OR REPLACE FUNCTION public.create_firm_client(
  p_name text,
  p_firm_id uuid DEFAULT NULL,
  p_business_type text DEFAULT NULL,
  p_market jsonb DEFAULT NULL
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
  v_market jsonb := p_market;
  v_firm_market jsonb;
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

  SELECT f.market INTO v_firm_market FROM public.firms f WHERE f.id = v_firm_id;
  IF v_market IS NULL THEN
    v_market := coalesce(v_firm_market, '{"country":"ZA","regionCode":null}'::jsonb);
  END IF;
  IF NOT public.market_json_ok(v_market) THEN
    RAISE EXCEPTION 'Invalid market selection';
  END IF;

  v_code := public.generate_client_code();

  -- New row only. An update of an existing id would let a member claim it.
  PERFORM set_config('milon.firm_link', 'accept', true);

  INSERT INTO public.clients (
    name,
    owner_user_id,
    firm_id,
    business_type,
    client_code,
    market,
    financial_year_start_month,
    firm_connected_at,
    firm_link_accepted_at,
    firm_link_accepted_by
  )
  VALUES (
    trim(p_name),
    v_uid,
    v_firm_id,
    nullif(trim(coalesce(p_business_type, '')), ''),
    v_code,
    v_market,
    CASE WHEN v_market->>'country' = 'US' THEN 1 ELSE 3 END,
    now(),
    now(),
    v_uid
  )
  RETURNING id INTO v_client_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = v_client_id
      AND c.owner_user_id = v_uid
      AND c.firm_id = v_firm_id
  ) THEN
    RAISE EXCEPTION 'create_firm_client must not claim an existing client';
  END IF;

  RETURN jsonb_build_object(
    'id', v_client_id,
    'client_code', v_code,
    'firm_id', v_firm_id,
    'name', trim(p_name)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_firm_client(text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_firm_client(text, uuid, text, jsonb) TO authenticated;
