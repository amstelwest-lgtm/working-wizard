-- Staged statement uploads.
--
-- The browser puts a PDF straight into this private bucket, then calls the
-- server function with the object path. The server reads the object back
-- under the caller's own RLS, sends it to Claude and deletes it. Request
-- bodies to the app server stay small (Vercel caps them at 4.5 MB; a scanned
-- set of annual financials is routinely 10-30 MB).
--
-- Objects live under {auth.uid()}/{uuid}.pdf and are removed by the server
-- as soon as they have been read, so the bucket is a waiting room, not an
-- archive.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'statement-uploads',
  'statement-uploads',
  false,
  33554432,
  array['application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "statement uploads own folder insert" on storage.objects;
create policy "statement uploads own folder insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'statement-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "statement uploads own folder read" on storage.objects;
create policy "statement uploads own folder read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'statement-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "statement uploads own folder delete" on storage.objects;
create policy "statement uploads own folder delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'statement-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
