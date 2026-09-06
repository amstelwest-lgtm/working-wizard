-- Per-user hourly cap on Claude document extraction.
--
-- Ask AI already has one (ask_ai_record_request). The four extraction server
-- functions — statement PDF, owner PDF, bank-statement P&L, bank → cash —
-- had none, so a single account could run the Anthropic bill up unbounded.
-- Same pattern: advisory lock per user, count the last hour, insert if under.
--
-- Called with the user's own JWT from the server function (auth.uid() is the
-- caller), so it needs EXECUTE for authenticated. SECURITY DEFINER lets it
-- write the log regardless of RLS.

create table if not exists public.extraction_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  kind        text not null,            -- statement-pdf | owner-pdf | bank-pnl | bank-cash
  files       integer not null default 1,
  bytes       bigint  not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists extraction_log_user_recent
  on public.extraction_log (user_id, created_at desc);

alter table public.extraction_log enable row level security;

drop policy if exists "extraction log own rows" on public.extraction_log;
create policy "extraction log own rows"
  on public.extraction_log for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.extraction_record_request(
  p_kind  text,
  p_files integer default 1,
  p_bytes bigint  default 0,
  p_limit integer default 20
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('extraction:' || v_uid::text));

  select count(*) into v_count
  from public.extraction_log
  where user_id = v_uid
    and created_at > now() - interval '1 hour';

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.extraction_log (user_id, kind, files, bytes)
  values (v_uid, p_kind, greatest(1, coalesce(p_files, 1)), greatest(0, coalesce(p_bytes, 0)));

  return true;
end;
$$;

revoke execute on function public.extraction_record_request(text, integer, bigint, integer) from public;
revoke execute on function public.extraction_record_request(text, integer, bigint, integer) from anon;
grant  execute on function public.extraction_record_request(text, integer, bigint, integer) to authenticated;
grant  execute on function public.extraction_record_request(text, integer, bigint, integer) to service_role;

comment on function public.extraction_record_request is
  'Records one document-extraction request for the calling user and returns false when they have already made p_limit in the last hour. Serialised per user.';
