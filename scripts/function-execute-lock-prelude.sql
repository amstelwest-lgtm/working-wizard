-- Fresh-database stand-in for the SECURITY DEFINER functions the lock
-- migration revokes. Bodies that the search_path change could break
-- (pgmq wrappers, enum casts) match production. Privilege grants match
-- Supabase defaults: PUBLIC plus anon, authenticated, and service_role.

CREATE SCHEMA IF NOT EXISTS pgmq;
CREATE SCHEMA IF NOT EXISTS analytics;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pgmq.send(queue_name text, payload jsonb)
RETURNS bigint LANGUAGE sql AS $$ SELECT 7::bigint $$;

CREATE OR REPLACE FUNCTION pgmq.delete(queue_name text, message_id bigint)
RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION pgmq.create(queue_name text)
RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;

CREATE OR REPLACE FUNCTION pgmq.read(queue_name text, vt integer, qty integer)
RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
LANGUAGE sql AS $$ SELECT 1::bigint, 0, '{}'::jsonb $$;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('client_owner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.action_status AS ENUM ('not_started', 'in_progress', 'done', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.action_health AS ENUM ('complete', 'overdue', 'off_track', 'on_track', 'at_risk');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.preview_advisory_delivery_ack(_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
  SELECT jsonb_build_object('found', true, 'already', false)
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_advisory_delivery(_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
  SELECT jsonb_build_object('ok', true)
$$;

CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer)
RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name text, message_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(
  source_queue text, dlq_name text, message_id bigint, payload jsonb
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE new_id bigint;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::void $$;

CREATE OR REPLACE FUNCTION public.ensure_own_client(p_name text, p_market jsonb)
RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT '00000000-0000-0000-0000-000000000001'::uuid
$$;

CREATE OR REPLACE FUNCTION public.create_firm_client(
  p_name text, p_firm_id uuid, p_business_type text, p_market jsonb
)
RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT '00000000-0000-0000-0000-000000000002'::uuid
$$;

CREATE OR REPLACE FUNCTION public.mint_owner_invite(p_client_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'owner-token' $$;

CREATE OR REPLACE FUNCTION public.mint_accountant_invite(p_client_id uuid, p_email text)
RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'accountant-token' $$;

CREATE OR REPLACE FUNCTION public.write_audit_log(
  _action text, _firm_id uuid, _client_id uuid, _subject_user_id uuid, _details jsonb, _actor_id uuid
)
RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT '00000000-0000-0000-0000-000000000003'::uuid
$$;

CREATE OR REPLACE FUNCTION public.has_client_access(_user_id uuid, _client_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT false $$;

CREATE OR REPLACE FUNCTION public.find_nudge_candidates(p_cooldown_cutoff timestamp with time zone)
RETURNS TABLE(id uuid) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT NULL::uuid WHERE false
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT false $$;

CREATE OR REPLACE FUNCTION analytics.jsonb_is_blank(p jsonb)
RETURNS boolean LANGUAGE sql AS $$
  SELECT p IS NULL OR p = 'null'::jsonb OR p = '{}'::jsonb
$$;

CREATE OR REPLACE FUNCTION public.practice_can(_class text, _cap text)
RETURNS boolean LANGUAGE sql AS $$
  SELECT CASE _cap
    WHEN 'sign_off' THEN _class = 'partner'
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.action_item_health(
  p_status public.action_status,
  p_due date,
  p_progress integer,
  p_created timestamp with time zone
)
RETURNS public.action_health LANGUAGE sql AS $$
  SELECT CASE
    WHEN p_status = 'done' THEN 'complete'::action_health
    WHEN p_due IS NOT NULL AND p_due < current_date THEN 'overdue'::action_health
    WHEN p_status = 'blocked' THEN 'off_track'::action_health
    WHEN p_due IS NULL THEN 'on_track'::action_health
    ELSE 'at_risk'::action_health
  END
$$;

DO $$
DECLARE
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.preview_advisory_delivery_ack(text)',
    'public.acknowledge_advisory_delivery(text)',
    'public.enqueue_email(text,jsonb)',
    'public.read_email_batch(text,integer,integer)',
    'public.delete_email(text,bigint)',
    'public.move_to_dlq(text,text,bigint,jsonb)',
    'public.delete_own_account()',
    'public.ensure_own_client(text,jsonb)',
    'public.create_firm_client(text,uuid,text,jsonb)',
    'public.mint_owner_invite(uuid)',
    'public.mint_accountant_invite(uuid,text)',
    'public.write_audit_log(text,uuid,uuid,uuid,jsonb,uuid)',
    'public.has_client_access(uuid,uuid)',
    'public.find_nudge_candidates(timestamp with time zone)',
    'public.handle_new_user()',
    'public.has_role(uuid,public.app_role)'
  ]
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated, service_role',
      sig
    );
  END LOOP;
END $$;

-- Match hosted Supabase: new functions in public are executable by
-- anon, authenticated, and service_role until the lock migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
