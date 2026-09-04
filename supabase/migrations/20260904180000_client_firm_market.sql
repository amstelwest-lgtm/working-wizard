-- Market profile: ZA vs US (+ US state). Existing rows backfill to ZA so
-- production behaviour is unchanged until a US selection is written.

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS market jsonb;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS market jsonb;

COMMENT ON COLUMN public.firms.market IS
  'Practice home market {country: ZA|US, regionCode: USPS|null}.';
COMMENT ON COLUMN public.clients.market IS
  'Workspace market; overrides firm. regionCode required when country=US.';

UPDATE public.firms
SET market = '{"country":"ZA","regionCode":null}'::jsonb
WHERE market IS NULL;

UPDATE public.clients
SET market = '{"country":"ZA","regionCode":null}'::jsonb
WHERE market IS NULL;

CREATE OR REPLACE FUNCTION public.market_json_ok(p jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_country text;
  v_region text;
  v_states text[] := ARRAY[
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
    'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
    'WV','WI','WY'
  ];
BEGIN
  IF p IS NULL THEN
    RETURN false;
  END IF;
  v_country := p->>'country';
  v_region := nullif(p->>'regionCode', '');
  IF v_country = 'ZA' THEN
    RETURN v_region IS NULL;
  END IF;
  IF v_country = 'US' THEN
    RETURN v_region IS NOT NULL AND v_region = ANY (v_states);
  END IF;
  RETURN false;
END;
$$;

ALTER TABLE public.firms DROP CONSTRAINT IF EXISTS firms_market_ok;
ALTER TABLE public.firms
  ADD CONSTRAINT firms_market_ok CHECK (market IS NULL OR public.market_json_ok(market));

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_market_ok;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_market_ok CHECK (market IS NULL OR public.market_json_ok(market));

-- ── ensure_own_client: optional market on first insert ───────────────────────
DROP FUNCTION IF EXISTS public.ensure_own_client(text);
DROP FUNCTION IF EXISTS public.ensure_own_client(text, jsonb);

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
  IF v_market IS NULL THEN
    v_market := '{"country":"ZA","regionCode":null}'::jsonb;
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

-- ── create_firm_client: inherit firm market unless p_market is passed ────────
DROP FUNCTION IF EXISTS public.create_firm_client(text, uuid, text);
DROP FUNCTION IF EXISTS public.create_firm_client(text, uuid, text, jsonb);

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

  INSERT INTO public.clients (
    name,
    owner_user_id,
    firm_id,
    business_type,
    client_code,
    market,
    financial_year_start_month
  )
  VALUES (
    trim(p_name),
    v_uid,
    v_firm_id,
    nullif(trim(coalesce(p_business_type, '')), ''),
    v_code,
    v_market,
    CASE WHEN v_market->>'country' = 'US' THEN 1 ELSE 3 END
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

REVOKE ALL ON FUNCTION public.create_firm_client(text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_firm_client(text, uuid, text, jsonb) TO authenticated;
