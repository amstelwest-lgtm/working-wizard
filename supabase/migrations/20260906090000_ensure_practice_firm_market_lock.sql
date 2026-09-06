-- ensure_practice_firm: one serialized, market-aware firm provisioning path.
--
-- Before this, a practice signup could mint two firms: /auth inserted a firm
-- directly while AccountantProfileProvider's hydrate called ensure_practice_firm
-- for the same user a few ms later (SELECT-then-INSERT, no lock). The RPC also
-- ignored the market the accountant picked, so the firm — and every client
-- defaulted from it — fell back to ZA.
--
-- Now:
--   * an advisory transaction lock per user serialises concurrent callers;
--   * p_market (or market_country / market_region from the JWT metadata) is
--     stored on a freshly created firm and back-filled onto an existing firm
--     that has no market yet.
--
-- The single-argument overload is dropped so PostgREST can resolve
-- `ensure_practice_firm({ p_name })` unambiguously; both parameters default.

DROP FUNCTION IF EXISTS public.ensure_practice_firm(text);

CREATE OR REPLACE FUNCTION public.ensure_practice_firm(
  p_name text DEFAULT NULL,
  p_market jsonb DEFAULT NULL
)
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
  v_meta jsonb;
  v_market jsonb := p_market;
  v_existing_market jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Serialise every provisioning call for this user (signup handler, profile
  -- hydrate, create_firm_client) so only one firm can ever be created.
  PERFORM pg_advisory_xact_lock(hashtext('ensure_practice_firm:' || v_uid::text));

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.role IN ('client_owner', 'client_member')
  ) INTO v_is_client;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.role IN ('accountant', 'firm_admin')
  ) INTO v_is_practice;

  BEGIN
    v_meta := auth.jwt() -> 'user_metadata';
    v_signup_type := v_meta ->> 'signup_type';
  EXCEPTION WHEN OTHERS THEN
    v_meta := NULL;
    v_signup_type := NULL;
  END;

  -- Pure (or not-yet-promoted) business clients never get a practice firm here.
  IF v_is_client AND NOT v_is_practice THEN
    RETURN NULL;
  END IF;
  IF NOT v_is_practice AND v_signup_type = 'customer' THEN
    RETURN NULL;
  END IF;

  -- Market: explicit argument, else the signup metadata written by /auth.
  IF v_market IS NULL AND v_meta IS NOT NULL AND (v_meta ->> 'market_country') IS NOT NULL THEN
    v_market := jsonb_build_object(
      'country', v_meta ->> 'market_country',
      'regionCode', CASE
        WHEN v_meta ->> 'market_country' = 'US' THEN v_meta ->> 'market_region'
        ELSE NULL
      END
    );
  END IF;
  IF v_market IS NOT NULL AND NOT public.market_json_ok(v_market) THEN
    v_market := NULL;
  END IF;

  SELECT f.id, f.market INTO v_firm_id, v_existing_market
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
    IF v_firm_id IS NOT NULL THEN
      SELECT f.market INTO v_existing_market FROM public.firms f WHERE f.id = v_firm_id;
    END IF;
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

    -- Back-fill the market the accountant chose at signup if the firm has none.
    IF v_existing_market IS NULL AND v_market IS NOT NULL THEN
      UPDATE public.firms SET market = v_market
      WHERE id = v_firm_id AND owner_user_id = v_uid AND market IS NULL;
    END IF;

    RETURN v_firm_id;
  END IF;

  -- Practice account with no firm yet (true accountant provisioning).
  v_name := nullif(trim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN
    v_name := nullif(trim(coalesce(v_meta ->> 'firm_name', '')), '');
  END IF;
  IF v_name IS NULL THEN
    v_name := 'My practice';
  END IF;

  INSERT INTO public.firms (name, owner_user_id, market)
  VALUES (v_name, v_uid, v_market)
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

REVOKE ALL ON FUNCTION public.ensure_practice_firm(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_practice_firm(text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.ensure_practice_firm(text, jsonb) IS
  'Returns the caller''s practice firm, creating one (plus membership + firm_admin) if missing. Serialised per user; stores p_market (or the signup market from JWT metadata) on a new firm and back-fills it on a firm without one. No-ops for business-client accounts.';
