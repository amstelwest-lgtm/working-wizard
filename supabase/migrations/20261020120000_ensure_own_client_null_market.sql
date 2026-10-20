-- A missing owner market stays null.
--
-- 20261019190000_ensure_own_client_idempotent.sql stored South Africa whenever
-- p_market was null. Google sign-in with no visitor pick then created a ZA
-- client, and the owner book treated that as a real South Africa market
-- (rand, SARS, the tax card) instead of asking. Null now stays null so
-- MarketGate can ask. A visitor pick is still stored as given.
-- Lookups and the insert shape are unchanged. Existing rows are not updated.

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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_market IS NOT NULL AND NOT public.market_json_ok(v_market) THEN
    RAISE EXCEPTION 'Invalid market selection';
  END IF;

  v_lock_key := ('x' || left(md5('ensure_own_client:' || v_uid::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT id INTO v_client_id
  FROM public.clients
  WHERE owner_user_id = v_uid AND firm_id IS NULL
  LIMIT 1;

  IF v_client_id IS NOT NULL THEN
    RETURN v_client_id;
  END IF;

  SELECT c.id INTO v_client_id
  FROM public.clients c
  INNER JOIN public.client_memberships m
    ON m.client_id = c.id
   AND m.user_id = v_uid
   AND m.role = 'client_owner'
  WHERE c.owner_user_id = v_uid
  ORDER BY c.created_at ASC, c.id ASC
  LIMIT 1;

  IF v_client_id IS NOT NULL THEN
    RETURN v_client_id;
  END IF;

  INSERT INTO public.clients (
    name,
    owner_user_id,
    market,
    financial_year_start_month
  )
  VALUES (
    p_name,
    v_uid,
    v_market,
    CASE WHEN v_market->>'country' = 'US' THEN 1 ELSE 3 END
  )
  RETURNING id INTO v_client_id;

  RETURN v_client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_own_client(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_own_client(text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.ensure_own_client(text, jsonb) IS
  'Returns the caller''s firm-unlinked owned client, else the oldest owned client with a client_owner membership, and inserts one only when both lookups miss. A null p_market is stored as null. Both return paths write nothing.';
