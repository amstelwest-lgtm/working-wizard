-- G28: store the actual PDF artifact with advisory deliveries
-- ────────────────────────────────────────────────────────────────────────────
-- Ledger rows currently stamp figures_hash / metadata only. Re-download of the
-- exact PDF is impossible. Add a private storage path on insert + bucket.

alter table public.advisory_deliveries
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_byte_size integer;

comment on column public.advisory_deliveries.pdf_storage_path is
  'Private storage object path in advisory-pdfs bucket ({firm_id}/{client_id}/{uuid}.pdf)';
comment on column public.advisory_deliveries.pdf_byte_size is
  'Byte length of the stored PDF, when uploaded';

-- Guard: pdf path/size are immutable after insert (same as other payload cols).
create or replace function public.advisory_deliveries_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Only ack fields may change for authenticated callers.
  if new.id is distinct from old.id
     or new.client_id is distinct from old.client_id
     or new.firm_id is distinct from old.firm_id
     or new.channel is distinct from old.channel
     or new.kind is distinct from old.kind
     or new.subject is distinct from old.subject
     or new.body is distinct from old.body
     or new.recipient_email is distinct from old.recipient_email
     or new.recipient_name is distinct from old.recipient_name
     or new.report_key is distinct from old.report_key
     or new.snapshot_id is distinct from old.snapshot_id
     or new.figures_hash is distinct from old.figures_hash
     or new.period_label is distinct from old.period_label
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.ack_token is distinct from old.ack_token
     or new.pdf_storage_path is distinct from old.pdf_storage_path
     or new.pdf_byte_size is distinct from old.pdf_byte_size then
    raise exception 'advisory_deliveries: only acknowledgement fields may be updated';
  end if;

  return new;
end;
$$;

-- Private bucket for delivery PDFs (signed URLs for re-download)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'advisory-pdfs',
  'advisory-pdfs',
  false,
  20971520, -- 20 MB
  array['application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: {firm_id}/{client_id}/{uuid}.pdf
-- Access keyed off client_id folder segment via has_client_access.

drop policy if exists "advisory pdfs read" on storage.objects;
create policy "advisory pdfs read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'advisory-pdfs'
    and public.has_client_access(
      auth.uid(),
      ((storage.foldername(name))[2])::uuid
    )
  );

drop policy if exists "advisory pdfs insert" on storage.objects;
create policy "advisory pdfs insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'advisory-pdfs'
    and public.has_client_access(
      auth.uid(),
      ((storage.foldername(name))[2])::uuid
    )
  );

-- No update/delete — artifacts are append-only audit evidence.
drop policy if exists "advisory pdfs update" on storage.objects;
drop policy if exists "advisory pdfs delete" on storage.objects;
