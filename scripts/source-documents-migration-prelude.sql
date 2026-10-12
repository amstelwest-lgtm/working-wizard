-- Stand-in for the hosted Supabase roles, auth, and storage objects, plus the
-- tables the source-document SQL test deletes. The product migration chain is
-- not replayed here: 20260522100000_financial_submissions.sql references
-- clients.accountant_id, which the earlier files never create.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

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

GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  instance_id uuid,
  raw_user_meta_data jsonb
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

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text
);

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
  classification text
);

CREATE OR REPLACE FUNCTION public.firm_memberships_partner_guard_del()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS firm_memberships_partner_guard_del ON public.firm_memberships;
CREATE TRIGGER firm_memberships_partner_guard_del
  BEFORE DELETE ON public.firm_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.firm_memberships_partner_guard_del();

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
  role text NOT NULL DEFAULT 'member'
);

CREATE TABLE IF NOT EXISTS public.client_practice_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid
);

CREATE TABLE IF NOT EXISTS public.client_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid
);

CREATE OR REPLACE FUNCTION public.is_firm_member(_user_id uuid, _firm_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.firm_memberships
    WHERE user_id = _user_id AND firm_id = _firm_id
  ) OR EXISTS (
    SELECT 1 FROM public.firms WHERE id = _firm_id AND owner_user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_client_access(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = _client_id AND (
      c.owner_user_id = _user_id
      OR EXISTS (
        SELECT 1 FROM public.client_memberships m
        WHERE m.client_id = c.id AND m.user_id = _user_id
      )
      OR (c.firm_id IS NOT NULL AND public.is_firm_member(_user_id, c.firm_id))
    )
  );
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text
);

CREATE OR REPLACE FUNCTION storage.protect_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Direct deletion from storage tables is not allowed';
END;
$$;

DROP TRIGGER IF EXISTS protect_delete ON storage.objects;
CREATE TRIGGER protect_delete
  BEFORE DELETE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION storage.protect_delete();
