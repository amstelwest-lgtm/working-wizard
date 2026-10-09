-- Internal rolling 12-month SA revenue from stored Stripe invoices.
-- Service role only. Not applied by this change. No alerting.

create table if not exists public.stripe_invoice_payments (
  id text primary key,
  currency text not null,
  amount_paid_cents bigint not null,
  paid_at timestamptz not null,
  status text not null
);

alter table public.stripe_invoice_payments enable row level security;

revoke all on table public.stripe_invoice_payments from public, anon, authenticated;
grant select, insert, update on table public.stripe_invoice_payments to service_role;

create or replace function public.sa_zar_revenue_rolling_12m()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount_paid_cents), 0)::bigint
  from public.stripe_invoice_payments
  where lower(currency) = 'zar'
    and status = 'paid'
    and paid_at >= now() - interval '12 months';
$$;

revoke all on function public.sa_zar_revenue_rolling_12m() from public, anon, authenticated;
grant execute on function public.sa_zar_revenue_rolling_12m() to service_role;

create or replace view public.sa_revenue_zar_rolling_12m
with (security_invoker = true) as
select public.sa_zar_revenue_rolling_12m() as amount_paid_cents;

revoke all on table public.sa_revenue_zar_rolling_12m from public, anon, authenticated;
grant select on table public.sa_revenue_zar_rolling_12m to service_role;
