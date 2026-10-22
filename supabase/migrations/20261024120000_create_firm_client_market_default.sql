-- New firm clients take the firm's stored market and year-start.
-- An explicit p_market still wins. A firm with no market stores none.
-- CoS applies this file. It is not wired into the CI apply scripts.
-- The previous function body is left in the applied migration.

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
  IF v_market IS NULL AND v_firm_market IS NOT NULL AND public.market_json_ok(v_firm_market) THEN
    v_market := v_firm_market;
  END IF;
  IF v_market IS NOT NULL AND NOT public.market_json_ok(v_market) THEN
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
    CASE
      WHEN v_market IS NULL THEN NULL
      WHEN v_market->>'country' = 'US' THEN 1
      ELSE 3
    END,
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
REVOKE ALL ON FUNCTION public.create_firm_client(text, uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_firm_client(text, uuid, text, jsonb) TO authenticated;
