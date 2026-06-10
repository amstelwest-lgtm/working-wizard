
-- ============ Roles enum + table ============
create type public.app_role as enum ('accountant', 'firm_admin', 'client_owner', 'client_member');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- ============ Profiles ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ Firms ============
create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  referral_code text unique default substr(replace(gen_random_uuid()::text,'-',''),1,10),
  created_at timestamptz not null default now()
);
alter table public.firms enable row level security;

create table public.firm_memberships (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (firm_id, user_id)
);
alter table public.firm_memberships enable row level security;

create or replace function public.is_firm_member(_user_id uuid, _firm_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.firm_memberships
    where user_id = _user_id and firm_id = _firm_id
  ) or exists (
    select 1 from public.firms where id = _firm_id and owner_user_id = _user_id
  );
$$;

-- ============ Clients (a "client" = a business tenant) ============
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  firm_id uuid references public.firms(id) on delete set null,
  business_type text,
  cash_runway_weeks numeric,
  last_forecast_at timestamptz,
  open_queries_count int not null default 0,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.clients enable row level security;

create table public.client_memberships (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (client_id, user_id)
);
alter table public.client_memberships enable row level security;

create or replace function public.has_client_access(_user_id uuid, _client_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.clients c
    where c.id = _client_id
    and (
      c.owner_user_id = _user_id
      or exists (select 1 from public.client_memberships m where m.client_id = c.id and m.user_id = _user_id)
      or (c.firm_id is not null and public.is_firm_member(_user_id, c.firm_id))
    )
  );
$$;

-- ============ Impersonation audit ============
create table public.impersonation_audit (
  id uuid primary key default gen_random_uuid(),
  firm_user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  firm_id uuid references public.firms(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table public.impersonation_audit enable row level security;

-- ============ RLS policies ============

-- user_roles: user can read own
create policy "users read own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "users insert own roles" on public.user_roles for insert to authenticated with check (user_id = auth.uid());

-- profiles
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid());

-- firms: owner or member can read; only the owner can update; any authenticated user can create a firm (for themselves)
create policy "firm read by member" on public.firms for select to authenticated
  using (owner_user_id = auth.uid() or public.is_firm_member(auth.uid(), id));
create policy "firm insert own" on public.firms for insert to authenticated
  with check (owner_user_id = auth.uid());
create policy "firm update by owner" on public.firms for update to authenticated
  using (owner_user_id = auth.uid());
create policy "firm delete by owner" on public.firms for delete to authenticated
  using (owner_user_id = auth.uid());

-- firm_memberships
create policy "firm memberships read by member" on public.firm_memberships for select to authenticated
  using (user_id = auth.uid() or public.is_firm_member(auth.uid(), firm_id));
create policy "firm memberships insert by firm owner" on public.firm_memberships for insert to authenticated
  with check (exists (select 1 from public.firms f where f.id = firm_id and f.owner_user_id = auth.uid()));
create policy "firm memberships delete by firm owner" on public.firm_memberships for delete to authenticated
  using (exists (select 1 from public.firms f where f.id = firm_id and f.owner_user_id = auth.uid()));

-- clients
create policy "clients read by access" on public.clients for select to authenticated
  using (public.has_client_access(auth.uid(), id));
create policy "clients insert own" on public.clients for insert to authenticated
  with check (owner_user_id = auth.uid());
create policy "clients update by access" on public.clients for update to authenticated
  using (public.has_client_access(auth.uid(), id));
create policy "clients delete by owner" on public.clients for delete to authenticated
  using (owner_user_id = auth.uid());

-- client_memberships
create policy "client memberships read" on public.client_memberships for select to authenticated
  using (user_id = auth.uid() or public.has_client_access(auth.uid(), client_id));
create policy "client memberships insert by client owner" on public.client_memberships for insert to authenticated
  with check (exists (select 1 from public.clients c where c.id = client_id and c.owner_user_id = auth.uid()));
create policy "client memberships delete by client owner" on public.client_memberships for delete to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id and c.owner_user_id = auth.uid()));

-- impersonation_audit: firm user inserts their own; firm members of that firm can read
create policy "audit insert own" on public.impersonation_audit for insert to authenticated
  with check (firm_user_id = auth.uid());
create policy "audit read own or firm" on public.impersonation_audit for select to authenticated
  using (firm_user_id = auth.uid() or (firm_id is not null and public.is_firm_member(auth.uid(), firm_id)));
create policy "audit update own" on public.impersonation_audit for update to authenticated
  using (firm_user_id = auth.uid());
