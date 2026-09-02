-- Per-member, per-client practice access with dual email approval.
-- Industry: Xero/QBOA assign staff after one firm engagement (no per-staff owner click).
-- MILŌN product choice: cap 12 practice users per client; new grants need
-- accountant + business-owner approval links. Practice owner keeps all-client access.

ALTER TABLE public.firm_memberships
  ADD COLUMN IF NOT EXISTS classification TEXT NOT NULL DEFAULT 'staff';

COMMENT ON COLUMN public.firm_memberships.classification IS
  'Practice job title: partner, manager, staff, bookkeeper, reviewer, read_only.';

CREATE TABLE IF NOT EXISTS public.client_practice_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  firm_id UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  classification TEXT NOT NULL DEFAULT 'staff',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'revoked', 'declined')),
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accountant_approved_at TIMESTAMPTZ,
  accountant_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_approved_at TIMESTAMPTZ,
  owner_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_practice_access_unique UNIQUE (client_id, user_id)
);

CREATE INDEX IF NOT EXISTS client_practice_access_client_idx
  ON public.client_practice_access (client_id, status);
CREATE INDEX IF NOT EXISTS client_practice_access_user_idx
  ON public.client_practice_access (user_id, status);

COMMENT ON TABLE public.client_practice_access IS
  'Named practice staff on a client file. Max 12 pending+active. Dual approval for new grants.';

ALTER TABLE public.client_practice_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "client_practice_access deny all" ON public.client_practice_access;
CREATE POLICY "client_practice_access deny all"
  ON public.client_practice_access
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.firm_staff_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  membership_role TEXT NOT NULL DEFAULT 'member'
    CHECK (membership_role IN ('owner', 'admin', 'member')),
  classification TEXT NOT NULL DEFAULT 'staff',
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT firm_staff_invites_token_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS firm_staff_invites_firm_idx
  ON public.firm_staff_invites (firm_id, created_at DESC);

ALTER TABLE public.firm_staff_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "firm_staff_invites deny all" ON public.firm_staff_invites;
CREATE POLICY "firm_staff_invites deny all"
  ON public.firm_staff_invites
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.access_approval_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose TEXT NOT NULL
    CHECK (purpose IN ('accountant_approve', 'owner_approve', 'owner_decline', 'firm_invite')),
  access_id UUID REFERENCES public.client_practice_access(id) ON DELETE CASCADE,
  invite_id UUID REFERENCES public.firm_staff_invites(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT access_approval_tokens_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS access_approval_tokens_hash_idx
  ON public.access_approval_tokens (token_hash);

ALTER TABLE public.access_approval_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "access_approval_tokens deny all" ON public.access_approval_tokens;
CREATE POLICY "access_approval_tokens deny all"
  ON public.access_approval_tokens
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

-- Grandfather: existing firm members keep access to current firm clients.
INSERT INTO public.client_practice_access (
  client_id, user_id, firm_id, classification, status,
  requested_at, accountant_approved_at, owner_approved_at
)
SELECT c.id, fm.user_id, c.firm_id,
  COALESCE(NULLIF(fm.classification, ''), 'staff'),
  'active', now(), now(), now()
FROM public.clients c
JOIN public.firm_memberships fm ON fm.firm_id = c.firm_id
WHERE c.firm_id IS NOT NULL
ON CONFLICT (client_id, user_id) DO NOTHING;

INSERT INTO public.client_practice_access (
  client_id, user_id, firm_id, classification, status,
  requested_at, accountant_approved_at, owner_approved_at
)
SELECT c.id, f.owner_user_id, c.firm_id, 'partner', 'active', now(), now(), now()
FROM public.clients c
JOIN public.firms f ON f.id = c.firm_id
WHERE c.firm_id IS NOT NULL
  AND f.owner_user_id IS NOT NULL
ON CONFLICT (client_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.has_active_practice_assignment(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_practice_access a
    WHERE a.user_id = _user_id
      AND a.client_id = _client_id
      AND a.status = 'active'
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_active_practice_assignment(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_firm_manager(_user_id UUID, _firm_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.firms f
    WHERE f.id = _firm_id AND f.owner_user_id = _user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.firm_memberships fm
    WHERE fm.firm_id = _firm_id
      AND fm.user_id = _user_id
      AND fm.role IN ('owner', 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_firm_manager(UUID, UUID) TO authenticated, service_role;

-- Read: owner, invited client team, IT, named assignment, or practice owner/admin.
CREATE OR REPLACE FUNCTION public.has_client_access(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_milon_it_member(_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = _client_id
        AND (
          c.owner_user_id = _user_id
          OR EXISTS (
            SELECT 1 FROM public.client_memberships m
            WHERE m.client_id = c.id AND m.user_id = _user_id
          )
          OR public.has_active_practice_assignment(_user_id, c.id)
          OR (
            c.firm_id IS NOT NULL
            AND public.is_firm_manager(_user_id, c.firm_id)
          )
        )
    );
$$;

-- Write: owner, writing assignment (not read-only), or practice owner.
CREATE OR REPLACE FUNCTION public.is_client_writer(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = _client_id
      AND (
        c.owner_user_id = _user_id
        OR EXISTS (
          SELECT 1 FROM public.client_practice_access a
          WHERE a.client_id = c.id
            AND a.user_id = _user_id
            AND a.status = 'active'
            AND a.classification IS DISTINCT FROM 'read_only'
        )
        OR (
          c.firm_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.firms f
            WHERE f.id = c.firm_id AND f.owner_user_id = _user_id
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_action_plan_writer(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_client_writer(_user_id, _client_id);
$$;
