-- Milōn IT queries: tag a client note for the IT team, list IT members with
-- master access to every client profile, and surface those notes in Lighthouse.

ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS tagged_milon_it BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS tagged_milon_it_at TIMESTAMPTZ;

ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS tagged_milon_it_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS client_notes_tagged_it_idx
  ON public.client_notes (tagged_milon_it_at DESC)
  WHERE tagged_milon_it = true;

COMMENT ON COLUMN public.client_notes.tagged_milon_it IS
  'When true, this note is an IT query visible in Milōn Lighthouse.';

CREATE TABLE IF NOT EXISTS public.milon_it_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT milon_it_members_email_key UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS milon_it_members_user_idx
  ON public.milon_it_members (user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON TABLE public.milon_it_members IS
  'Milōn IT team. Members have master read access to every client profile.';

ALTER TABLE public.milon_it_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "milon_it_members deny all" ON public.milon_it_members;
CREATE POLICY "milon_it_members deny all"
  ON public.milon_it_members
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.is_milon_it_member(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.milon_it_members m
    WHERE m.user_id = _user_id
       OR lower(m.email) = (
         SELECT lower(u.email::text)
         FROM auth.users u
         WHERE u.id = _user_id
       )
  );
$$;

REVOKE ALL ON FUNCTION public.is_milon_it_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_milon_it_member(UUID) TO authenticated, service_role;

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
            SELECT 1
            FROM public.client_memberships m
            WHERE m.client_id = c.id
              AND m.user_id = _user_id
          )
          OR (
            c.firm_id IS NOT NULL
            AND public.is_firm_member(_user_id, c.firm_id)
          )
        )
    );
$$;
