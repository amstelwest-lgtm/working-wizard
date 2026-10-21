-- Private bucket for files collected on /a/<token>.
-- New bucket only. No policies, so anon and authenticated cannot read or write.
-- The app server uses the service role, which bypasses storage RLS.
-- Object names are chosen by the server: {send_id}/{item_key}/{object_id}.
-- This file does not run against a hosted database by itself.

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
