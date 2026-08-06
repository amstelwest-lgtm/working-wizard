-- Email suppression list used by the transactional send route (fail-closed check),
-- the unsubscribe route, and the Mailgun suppression webhook.
create table if not exists public.suppressed_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  reason text not null default 'unsubscribe',
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table public.suppressed_emails enable row level security;
-- service-role only: no policies.
