-- Gap 6: firm-persisted brand (logo, colours, tagline, contact)
-- ────────────────────────────────────────────────────────────────────────────
-- Brand settings previously lived only in browser localStorage
-- (milon_accountant_profile), so PDFs/reports differed per device and firm
-- members never shared a brand. Persist on firms; owner-only UPDATE (existing
-- "firm update by owner" policy). Members can still SELECT the brand.

alter table public.firms
  add column if not exists logo_url text,
  add column if not exists accent_color text,
  add column if not exists primary_color text,
  add column if not exists secondary_color text,
  add column if not exists tagline text,
  add column if not exists brand_contact_name text,
  add column if not exists brand_contact_email text,
  add column if not exists brand_updated_at timestamptz;

comment on column public.firms.logo_url is
  'Public URL (storage) or data-URL fallback for firm logo used on PDF reports';
comment on column public.firms.accent_color is
  'Hex accent used by resolveTheme / PDF hairlines';

-- ── Storage bucket for firm logos ───────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'firm-logos',
  'firm-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read (PDFs + <img> need a stable URL)
drop policy if exists "firm logos public read" on storage.objects;
create policy "firm logos public read"
  on storage.objects for select
  using (bucket_id = 'firm-logos');

-- Firm owners may upload under {firm_id}/…
drop policy if exists "firm owners upload logos" on storage.objects;
create policy "firm owners upload logos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'firm-logos'
    and (storage.foldername(name))[1] in (
      select f.id::text from public.firms f where f.owner_user_id = auth.uid()
    )
  );

drop policy if exists "firm owners update logos" on storage.objects;
create policy "firm owners update logos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'firm-logos'
    and (storage.foldername(name))[1] in (
      select f.id::text from public.firms f where f.owner_user_id = auth.uid()
    )
  );

drop policy if exists "firm owners delete logos" on storage.objects;
create policy "firm owners delete logos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'firm-logos'
    and (storage.foldername(name))[1] in (
      select f.id::text from public.firms f where f.owner_user_id = auth.uid()
    )
  );
