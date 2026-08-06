-- ============================================================
-- MILŌN Action Plan (Tab 5)
-- Org = clients table; people = client_employees (not app users)
-- ============================================================

create type action_status as enum ('not_started', 'in_progress', 'done', 'blocked');
create type action_health as enum ('on_track', 'at_risk', 'off_track', 'overdue', 'complete');
create type action_source as enum ('strategic_move', 'manual');

-- One plan per period. The container for the outcome goal.
create table action_plans (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients(id) on delete cascade,
  period_label   text not null,
  outcome_goal   text not null,
  why_statement  text,
  metric_name    text,
  metric_start   numeric,
  metric_target  numeric,
  metric_current numeric,
  target_date    date not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
create index on action_plans (client_id) where is_active;

-- The tasks.
create table action_items (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references action_plans(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  seq               integer not null,
  title             text not null,
  outcome_why       text,
  owner_id          uuid references client_employees(id) on delete set null,
  due_date          date,
  status            action_status not null default 'not_started',
  progress_pct      integer not null default 0 check (progress_pct between 0 and 100),
  blocker_note      text,
  source            action_source not null default 'manual',
  source_move_key   text,                      -- ratio key from Next Strategic Moves
  driver_key        text,
  sent_at           timestamptz,               -- null = draft / not emailed
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (plan_id, seq)
);
create index on action_items (plan_id);
create index on action_items (client_id);

-- Optional weekly breakdown (W1..W12).
create table action_milestones (
  id              uuid primary key default gen_random_uuid(),
  action_item_id  uuid not null references action_items(id) on delete cascade,
  week_no         integer not null check (week_no between 1 and 12),
  label           text not null,
  is_done         boolean not null default false,
  done_at         timestamptz,
  unique (action_item_id, week_no)
);

-- Magic links. Hash only. Service role only — no client policies, ever.
create table action_tokens (
  id              uuid primary key default gen_random_uuid(),
  action_item_id  uuid not null references action_items(id) on delete cascade,
  employee_id     uuid not null references client_employees(id) on delete cascade,
  token_hash      text not null unique,
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  use_count       integer not null default 0,
  created_at      timestamptz not null default now()
);
create index on action_tokens (action_item_id) where revoked_at is null;

-- Every change, for the activity feed and for trust.
create table action_updates (
  id              uuid primary key default gen_random_uuid(),
  action_item_id  uuid not null references action_items(id) on delete cascade,
  client_id       uuid not null references clients(id) on delete cascade,
  actor_type      text not null check (actor_type in ('owner_app', 'assignee_link', 'system')),
  actor_label     text not null,
  status_from     action_status,
  status_to       action_status,
  progress_from   integer,
  progress_to     integer,
  note            text,
  created_at      timestamptz not null default now()
);
create index on action_updates (action_item_id, created_at desc);

-- Send log. Powers the daily cap and the 'last nudged' column.
create table action_emails (
  id              uuid primary key default gen_random_uuid(),
  action_item_id  uuid references action_items(id) on delete cascade,
  client_id       uuid not null references clients(id) on delete cascade,
  recipient_email text not null,
  email_type      text not null,               -- assignment|nudge|overdue|digest|done
  status          text not null default 'queued',
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index on action_emails (recipient_email, created_at desc);

-- Health is derived, never typed.
create or replace function action_item_health(
  p_status       action_status,
  p_due          date,
  p_progress     integer,
  p_created      timestamptz
) returns action_health language sql immutable as $$
  select case
    when p_status = 'done'                              then 'complete'::action_health
    when p_due is not null and p_due < current_date     then 'overdue'::action_health
    when p_status = 'blocked'                           then 'off_track'::action_health
    when p_due is null                                  then 'on_track'::action_health
    else case
      when p_progress::numeric / greatest(
             100 * extract(epoch from (now() - p_created)) /
             greatest(extract(epoch from (p_due::timestamptz - p_created)), 1), 5
           ) >= 0.9 then 'on_track'::action_health
      when p_progress::numeric / greatest(
             100 * extract(epoch from (now() - p_created)) /
             greatest(extract(epoch from (p_due::timestamptz - p_created)), 1), 5
           ) >= 0.6 then 'at_risk'::action_health
      else 'off_track'::action_health
    end
  end;
$$;

create view action_items_v
with (security_invoker = true) as
  select ai.*,
         action_item_health(ai.status, ai.due_date, ai.progress_pct, ai.created_at) as health,
         e.name  as owner_name,
         e.email as owner_email,
         e.role  as owner_role,
         (ai.due_date - current_date) as days_remaining
  from action_items ai
  left join client_employees e on e.id = ai.owner_id;

-- updated_at trigger
create or replace function touch_action_item() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger action_items_touch before update on action_items
  for each row execute function touch_action_item();

-- ── RLS ─────────────────────────────────────────────────────
alter table action_plans      enable row level security;
alter table action_items      enable row level security;
alter table action_milestones enable row level security;
alter table action_updates    enable row level security;
alter table action_tokens     enable row level security;
alter table action_emails     enable row level security;

create policy "plans read"   on action_plans for select using (has_client_access(auth.uid(), client_id));
create policy "plans write"  on action_plans for insert with check (has_client_access(auth.uid(), client_id));
create policy "plans update" on action_plans for update using (has_client_access(auth.uid(), client_id));
create policy "plans delete" on action_plans for delete using (has_client_access(auth.uid(), client_id));

create policy "items read"   on action_items for select using (has_client_access(auth.uid(), client_id));
create policy "items write"  on action_items for insert with check (has_client_access(auth.uid(), client_id));
create policy "items update" on action_items for update using (has_client_access(auth.uid(), client_id));
create policy "items delete" on action_items for delete using (has_client_access(auth.uid(), client_id));

create policy "milestones read" on action_milestones for select using (
  exists (select 1 from action_items ai where ai.id = action_item_id and has_client_access(auth.uid(), ai.client_id)));
create policy "milestones write" on action_milestones for insert with check (
  exists (select 1 from action_items ai where ai.id = action_item_id and has_client_access(auth.uid(), ai.client_id)));
create policy "milestones update" on action_milestones for update using (
  exists (select 1 from action_items ai where ai.id = action_item_id and has_client_access(auth.uid(), ai.client_id)));
create policy "milestones delete" on action_milestones for delete using (
  exists (select 1 from action_items ai where ai.id = action_item_id and has_client_access(auth.uid(), ai.client_id)));

create policy "updates read" on action_updates for select using (has_client_access(auth.uid(), client_id));
create policy "updates write" on action_updates for insert with check (has_client_access(auth.uid(), client_id));

create policy "emails read" on action_emails for select using (has_client_access(auth.uid(), client_id));
create policy "emails write" on action_emails for insert with check (has_client_access(auth.uid(), client_id));

-- action_tokens: NO anon or authenticated policy at all.
-- Only the service role, inside Edge Functions, ever touches it.
