-- Owner plan entitlement. Stripe webhook and firm coverage write with the
-- service role. The signed-in owner can read their own row. No client writes.

create table if not exists public.owner_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'owner',
  status text not null,
  source text not null check (source in ('stripe', 'firm')),
  market text check (market is null or market in ('us', 'za')),
  interval text check (interval is null or interval in ('month', 'year')),
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  lookup_key text,
  firm_id uuid references public.firms(id) on delete set null,
  firm_name text,
  grace_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists owner_subscriptions_stripe_subscription_id_key
  on public.owner_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

drop trigger if exists owner_subscriptions_touch_updated_at on public.owner_subscriptions;
create trigger owner_subscriptions_touch_updated_at
  before update on public.owner_subscriptions
  for each row execute function public.touch_row_updated_at();

alter table public.owner_subscriptions enable row level security;

revoke all on table public.owner_subscriptions from public, anon, authenticated;
grant select on table public.owner_subscriptions to authenticated;
grant select, insert, update, delete on table public.owner_subscriptions to service_role;

drop policy if exists "owner_subscriptions read own" on public.owner_subscriptions;
create policy "owner_subscriptions read own"
  on public.owner_subscriptions
  for select
  to authenticated
  using (user_id = auth.uid());

comment on table public.owner_subscriptions is
  'Owner plan entitlement from Stripe or a covering accountant firm. Owners read their row. Writes are service role only.';
