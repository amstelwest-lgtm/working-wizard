-- Migration: normalise client_memberships.role and back-fill missing user_roles
-- ─────────────────────────────────────────────────────────────────────────────
-- Before this migration the app wrote the literal string "client" (and the DB
-- default was "member") instead of the enum values expected by the rest of the
-- system ('client_owner' / 'client_member').  This also fixes missing user_roles
-- rows for existing owner accounts that predate the role-normalisation work.

-- 1. Normalise client_memberships.role
--    - User is the primary owner of that client  → client_owner
--    - User is an invited member (any other row) → client_member
UPDATE public.client_memberships cm
SET    role = CASE
                WHEN c.owner_user_id = cm.user_id THEN 'client_owner'
                ELSE                                   'client_member'
              END
FROM   public.clients c
WHERE  c.id = cm.client_id
  AND  cm.role IN ('client', 'member');

-- 2. Back-fill user_roles for existing client owners (clients.owner_user_id)
--    Only insert where no user_roles row already exists for that user.
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT c.owner_user_id, 'client_owner'::public.app_role
FROM   public.clients c
WHERE  NOT EXISTS (
  SELECT 1 FROM public.user_roles ur WHERE ur.user_id = c.owner_user_id
);

-- 3. Back-fill user_roles for existing client members
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT cm.user_id, 'client_member'::public.app_role
FROM   public.client_memberships cm
WHERE  cm.role = 'client_member'
  AND  NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = cm.user_id
  );
