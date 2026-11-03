-- Minimum stand-in so 20261103150000_client_groups.sql can run on the CI
-- database. The product migration chain is not replayed. Seed clients are
-- inserted before the group migration so the backfill can be asserted.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.firm_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  UNIQUE (firm_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),
  firm_id uuid REFERENCES public.firms(id)
);

CREATE TABLE IF NOT EXISTS public.client_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  UNIQUE (client_id, user_id)
);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'owner-one@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'accountant@example.com'),
  ('44444444-4444-4444-8444-444444444444', 'owner-two@example.com'),
  ('55555555-5555-4555-8555-555555555555', 'stranger@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.firms (id, name, owner_user_id) VALUES
  ('33333333-3333-4333-8333-333333333333', 'North Firm', '22222222-2222-4222-8222-222222222222')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.firm_memberships (firm_id, user_id, role) VALUES
  ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'owner')
ON CONFLICT (firm_id, user_id) DO NOTHING;

-- These two rows exist before the migration. Backfill must give each its own group.
INSERT INTO public.clients (id, name, owner_user_id, firm_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Solo Books', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Solo Cafe', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333')
ON CONFLICT (id) DO NOTHING;
