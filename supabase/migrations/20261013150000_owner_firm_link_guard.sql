-- Owner firm coverage must not follow a firm_id the business owner typed in.
-- Owners may clear firm_id to leave a firm. Setting or changing it happens
-- only in link_client_firm / create_firm_client (SECURITY DEFINER), which
-- stamp firm_link_accepted_at. Table-level UPDATE already covers every
-- column, so a column REVOKE would not stick. The trigger rejects the write.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS firm_link_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS firm_link_accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.clients.firm_link_accepted_at IS
  'When the firm accepted this client. Written only by link_client_firm and create_firm_client.';
COMMENT ON COLUMN public.clients.firm_link_accepted_by IS
  'Firm member who accepted the link. Written only by link_client_firm and create_firm_client.';

-- Existing links that a firm member already granted, or that the firm created
-- (the client owner is a member), stay accepted. A bare firm_id does not.
UPDATE public.clients c
SET
  firm_link_accepted_at = COALESCE(c.firm_connected_at, c.created_at, now()),
  firm_link_accepted_by = f.owner_user_id
FROM public.firms f
WHERE c.firm_id = f.id
  AND c.firm_link_accepted_at IS NULL
  AND (
    public.is_firm_member(c.owner_user_id, c.firm_id)
    OR EXISTS (
      SELECT 1
      FROM public.client_practice_access a
      WHERE a.client_id = c.id
        AND a.firm_id = c.firm_id
        AND a.status = 'active'
        AND (
          public.is_firm_member(a.requested_by, a.firm_id)
          OR public.is_firm_member(a.accountant_approved_by, a.firm_id)
        )
    )
  );

CREATE OR REPLACE FUNCTION public.clients_guard_owner_only_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('milon.firm_link', true), '') = 'accept' THEN
    IF NEW.firm_id IS NULL THEN
      NEW.firm_link_accepted_at := NULL;
      NEW.firm_link_accepted_by := NULL;
    ELSIF NEW.firm_link_accepted_at IS NULL THEN
      NEW.firm_link_accepted_at := now();
      IF NEW.firm_link_accepted_by IS NULL THEN
        NEW.firm_link_accepted_by := auth.uid();
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Service role (no JWT). App paths that attach a firm use link_client_firm.
  IF auth.uid() IS NULL THEN
    IF NEW.firm_id IS NULL THEN
      NEW.firm_link_accepted_at := NULL;
      NEW.firm_link_accepted_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.firm_id IS NOT NULL
       OR NEW.firm_link_accepted_at IS NOT NULL
       OR NEW.firm_link_accepted_by IS NOT NULL THEN
      RAISE EXCEPTION 'clients.firm_id cannot be set by the owner';
    END IF;
    RETURN NEW;
  END IF;

  -- Owners may clear the link (leave the firm). They cannot set or swap it.
  IF auth.uid() = OLD.owner_user_id THEN
    IF NEW.firm_id IS NULL AND OLD.firm_id IS NOT NULL THEN
      NEW.firm_link_accepted_at := NULL;
      NEW.firm_link_accepted_by := NULL;
      NEW.firm_connected_at := NULL;
      RETURN NEW;
    END IF;
    IF NEW.firm_id IS DISTINCT FROM OLD.firm_id
       OR NEW.firm_link_accepted_at IS DISTINCT FROM OLD.firm_link_accepted_at
       OR NEW.firm_link_accepted_by IS DISTINCT FROM OLD.firm_link_accepted_by THEN
      RAISE EXCEPTION 'clients.firm_id cannot be set by the owner';
    END IF;
    RETURN NEW;
  END IF;

  IF public.has_client_access(auth.uid(), OLD.id)
     AND NOT public.is_client_writer(auth.uid(), OLD.id) THEN
    IF (to_jsonb(NEW) - 'brain_summary' - 'brain_summary_updated_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'brain_summary' - 'brain_summary_updated_at') THEN
      RAISE EXCEPTION 'clients update for non-writers is limited to brain_summary';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'clients.id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'clients.created_at is owner-only';
  END IF;
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'clients.owner_user_id is owner-only';
  END IF;
  IF NEW.firm_id IS DISTINCT FROM OLD.firm_id THEN
    RAISE EXCEPTION 'clients.firm_id is owner-only';
  END IF;
  IF NEW.firm_link_accepted_at IS DISTINCT FROM OLD.firm_link_accepted_at
     OR NEW.firm_link_accepted_by IS DISTINCT FROM OLD.firm_link_accepted_by THEN
    RAISE EXCEPTION 'clients.firm_link_accepted_at is server-only';
  END IF;
  IF NEW.last_login_at IS DISTINCT FROM OLD.last_login_at THEN
    RAISE EXCEPTION 'clients.last_login_at is owner-only';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_guard_owner_only_columns ON public.clients;
CREATE TRIGGER clients_guard_owner_only_columns
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.clients_guard_owner_only_columns();

DROP POLICY IF EXISTS "clients insert own" ON public.clients;
CREATE POLICY "clients insert own"
  ON public.clients
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = auth.uid()
    AND firm_id IS NULL
    AND firm_link_accepted_at IS NULL
    AND firm_link_accepted_by IS NULL
  );

-- Firm member (or service role, with an explicit member) attaches a client.
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

REVOKE ALL ON FUNCTION public.link_client_firm(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_client_firm(uuid, uuid, uuid) TO authenticated, service_role;

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

-- Marketplace accept uses the same link, so the marker is set.
CREATE OR REPLACE FUNCTION public.accountant_request_respond(
  p_request_id uuid,
  p_accept     boolean,
  p_note       text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_client_firm uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT r.* INTO v_req FROM public.accountant_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.is_firm_member(v_uid, v_req.firm_id) THEN
    RAISE EXCEPTION 'Only a member of the requested firm can respond';
  END IF;
  IF v_req.status <> 'open' THEN
    RAISE EXCEPTION 'Request is already %', v_req.status;
  END IF;

  IF NOT p_accept THEN
    UPDATE public.accountant_requests
       SET status = 'declined', responded_by = v_uid, responded_at = now(), response_note = nullif(trim(p_note), '')
     WHERE id = p_request_id;
    RETURN 'declined';
  END IF;

  SELECT c.firm_id INTO v_client_firm FROM public.clients c WHERE c.id = v_req.client_id FOR UPDATE;
  IF v_client_firm IS NOT NULL AND v_client_firm <> v_req.firm_id THEN
    UPDATE public.accountant_requests
       SET status = 'expired', responded_at = now(), response_note = 'Another firm was attached first'
     WHERE id = p_request_id;
    RAISE EXCEPTION 'This business has since attached a different firm';
  END IF;

  PERFORM public.link_client_firm(v_req.client_id, v_req.firm_id, v_uid);
  UPDATE public.accountant_requests
     SET status = 'accepted', responded_by = v_uid, responded_at = now(), response_note = nullif(trim(p_note), '')
   WHERE id = p_request_id;
  UPDATE public.accountant_requests
     SET status = 'expired', responded_at = now(), response_note = 'Another firm accepted'
   WHERE client_id = v_req.client_id AND status = 'open' AND id <> p_request_id;
  RETURN 'accepted';
END;
$$;

REVOKE ALL ON FUNCTION public.accountant_request_respond(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accountant_request_respond(uuid, boolean, text) TO authenticated, service_role;

-- Webhook email fallback. Exact case-insensitive match, not a LIKE pattern.
CREATE OR REPLACE FUNCTION public.user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.profiles
  WHERE p_email IS NOT NULL
    AND length(trim(p_email)) > 0
    AND lower(email) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_id_by_email(text) TO service_role;
