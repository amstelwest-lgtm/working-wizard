# MILŌN — Tab 5: Action Plan

Build spec for Replit Agent (Fable 5). Paste this whole file as the prompt.

---

## 0. Read this first, agent

You are extending an existing app called **MILŌN** — a financial health platform for South African SMEs and their accountants. The app already has four tabs:

1. **Business Health** — overall score
2. **Profit**
3. **Cash**
4. **Next Strategic Moves** — AI-generated recommendations
5. **Action Plan** ← you are building this

**Stack constraints — do not violate:**
- Backend, auth and database: **Supabase** (Postgres + RLS + Edge Functions + pg_cron).
- Match the frontend framework and conventions **already present in this repo**. Do not introduce a new framework, router, state library or CSS system. If the repo is vanilla HTML/CSS/JS, build it in vanilla HTML/CSS/JS.
- No new paid services except the transactional email provider (below).
- Before writing code, read the existing tab implementations and copy their file structure, naming, data-fetching pattern and styling approach.

**The one rule that matters:** this tab turns analysis into assigned work, and assigned work into visible progress. Every design decision serves that. If a feature does not help a task get done or get seen, cut it.

---

## 1. The core problem, and the answer

Tasks get assigned to employees who **do not have MILŌN accounts and never will**. The CEO has a login. Lindiwe in finance does not. So the update loop has to work entirely through email.

**Solution: tokenised task links. No login, ever, for the assignee.**

When a task is assigned, the assignee gets an email with a unique signed link. That link opens a single public page — one task, their task — where they can:

- Move status (Not started → In progress → Done)
- Tick weekly milestones
- Set a progress %
- Leave a short note
- Raise a blocker

No password, no account, no app. One tap from the email to the update.

### Critical implementation detail — do not skip this

**A GET request must never change data.** Outlook Safe Links, Gmail image proxies and corporate mail scanners *pre-fetch every URL in an email*. If `?action=done` completes a task on GET, tasks will silently mark themselves complete the moment the email lands.

So:
- The email's buttons are `GET /t/{token}?intent=done`
- That page loads with the status control **pre-selected but not saved**, and a primary button reading **Mark as done**
- The mutation only happens on `POST` from that page, with the token in the body

This is one tap more for the user, and it is the difference between a working system and a corrupt one.

### Token rules

- 32 bytes from a CSPRNG, base64url encoded, in the URL path
- Store only the **SHA-256 hash** in the database, never the raw token
- One token per task per assignee, reused across all emails about that task
- Expires at `due_date + 60 days`, or on `revoked_at`
- Rotates automatically if the task is reassigned to a different employee (old token dies immediately)
- Rate limit: 30 requests per token per hour
- The page exposes **only that one task** — never the plan, never other people's tasks, never financials beyond the task's own outcome line

### Email cadence — respect the inbox

| Trigger | Email |
|---|---|
| Task assigned or reassigned | **Assignment** — the ask, the why, due date, link |
| Due date changed | **Update** — short, one line |
| 3 days before due | **Nudge** |
| Due date passes, still open | **Overdue** — daily for 3 days, then weekly |
| Monday 07:00 | **Weekly digest** — all of that person's open tasks, one email, one link each |
| Task marked done | **Confirmation** to assignee + notification to plan owner |

The weekly digest is the workhorse. Per-task emails only fire on real events. Nobody should get more than one MILŌN email per day under normal operation — enforce this with a per-recipient daily cap in the send function.

**Provider: Resend.** Cheapest sane option, clean API, works from a Supabase Edge Function, good deliverability. Requires domain verification (SPF + DKIM on the MILŌN sending domain). Alternative if deliverability in SA becomes a problem: Postmark.

---

## 2. Data model

Run this as a Supabase migration.

```sql
-- ============================================================
-- MILŌN Action Plan
-- ============================================================

create type action_status as enum ('not_started', 'in_progress', 'done', 'blocked');
create type action_health as enum ('on_track', 'at_risk', 'off_track', 'overdue', 'complete');
create type action_source as enum ('strategic_move', 'manual');

-- People who receive tasks. Not app users.
create table employees (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organisations(id) on delete cascade,
  full_name    text not null,
  email        citext not null,
  role_title   text,
  avatar_url   text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (org_id, email)
);

-- One plan per period. The container for the outcome goal.
create table action_plans (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organisations(id) on delete cascade,
  period_label   text not null,                    -- 'Q3 2025'
  outcome_goal   text not null,                    -- 'Increase Cash on Hand to R2.5M'
  why_statement  text,                             -- first-principles reason
  metric_name    text,                             -- 'Cash on Hand'
  metric_start   numeric,
  metric_target  numeric,
  metric_current numeric,
  target_date    date not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

-- The tasks.
create table action_items (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references action_plans(id) on delete cascade,
  seq               integer not null,
  title             text not null,                 -- 'Reduce Debtor Days to < 30 days'
  outcome_why       text,                          -- 'Faster cash in = more liquidity'
  owner_id          uuid references employees(id) on delete set null,
  due_date          date not null,
  status            action_status not null default 'not_started',
  progress_pct      integer not null default 0 check (progress_pct between 0 and 100),
  blocker_note      text,
  source            action_source not null default 'manual',
  source_move_id    uuid references strategic_moves(id) on delete set null,
  driver_key        text,                          -- links to a financial driver, e.g. 'debtor_days'
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (plan_id, seq)
);

-- Optional weekly breakdown (W1..W4 in the design).
create table action_milestones (
  id              uuid primary key default gen_random_uuid(),
  action_item_id  uuid not null references action_items(id) on delete cascade,
  week_no         integer not null check (week_no between 1 and 12),
  label           text not null,
  is_done         boolean not null default false,
  done_at         timestamptz,
  unique (action_item_id, week_no)
);

-- Magic links. Hash only.
create table action_tokens (
  id              uuid primary key default gen_random_uuid(),
  action_item_id  uuid not null references action_items(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
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
  actor_type      text not null check (actor_type in ('owner_app', 'assignee_link', 'system')),
  actor_label     text not null,                   -- 'Lindiwe M.' or 'MILŌN'
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
  recipient_email citext not null,
  email_type      text not null,                   -- assignment|nudge|overdue|digest|done
  provider_id     text,
  status          text not null default 'queued',
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index on action_emails (recipient_email, created_at desc);
```

### Health is derived, never typed

Do not let anyone set "On track" by hand — a status that can be chosen is a status that lies. Compute it:

```sql
create or replace function action_item_health(
  p_status       action_status,
  p_due          date,
  p_progress     integer,
  p_created      timestamptz
) returns action_health language sql immutable as $$
  select case
    when p_status = 'done'                              then 'complete'::action_health
    when p_due < current_date                           then 'overdue'::action_health
    when p_status = 'blocked'                           then 'off_track'::action_health
    else case
      -- pace = actual progress ÷ expected progress by now
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

create view action_items_v as
  select ai.*,
         action_item_health(ai.status, ai.due_date, ai.progress_pct, ai.created_at) as health,
         e.full_name as owner_name,
         e.email     as owner_email,
         e.role_title as owner_role,
         e.avatar_url as owner_avatar,
         (ai.due_date - current_date) as days_remaining
  from action_items ai
  left join employees e on e.id = ai.owner_id;
```

**Pace** is the whole idea: not "how much is done" but "how much is done *relative to how much time has burnt*." A task at 40% with 20% of the time gone is healthy. The same task with 80% of the time gone is not. Show this honestly.

### Plan confidence

```
item_score =
  1.00                              if done
  0.20                              if overdue or blocked
  clamp(pace, 0, 1)                 otherwise

confidence = round(100 × mean(item_score))
```

Display it with the burn-up chart next to it so the number is explainable, not magic. If someone asks "why 78%?", the chart answers.

### RLS

```sql
alter table employees        enable row level security;
alter table action_plans     enable row level security;
alter table action_items     enable row level security;
alter table action_milestones enable row level security;
alter table action_updates   enable row level security;
alter table action_tokens    enable row level security;
alter table action_emails    enable row level security;

-- App users see only their org. Repeat the pattern per table.
create policy org_read on action_items for select
  using (plan_id in (
    select id from action_plans where org_id in (
      select org_id from org_members where user_id = auth.uid()
    )
  ));

create policy org_write on action_items for all
  using (plan_id in (
    select id from action_plans where org_id in (
      select org_id from org_members where user_id = auth.uid()
    )
  ));

-- action_tokens: NO anon or authenticated policy at all.
-- Only the service role, inside Edge Functions, ever touches it.
```

---

## 3. Edge Functions

Four functions. Keep them small.

### `task-link` — the public update endpoint

`GET /functions/v1/task-link/:token` → returns the task payload (read-only, safe to prefetch)
`POST /functions/v1/task-link/:token` → applies the update

```ts
// supabase/functions/task-link/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function hash(token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function resolve(token: string) {
  const { data } = await db
    .from("action_tokens")
    .select("id, action_item_id, employee_id, expires_at, revoked_at, use_count")
    .eq("token_hash", await hash(token))
    .maybeSingle();

  if (!data) return { error: "not_found" };
  if (data.revoked_at) return { error: "revoked" };
  if (new Date(data.expires_at) < new Date()) return { error: "expired" };
  return { token: data };
}

Deno.serve(async (req) => {
  const token = new URL(req.url).pathname.split("/").pop()!;
  const t = await resolve(token);
  if ("error" in t) return json({ error: t.error }, 404);

  // ---- READ: never mutates. Safe for mail scanners to prefetch. ----
  if (req.method === "GET") {
    const { data: item } = await db
      .from("action_items_v")
      .select("id, seq, title, outcome_why, due_date, status, progress_pct, health, owner_name, blocker_note")
      .eq("id", t.token.action_item_id)
      .single();

    const { data: milestones } = await db
      .from("action_milestones")
      .select("id, week_no, label, is_done")
      .eq("action_item_id", t.token.action_item_id)
      .order("week_no");

    const { data: plan } = await db
      .from("action_plans")
      .select("outcome_goal, period_label")
      .eq("id", item!.plan_id)
      .single();

    return json({ item, milestones, plan });
  }

  // ---- WRITE ----
  if (req.method === "POST") {
    const body = await req.json();
    const { data: before } = await db
      .from("action_items").select("status, progress_pct")
      .eq("id", t.token.action_item_id).single();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.status)      patch.status = body.status;
    if (body.progress_pct !== undefined)
      patch.progress_pct = Math.max(0, Math.min(100, body.progress_pct));
    if (body.status === "done") {
      patch.completed_at = new Date().toISOString();
      patch.progress_pct = 100;
    }
    if (body.blocker_note !== undefined) patch.blocker_note = body.blocker_note;

    await db.from("action_items").update(patch).eq("id", t.token.action_item_id);

    if (Array.isArray(body.milestones)) {
      for (const m of body.milestones) {
        await db.from("action_milestones")
          .update({ is_done: m.is_done, done_at: m.is_done ? new Date().toISOString() : null })
          .eq("id", m.id).eq("action_item_id", t.token.action_item_id);
      }
    }

    const { data: emp } = await db
      .from("employees").select("full_name").eq("id", t.token.employee_id).single();

    await db.from("action_updates").insert({
      action_item_id: t.token.action_item_id,
      actor_type: "assignee_link",
      actor_label: emp?.full_name ?? "Assignee",
      status_from: before?.status,
      status_to: patch.status ?? before?.status,
      progress_from: before?.progress_pct,
      progress_to: patch.progress_pct ?? before?.progress_pct,
      note: body.note ?? null,
    });

    await db.from("action_tokens")
      .update({ last_used_at: new Date().toISOString(), use_count: t.token.use_count + 1 })
      .eq("id", t.token.id);

    return json({ ok: true });
  }

  return json({ error: "method_not_allowed" }, 405);
});

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
```

### `send-task-email` — assignment, nudge, overdue, done

Takes `{ action_item_id, email_type }`. Mints a token if none exists. Checks the daily cap per recipient. Sends via Resend. Logs to `action_emails`.

### `weekly-digest` — pg_cron, Mondays 07:00 SAST

Groups every open task by assignee, one email each.

### `plan-sweep` — pg_cron, daily 06:00 SAST

Fires nudges for tasks due in 3 days, overdue emails per the cadence, and recomputes `metric_current` from the org's latest financials.

```sql
select cron.schedule('milon-plan-sweep', '0 4 * * *',
  $$ select net.http_post(
       url := 'https://<project>.supabase.co/functions/v1/plan-sweep',
       headers := '{"Authorization":"Bearer <service-role>"}'::jsonb) $$);

select cron.schedule('milon-weekly-digest', '0 5 * * 1',
  $$ select net.http_post(
       url := 'https://<project>.supabase.co/functions/v1/weekly-digest',
       headers := '{"Authorization":"Bearer <service-role>"}'::jsonb) $$);
```

(Cron runs in UTC. 04:00 UTC = 06:00 SAST.)

---

## 4. The assignment email

Plain, personal, short. It is from a colleague, not from software.

```
Subject: Reduce Debtor Days to under 30 — due 30 Sep

Hi Lindiwe,

You own this one in the Q3 action plan:

  REDUCE DEBTOR DAYS TO UNDER 30 DAYS
  Due 30 September 2025

  Why it matters: faster cash in means more liquidity and
  less reliance on debt. It moves the company toward
  R2.5M cash on hand.

  Working backwards:
  W1  Top 20 debtors plan
  W2  Payment terms comms
  W3  Automated reminders live
  W4  Review and tighten

  [ I'm on it ]   [ Mark as done ]   [ I'm blocked ]

No login needed — the buttons open your task page.

— MILŌN, on behalf of Theo W.
```

Constraints: single column, max 600px, real text not images, all three buttons are GETs carrying `?intent=`, and every one of them lands on the task page without changing anything.

---

## 5. The public task page — `/t/:token`

One task. One screen. Works on a phone in the parking lot.

```
┌─────────────────────────────────────┐
│  milon                     Q3 2025  │
├─────────────────────────────────────┤
│                                     │
│  YOUR TASK                          │
│  Reduce Debtor Days                 │
│  to under 30 days                   │
│                                     │
│  Due 30 Sep 2025 · 12 days left     │
│                                     │
│  Why this matters ───────────────   │
│  Faster cash in = more liquidity    │
│  and less reliance on debt.         │
│                                     │
│  ── Where are you? ──────────────   │
│                                     │
│  ( ) Not started                    │
│  (•) In progress                    │
│  ( ) Done                           │
│  ( ) I'm blocked                    │
│                                     │
│  Progress                           │
│  ●━━━━━━━━━━━━○─────────  60%       │
│                                     │
│  ── This week ───────────────────   │
│  ☑ W1  Top 20 debtors plan          │
│  ☑ W2  Payment terms comms          │
│  ☐ W3  Automated reminders live     │
│  ☐ W4  Review and tighten           │
│                                     │
│  Anything Theo should know?         │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  └─────────────────────────────┘    │
│                                     │
│  [      Save update      ]          │
│                                     │
│  Last updated 2 days ago            │
└─────────────────────────────────────┘
```

- If `?intent=done`, preselect Done and change the button to **Mark as done**. Still a POST.
- Selecting **I'm blocked** reveals the note field and makes it required. A blocker without a reason is not information.
- After save: the same page, confirmed inline, no redirect. `Saved. Theo has been notified.`
- Expired token: `This link has expired. Ask Theo to resend it.` Not an error page.

---

## 6. The Action Plan tab

Refer to the attached design. Match it. Structure top to bottom:

### 6.1 Goal header
Outcome goal, target date, the why, current metric with gap to goal. This is the spine — every task below inherits its justification from here. Editable inline by the plan owner.

### 6.2 Financial drivers strip
Five cards pulled from Tab 1–3 analysis: metric, current value, target, health chip. Read-only here. `View full analysis →` deep-links back to the source tab. This strip is the bridge: it shows *why these tasks exist*.

### 6.3 The table — the heart of it

| # | Action / Deliverable | Owner | Outcome (why) | Due | Weekly milestones | Status |

Behaviour:

- **Inline editing everywhere.** Click the title, type. Click the owner cell, pick from a searchable employee list with a **+ Add employee** row at the bottom (name + email, that's it). Click the date, pick. Nothing opens a modal for a single-field edit.
- **Status cell** is a chip showing derived health. Clicking it opens the task drawer, not a dropdown — because health is computed, not chosen. The owner *can* override status (`not_started/in_progress/done/blocked`) inside the drawer.
- **Row drawer** slides from the right: full description, milestones, the update timeline from `action_updates`, `Resend link`, `Reassign`, `Delete`.
- **Reassigning revokes the old token and mints a new one.** Show a small confirm: `Lindiwe's link will stop working. Send Jason a new one?`
- **Overdue rows** get a left border in red and the due date turns red. No other row decoration — let the exception stand out.
- **Sort** by due date default. Sortable by owner, status, due.
- **Filter** chips above the table: `All · Overdue · At risk · Mine · By owner`.
- **Drag to reorder** updates `seq`.

### 6.4 Adding tasks — two doors

**Door 1 — Import from Strategic Moves.** A button `Import from Strategic Moves` opens a panel listing Tab 4's recommendations with checkboxes. Each imported move pre-fills title, why, and the linked driver; the user then sets owner and due date. Imported rows keep a small `From strategic moves` marker so the origin stays visible. An already-imported move shows as greyed with `Added`.

**Door 2 — Manual.** A persistent empty row at the bottom of the table: type a title, press Enter, the row is created. Owner and date can follow. Do not force a modal on someone who just wants to jot a task down.

### 6.5 Assign and send

Tasks are created in a **draft** state and show `Not sent`. A single `Send 3 assignments` button in the toolbar fires the emails in a batch and flips those rows to sent. This prevents half-finished tasks emailing people. Rows missing an owner or a due date are excluded, and the button says so: `2 of 5 ready to send`.

---

## 7. The four visuals

Only four. Each earns its place.

**1. Gap-to-goal bar (header).** Horizontal, `metric_start → metric_current → metric_target`, with a thin vertical marker showing where you *should* be by today given the timeline. Being behind the marker is the single most important fact on the page.

**2. Health donut (footer left).** Total actions in the centre, segments for On track / At risk / Off track / Overdue / Complete. Segments are clickable and filter the table. Static charts are decoration; clickable charts are navigation.

**3. Burn-up line (footer centre).** Two lines: the planned progress line (straight, start to target date) and actual mean progress over time. Where actual sits relative to planned *is* the confidence number, made visible. Label the gap.

**4. Owner load bar (footer right).** A small stacked horizontal bar per person showing open tasks by health. Answers "who is drowning" in one glance, and catches the classic failure where one person owns five of seven actions.

**Explicitly not building:** Gantt chart, kanban board, calendar view, burndown *and* burn-up, dependency graph. Ship the five above; add nothing until someone asks twice.

---

## 8. Visual direction

Follow the attached mockup and the existing MILŌN system.

```
--bg           #0A0C0B    page
--surface      #10130F    cards
--surface-2    #161A15    raised / hover
--line         rgba(255,255,255,0.07)
--text         #E8EDE9
--text-dim     #8A938C
--accent       #22C55E    on track, primary actions
--warn         #F5A524    at risk
--danger       #EF4444    off track, overdue
```

- Display: **Bebas Neue**, uppercase, for section eyebrows and the goal statement.
- Body/data: the existing app sans. Tabular numerals on every figure — misaligned rands look amateur.
- Handwritten accent (**Caveat**) reserved for exactly one thing: the culture note in the sidebar. Once, or it becomes a gimmick.
- Radius 10px on cards, 6px on chips. Borders over shadows on dark.
- Motion: rows fade in on load, status chips crossfade on change, the donut draws once. Respect `prefers-reduced-motion`. Nothing else moves.

The signature element is the **pace marker** — the small vertical tick on every progress bar showing where the task should be today. It appears in the goal bar, in each row, and on the public task page. It is the visual argument of the whole product: not "how much have you done", but "are you keeping up".

---

## 9. Build order

1. Migration + `action_items_v` view + RLS
2. Table with inline editing, employee picker, CRUD — no email yet
3. Import from Strategic Moves
4. `task-link` Edge Function + public `/t/:token` page (test the prefetch behaviour with a GET before wiring email)
5. `send-task-email` + Resend + assignment template
6. Header, driver strip, four visuals
7. `plan-sweep` + `weekly-digest` on pg_cron
8. Filters, sort, drag reorder, activity timeline

Ship 1–5 before touching 6. A beautiful chart above a table nobody can update is worthless.

## 10. Acceptance criteria

- [ ] A GET to a task link — including three GETs in a row from a scanner — changes nothing in the database
- [ ] A task can go from Strategic Moves → assigned → emailed → updated by a non-user → reflected in the dashboard, without the assignee ever seeing a login screen
- [ ] Reassigning kills the old token; the old link returns `revoked`
- [ ] Health cannot be set by hand from the table; it always follows from due date and pace
- [ ] Adding a task takes one field and one Enter
- [ ] Adding an employee takes a name and an email
- [ ] No recipient can receive more than one MILŌN email in a day outside of a manual resend
- [ ] The task page is usable one-handed on a 375px screen
- [ ] Every figure on screen traces to a query, not a hardcoded value
