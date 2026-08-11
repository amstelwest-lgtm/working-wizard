-- Gap 3 (Option A): allow firm members to UPDATE advisory client fields
-- ────────────────────────────────────────────────────────────────────────────
-- Migration 20260806200000 locked clients UPDATE to owner_user_id only so
-- invited client_members could not PATCH business_type / financials / etc.
-- That also blocked accountants (firm members), whose portal still writes
-- financials, cashflow, budget, runway, contacts, and report counters.
--
-- Correct boundary (same as is_action_plan_writer):
--   UPDATE allowed for client owner OR firm member
--   invited client_member remains blocked
--
-- Owner-only identity columns are enforced with a BEFORE UPDATE trigger so
-- firm staff cannot reassign ownership / firm link even though row UPDATE is open.

-- ── Helper: owner-or-firm writer (canonical name for clients + related) ──────
create or replace function public.is_client_writer(_user_id uuid, _client_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.clients c
    where c.id = _client_id
    and (
      c.owner_user_id = _user_id
      or (c.firm_id is not null and public.is_firm_member(_user_id, c.firm_id))
    )
  );
$$;

grant execute on function public.is_client_writer(uuid, uuid) to authenticated;

-- Keep the Action Plan helper in sync (same predicate).
create or replace function public.is_action_plan_writer(_user_id uuid, _client_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_client_writer(_user_id, _client_id);
$$;

-- ── Protect ownership / firm-link columns for non-owners ─────────────────────
create or replace function public.clients_guard_owner_only_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Owners may change anything on their row.
  if auth.uid() is not null and auth.uid() = old.owner_user_id then
    return new;
  end if;

  -- Service role / no JWT (migrations, edge functions) — leave alone.
  if auth.uid() is null then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'clients.id is immutable';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'clients.created_at is owner-only';
  end if;
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'clients.owner_user_id is owner-only';
  end if;
  if new.firm_id is distinct from old.firm_id then
    raise exception 'clients.firm_id is owner-only';
  end if;
  if new.last_login_at is distinct from old.last_login_at then
    raise exception 'clients.last_login_at is owner-only';
  end if;

  return new;
end;
$$;

drop trigger if exists clients_guard_owner_only_columns on public.clients;
create trigger clients_guard_owner_only_columns
  before update on public.clients
  for each row
  execute function public.clients_guard_owner_only_columns();

-- ── RLS: owner or firm may UPDATE ───────────────────────────────────────────
drop policy if exists "clients update by owner" on public.clients;
drop policy if exists "clients update by access" on public.clients;
drop policy if exists "clients update by owner or firm" on public.clients;

create policy "clients update by owner or firm"
  on public.clients
  for update
  to authenticated
  using (public.is_client_writer(auth.uid(), id))
  with check (public.is_client_writer(auth.uid(), id));
