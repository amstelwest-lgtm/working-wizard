-- ============================================================================
-- Founder pilot gaps: roles on self-signup + opaque invite tokens
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) ensure_own_client also writes membership + user_roles (client_owner only)
CREATE OR REPLACE FUNCTION public.ensure_own_client(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_client_id uuid;
  v_lock_key  bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_lock_key := ('x' || left(md5('ensure_own_client:' || v_uid::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT id INTO v_client_id
  FROM public.clients
  WHERE owner_user_id = v_uid AND firm_id IS NULL
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (name, owner_user_id)
    VALUES (NULLIF(trim(p_name), ''), v_uid)
    RETURNING id INTO v_client_id;
  END IF;

  -- Membership for the owner's own client (idempotent)
  IF to_regclass('public.client_memberships') IS NOT NULL THEN
    INSERT INTO public.client_memberships (client_id, user_id, role)
    VALUES (v_client_id, v_uid, 'client_owner')
    ON CONFLICT (client_id, user_id) DO UPDATE
      SET role = EXCLUDED.role
      WHERE public.client_memberships.role IS DISTINCT FROM EXCLUDED.role;
  END IF;

  -- Only insert client_owner when the user has no role yet — never escalate
  -- an accountant / firm_admin / existing member.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, 'client_owner');
  END IF;

  RETURN v_client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_own_client(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_own_client(text) TO authenticated;

-- Backfill: owners of firm-less clients missing user_roles
INSERT INTO public.user_roles (user_id, role)
SELECT c.owner_user_id, 'client_owner'::public.app_role
FROM public.clients c
WHERE c.owner_user_id IS NOT NULL
  AND c.firm_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = c.owner_user_id
  )
ON CONFLICT (user_id, role) DO NOTHING;

-- Backfill memberships for those owners
INSERT INTO public.client_memberships (client_id, user_id, role)
SELECT c.id, c.owner_user_id, 'client_owner'
FROM public.clients c
WHERE c.owner_user_id IS NOT NULL
  AND c.firm_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.client_memberships cm
    WHERE cm.client_id = c.id AND cm.user_id = c.owner_user_id
  )
ON CONFLICT (client_id, user_id) DO NOTHING;

-- 2) Opaque invite tokens (replace raw client UUID in invite URLs)
CREATE TABLE IF NOT EXISTS public.invite_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  purpose text NOT NULL DEFAULT 'owner_handoff'
    CHECK (purpose IN ('owner_handoff', 'staff_member')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  redeemed_at timestamptz,
  redeemed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invite_tokens_client_id_idx ON public.invite_tokens (client_id);
CREATE INDEX IF NOT EXISTS invite_tokens_token_idx ON public.invite_tokens (token);

ALTER TABLE public.invite_tokens ENABLE ROW LEVEL SECURITY;

-- No direct client access — mint/redeem via service role / SECURITY DEFINER only.
DROP POLICY IF EXISTS "invite_tokens deny all" ON public.invite_tokens;
CREATE POLICY "invite_tokens deny all"
  ON public.invite_tokens
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- Firm writers mint owner-handoff invites for clients they can access.
CREATE OR REPLACE FUNCTION public.mint_owner_invite(p_client_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.has_client_access(v_uid, p_client_id) THEN
    RAISE EXCEPTION 'No access to this client';
  END IF;

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.invite_tokens (token, client_id, created_by, purpose)
  VALUES (v_token, p_client_id, v_uid, 'owner_handoff');

  RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mint_owner_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mint_owner_invite(uuid) TO authenticated;
