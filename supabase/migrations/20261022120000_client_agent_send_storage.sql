-- Private bucket for files collected on /a/<token>.
-- The bucket stays private (public = false).
-- This file creates no policy on storage.objects. It drops any policy that
-- names this bucket, so anon and authenticated have no select, insert,
-- update, or delete on its objects.
-- Uploads and downloads use the service role. The server chooses the object
-- name: {send_id}/{item_key}/{object_id}.
-- Privileges on storage.objects are left as they are. Other buckets stay
-- as they are. This file does not run against a hosted database by itself.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-agent-sends',
  'client-agent-sends',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  pol record;
begin
  for pol in
    select p.polname as policy_name
    from pg_policy p
    where p.polrelid = 'storage.objects'::regclass
      and (
        p.polname ilike '%client-agent-sends%'
        or p.polname ilike '%client_agent_send%'
        or coalesce(pg_get_expr(p.polqual, p.polrelid), '') ilike '%client-agent-sends%'
        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ilike '%client-agent-sends%'
      )
  loop
    execute format('drop policy %I on storage.objects', pol.policy_name);
  end loop;

  if exists (
    select 1
    from pg_policy p
    where p.polrelid = 'storage.objects'::regclass
      and (
        p.polname ilike '%client-agent-sends%'
        or p.polname ilike '%client_agent_send%'
        or coalesce(pg_get_expr(p.polqual, p.polrelid), '') ilike '%client-agent-sends%'
        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ilike '%client-agent-sends%'
      )
  ) then
    raise exception 'client-agent-sends must have no storage.objects policy';
  end if;
end $$;
