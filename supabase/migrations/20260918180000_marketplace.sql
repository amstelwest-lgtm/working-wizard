-- ============================================================================
-- P3 — Accountant marketplace
--
-- Owner-only clients can find a listed firm and ask it to review their
-- advisory pack. When the firm accepts, clients.firm_id is set and every
-- existing mechanism (accountant_review state, pack sign-off, workflow mail,
-- portfolio) switches on with no further plumbing.
--
--   firm_listings        one row per firm that opts in (what it takes on)
--   accountant_requests  owner → firm asks, with the pack attached; one open
--                        request per (client, firm); accept attaches the firm
--
-- Reads by RLS; writes through SECURITY DEFINER RPCs so the "owner only, no
-- firm attached yet" and "target firm member only" rules live in one place.
--
-- Additive only. Idempotent. Depends on 20260918160000_advisory_packs.sql,
-- 20260918170000_workflow_emails.sql. Vocabulary mirrors src/lib/marketplace.ts.
-- ============================================================================

-- ── firm_listings ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.firm_listings (
  firm_id        uuid PRIMARY KEY REFERENCES public.firms(id) ON DELETE CASCADE,
  is_listed      boolean NOT NULL DEFAULT false,
  accepting      boolean NOT NULL DEFAULT true,
  headline       text,
  bio            text,
  -- Free-text tags, lower-cased on write by the RPC/UI. Matched against
  -- clients.business_type and clients.market.
  industries     text[] NOT NULL DEFAULT '{}'::text[],
  regions        text[] NOT NULL DEFAULT '{}'::text[],
  services       text[] NOT NULL DEFAULT '{}'::text[],
  contact_email  text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS firm_listings_touch_updated_at ON public.firm_listings;
CREATE TRIGGER firm_listings_touch_updated_at
  BEFORE UPDATE ON public.firm_listings
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

CREATE INDEX IF NOT EXISTS firm_listings_listed_idx
  ON public.firm_listings (is_listed) WHERE is_listed;

COMMENT ON TABLE public.firm_listings IS
  'Marketplace opt-in per firm. Only is_listed rows are visible to owners; matching is done by marketplace_match_firms.';

ALTER TABLE public.firm_listings ENABLE ROW LEVEL SECURITY;

-- Firm members see and manage their own listing directly (small, low-risk).
DROP POLICY IF EXISTS "firm_listings read by member" ON public.firm_listings;
CREATE POLICY "firm_listings read by member"
  ON public.firm_listings FOR SELECT TO authenticated
  USING (public.is_firm_member(auth.uid(), firm_id));

DROP POLICY IF EXISTS "firm_listings insert by member" ON public.firm_listings;
CREATE POLICY "firm_listings insert by member"
  ON public.firm_listings FOR INSERT TO authenticated
  WITH CHECK (public.is_firm_member(auth.uid(), firm_id));

DROP POLICY IF EXISTS "firm_listings update by member" ON public.firm_listings;
CREATE POLICY "firm_listings update by member"
  ON public.firm_listings FOR UPDATE TO authenticated
  USING (public.is_firm_member(auth.uid(), firm_id))
  WITH CHECK (public.is_firm_member(auth.uid(), firm_id));

-- Owners never read the table directly; they get matches from the RPC below,
-- which exposes only listed firms and only the public fields.

-- ── accountant_requests ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.accountant_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id        uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN (
                   'open', 'accepted', 'declined', 'withdrawn', 'expired'
                 )),
  message        text,
  pack_id        uuid REFERENCES public.advisory_packs(id) ON DELETE SET NULL,
  match_score    integer,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  responded_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responded_at   timestamptz,
  response_note  text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accountant_requests_open_key
  ON public.accountant_requests (client_id, firm_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS accountant_requests_firm_open_idx
  ON public.accountant_requests (firm_id, created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS accountant_requests_client_idx
  ON public.accountant_requests (client_id, created_at DESC);

DROP TRIGGER IF EXISTS accountant_requests_touch_updated_at ON public.accountant_requests;
CREATE TRIGGER accountant_requests_touch_updated_at
  BEFORE UPDATE ON public.accountant_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

COMMENT ON TABLE public.accountant_requests IS
  'Owner → firm review requests. Accepting sets clients.firm_id; other open requests for the client expire.';

ALTER TABLE public.accountant_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accountant_requests read by party" ON public.accountant_requests;
CREATE POLICY "accountant_requests read by party"
  ON public.accountant_requests FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id) OR public.is_firm_member(auth.uid(), firm_id));

-- No direct write policies: RPCs only.

-- ── matching ────────────────────────────────────────────────────────────────
-- Simple, explainable score (mirrored in src/lib/marketplace.ts scoreFirm):
--   +3 industry tag matches the client's business type
--   +2 region tag matches the client's market country / region code
--   +1 the firm is accepting new clients
-- Ties broken by name. Only the client's owner may call it, and only while no
-- firm is attached.

CREATE OR REPLACE FUNCTION public.marketplace_match_firms(p_client_id uuid)
RETURNS TABLE (
  firm_id uuid, name text, headline text, bio text, industries text[], regions text[], services text[],
  accepting boolean, score integer, reasons text[], request_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_firm    uuid;
  v_type    text;
  v_country text;
  v_region  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT c.owner_user_id, c.firm_id, lower(coalesce(c.business_type, '')),
         lower(coalesce(c.market->>'country', '')), lower(coalesce(c.market->>'regionCode', ''))
    INTO v_owner, v_firm, v_type, v_country, v_region
  FROM public.clients c WHERE c.id = p_client_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'Only the business owner can look for an accountant';
  END IF;
  IF v_firm IS NOT NULL THEN
    RAISE EXCEPTION 'This business already has a firm attached';
  END IF;

  RETURN QUERY
    SELECT
      f.id,
      f.name,
      l.headline,
      l.bio,
      l.industries,
      l.regions,
      l.services,
      l.accepting,
      (CASE WHEN v_type <> '' AND v_type = ANY (l.industries) THEN 3 ELSE 0 END
       + CASE WHEN (v_country <> '' AND v_country = ANY (l.regions)) OR (v_region <> '' AND v_region = ANY (l.regions)) THEN 2 ELSE 0 END
       + CASE WHEN l.accepting THEN 1 ELSE 0 END)::integer AS score,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN v_type <> '' AND v_type = ANY (l.industries) THEN 'Works with ' || v_type || ' businesses' END,
        CASE WHEN (v_country <> '' AND v_country = ANY (l.regions)) OR (v_region <> '' AND v_region = ANY (l.regions)) THEN 'Serves your region' END,
        CASE WHEN l.accepting THEN 'Taking new clients' END
      ], NULL) AS reasons,
      (SELECT r.status FROM public.accountant_requests r
        WHERE r.client_id = p_client_id AND r.firm_id = f.id
        ORDER BY r.created_at DESC LIMIT 1) AS request_status
    FROM public.firm_listings l
    JOIN public.firms f ON f.id = l.firm_id
    WHERE l.is_listed
    ORDER BY 9 DESC, f.name;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_match_firms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_match_firms(uuid) TO authenticated, service_role;

-- ── RPC: owner asks a firm ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accountant_request_create(
  p_client_id uuid,
  p_firm_id   uuid,
  p_message   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_owner  uuid;
  v_firm   uuid;
  v_listed boolean;
  v_pack   uuid;
  v_score  integer;
  v_id     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT c.owner_user_id, c.firm_id INTO v_owner, v_firm FROM public.clients c WHERE c.id = p_client_id FOR UPDATE;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'Only the business owner can ask for an accountant';
  END IF;
  IF v_firm IS NOT NULL THEN
    RAISE EXCEPTION 'This business already has a firm attached';
  END IF;
  SELECT l.is_listed INTO v_listed FROM public.firm_listings l WHERE l.firm_id = p_firm_id;
  IF NOT coalesce(v_listed, false) THEN
    RAISE EXCEPTION 'That firm is not taking requests';
  END IF;
  IF EXISTS (SELECT 1 FROM public.accountant_requests r WHERE r.client_id = p_client_id AND r.firm_id = p_firm_id AND r.status = 'open') THEN
    RAISE EXCEPTION 'You already have an open request with this firm';
  END IF;

  -- Attach the latest live pack so the firm judges the work, not raw data.
  SELECT p.id INTO v_pack FROM public.advisory_packs p
   WHERE p.client_id = p_client_id AND p.status <> 'superseded'
   ORDER BY p.version DESC LIMIT 1;
  SELECT m.score INTO v_score FROM public.marketplace_match_firms(p_client_id) m WHERE m.firm_id = p_firm_id;

  INSERT INTO public.accountant_requests (client_id, firm_id, message, pack_id, match_score, created_by)
  VALUES (p_client_id, p_firm_id, nullif(trim(p_message), ''), v_pack, v_score, v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accountant_request_create(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accountant_request_create(uuid, uuid, text) TO authenticated, service_role;

-- ── RPC: owner withdraws ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accountant_request_withdraw(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
BEGIN
  SELECT r.*, c.owner_user_id INTO v_req
  FROM public.accountant_requests r JOIN public.clients c ON c.id = r.client_id
  WHERE r.id = p_request_id FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_uid IS NULL OR v_req.owner_user_id <> v_uid THEN
    RAISE EXCEPTION 'Only the business owner can withdraw a request';
  END IF;
  IF v_req.status <> 'open' THEN RETURN v_req.status; END IF;
  UPDATE public.accountant_requests SET status = 'withdrawn', responded_at = now() WHERE id = p_request_id;
  RETURN 'withdrawn';
END;
$$;

REVOKE ALL ON FUNCTION public.accountant_request_withdraw(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accountant_request_withdraw(uuid) TO authenticated, service_role;

-- ── RPC: firm accepts or declines ───────────────────────────────────────────
-- Accepting attaches the firm (clients.firm_id) and expires the client's
-- other open requests. From here the advisory spine treats the client as
-- firm-connected: packs need sign-off, mail goes to the firm, portfolio shows it.

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

  UPDATE public.clients SET firm_id = v_req.firm_id WHERE id = v_req.client_id;
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

-- ── recipients for request mail ─────────────────────────────────────────────
-- The target firm is not attached yet, so workflow_recipients() cannot see
-- it. Members of the requested firm, for callers who are party to the request.

CREATE OR REPLACE FUNCTION public.accountant_request_recipients(p_request_id uuid)
RETURNS TABLE (user_id uuid, email text, full_name text, role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT r.client_id, r.firm_id INTO v_req FROM public.accountant_requests r WHERE r.id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT (public.has_client_access(v_uid, v_req.client_id) OR public.is_firm_member(v_uid, v_req.firm_id)) THEN
    RAISE EXCEPTION 'You are not party to this request';
  END IF;
  RETURN QUERY
    SELECT pr.id, pr.email, pr.full_name, 'accountant'::text
    FROM public.firm_memberships fm
    JOIN public.profiles pr ON pr.id = fm.user_id
    WHERE fm.firm_id = v_req.firm_id AND pr.email IS NOT NULL AND pr.email LIKE '%@%';
END;
$$;

REVOKE ALL ON FUNCTION public.accountant_request_recipients(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accountant_request_recipients(uuid) TO authenticated, service_role;

-- ── workflow email kinds (P3) ───────────────────────────────────────────────
-- Keep in sync with WORKFLOW_EMAIL_KINDS in src/lib/workflow-emails.ts.

ALTER TABLE public.workflow_email_log DROP CONSTRAINT IF EXISTS workflow_email_log_kind_check;
ALTER TABLE public.workflow_email_log ADD CONSTRAINT workflow_email_log_kind_check CHECK (kind IN (
  'pack_ready_for_review', 'pack_signed_off', 'pack_changes_requested',
  'forecast_break', 'cycle_restarted',
  'accountant_request_received', 'accountant_attached', 'accountant_request_declined'
));
