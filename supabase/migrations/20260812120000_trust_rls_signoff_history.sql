-- Trust batch: harden notes/deliveries UPDATE + append-only sign-off history
-- ────────────────────────────────────────────────────────────────────────────
-- G33  Notes: non-authors may only toggle `resolved` (+ updated_at).
-- N4   Deliveries: accessors may only set ack columns (via RPC preferred).
-- G16  Sign-offs: append-only history table; latest row still on main table.

-- ── G33: notes column-restrict trigger ──────────────────────────────────────

create or replace function public.client_notes_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Authors may edit freely.
  if auth.uid() is not null and auth.uid() = old.author_id then
    new.updated_at := now();
    return new;
  end if;

  -- Service role / migrations.
  if auth.uid() is null then
    return new;
  end if;

  -- Accessors may only toggle resolved (and touch updated_at).
  if new.id is distinct from old.id
     or new.client_id is distinct from old.client_id
     or new.tab is distinct from old.tab
     or new.x is distinct from old.x
     or new.y is distinct from old.y
     or new.body is distinct from old.body
     or new.author_id is distinct from old.author_id
     or new.author_name is distinct from old.author_name
     or new.author_email is distinct from old.author_email
     or new.mentions is distinct from old.mentions
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the note author may edit note content';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists client_notes_guard_update on public.client_notes;
create trigger client_notes_guard_update
  before update on public.client_notes
  for each row execute function public.client_notes_guard_update();

-- Keep policy name; behavior now enforced by trigger.
comment on policy "notes update by access" on public.client_notes is
  'Accessors may UPDATE; trigger restricts non-authors to resolved-only.';

-- ── N4: deliveries ack-only UPDATE + ack RPC ────────────────────────────────

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
     or new.ack_token is distinct from old.ack_token then
    raise exception 'advisory_deliveries: only acknowledgement fields may be updated';
  end if;

  return new;
end;
$$;

drop trigger if exists advisory_deliveries_guard_update on public.advisory_deliveries;
create trigger advisory_deliveries_guard_update
  before update on public.advisory_deliveries
  for each row execute function public.advisory_deliveries_guard_update();

-- Token-based acknowledgement (owner or any authenticated user with the token).
create or replace function public.acknowledge_advisory_delivery(_token text)
returns public.advisory_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.advisory_deliveries;
begin
  if _token is null or length(trim(_token)) < 16 then
    raise exception 'Invalid acknowledgement token';
  end if;

  update public.advisory_deliveries d
  set
    acknowledged_at = coalesce(d.acknowledged_at, now()),
    acknowledged_by = coalesce(d.acknowledged_by, auth.uid())
  where d.ack_token = _token
  returning * into row;

  if row.id is null then
    raise exception 'Acknowledgement token not found';
  end if;

  return row;
end;
$$;

grant execute on function public.acknowledge_advisory_delivery(text) to authenticated, anon;

comment on function public.acknowledge_advisory_delivery(text) is
  'Marks an advisory delivery acknowledged using its ack_token. Only sets ack columns.';

-- ── G16: append-only sign-off history ───────────────────────────────────────

create table if not exists public.client_review_signoff_history (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  scope                 text not null,
  signed_off_by_id      uuid not null references auth.users(id),
  signed_off_by_name    text not null,
  signed_off_by_initials text,
  signed_off_by_title   text,
  firm_name             text,
  note                  text,
  signed_off_at         timestamptz not null default now(),
  action                text not null default 'sign'
                        check (action in ('sign', 'retract')),
  created_at            timestamptz not null default now()
);

create index if not exists client_review_signoff_history_client_idx
  on public.client_review_signoff_history (client_id, scope, signed_off_at desc);

alter table public.client_review_signoff_history enable row level security;

create policy "read review signoff history"
  on public.client_review_signoff_history for select
  to authenticated
  using (public.has_client_access(auth.uid(), client_id));

-- Insert-only for accountants/firm_admins with access (append-only ledger).
create policy "accountants insert review signoff history"
  on public.client_review_signoff_history for insert
  to authenticated
  with check (
    signed_off_by_id = auth.uid()
    and public.has_client_access(auth.uid(), client_id)
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role in ('accountant', 'firm_admin')
    )
  );

-- No UPDATE / DELETE policies → append-only for authenticated role.

-- Mirror every upsert/delete on the current stamp table into history.
create or replace function public.client_review_signoffs_history_mirror()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.client_review_signoff_history (
      client_id, scope, signed_off_by_id, signed_off_by_name,
      signed_off_by_initials, signed_off_by_title, firm_name, note,
      signed_off_at, action
    ) values (
      old.client_id, old.scope, coalesce(auth.uid(), old.signed_off_by_id),
      coalesce(old.signed_off_by_name, 'Unknown'),
      old.signed_off_by_initials, old.signed_off_by_title, old.firm_name, old.note,
      now(), 'retract'
    );
    return old;
  end if;

  -- INSERT or UPDATE (re-sign)
  insert into public.client_review_signoff_history (
    client_id, scope, signed_off_by_id, signed_off_by_name,
    signed_off_by_initials, signed_off_by_title, firm_name, note,
    signed_off_at, action
  ) values (
    new.client_id, new.scope, new.signed_off_by_id, new.signed_off_by_name,
    new.signed_off_by_initials, new.signed_off_by_title, new.firm_name, new.note,
    new.signed_off_at, 'sign'
  );
  return new;
end;
$$;

drop trigger if exists client_review_signoffs_history_mirror on public.client_review_signoffs;
create trigger client_review_signoffs_history_mirror
  after insert or update or delete on public.client_review_signoffs
  for each row execute function public.client_review_signoffs_history_mirror();

-- Back-fill history from current stamps (one 'sign' event each).
insert into public.client_review_signoff_history (
  client_id, scope, signed_off_by_id, signed_off_by_name,
  signed_off_by_initials, signed_off_by_title, firm_name, note,
  signed_off_at, action
)
select
  s.client_id, s.scope, s.signed_off_by_id, s.signed_off_by_name,
  s.signed_off_by_initials, s.signed_off_by_title, s.firm_name, s.note,
  s.signed_off_at, 'sign'
from public.client_review_signoffs s
where not exists (
  select 1 from public.client_review_signoff_history h
  where h.client_id = s.client_id
    and h.scope = s.scope
    and h.signed_off_at = s.signed_off_at
    and h.action = 'sign'
);
