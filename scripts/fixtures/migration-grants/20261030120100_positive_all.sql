-- expect: pass
create table if not exists public.widget (
  id uuid primary key
);

grant all privileges on public.widget to authenticated, service_role;
