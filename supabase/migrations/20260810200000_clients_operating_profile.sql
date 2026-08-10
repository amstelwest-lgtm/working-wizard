-- Client operating profile (10-question Milōn intro funnel).
-- Stores pay motion, volume unit, WC/cost shape, team/revenue bands, pressure, etc.

alter table public.clients
  add column if not exists operating_profile jsonb;

comment on column public.clients.operating_profile is
  'ClientOperatingProfile JSON from intro funnel — drives budget kit, benchmarks mapping, and deliverable context';
