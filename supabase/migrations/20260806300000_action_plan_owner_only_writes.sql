-- Migration: restrict Action Plan write operations to client owners and firm members
-- ──────────────────────────────────────────────────────────────────────────────
-- Previously all write policies on action_plans, action_items, action_milestones,
-- action_updates and action_emails used has_client_access(), which includes invited
-- client_member users.  A member could therefore create, update, delete plans and
-- actions via the Supabase API even though the UI hides those controls.
--
-- The correct boundary:
--   SELECT — any user with has_client_access() (owners, members, firm staff)
--   INSERT/UPDATE/DELETE — only the client owner (clients.owner_user_id = auth.uid())
--                          or a firm member (accountant / firm_admin impersonating)
--
-- action_tokens has NO client-side policy at all (service role only) — unchanged.
-- action_updates INSERT is retained for authenticated writers; the edge functions
-- (task-admin, nudge) use the service role which bypasses RLS entirely.

-- ── Helper: owner-or-firm writer check ──────────────────────────────────────
-- Returns true when the user is the primary owner of the client OR a member of the
-- client's firm (accountant / firm_admin). Excludes invited client_members.
create or replace function public.is_action_plan_writer(_user_id uuid, _client_id uuid)
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

grant execute on function public.is_action_plan_writer(uuid, uuid) to authenticated;

-- ── action_plans ─────────────────────────────────────────────────────────────
drop policy if exists "plans write"  on action_plans;
drop policy if exists "plans update" on action_plans;
drop policy if exists "plans delete" on action_plans;

create policy "plans write"  on action_plans for insert
  with check (public.is_action_plan_writer(auth.uid(), client_id));

create policy "plans update" on action_plans for update
  using (public.is_action_plan_writer(auth.uid(), client_id));

create policy "plans delete" on action_plans for delete
  using (public.is_action_plan_writer(auth.uid(), client_id));

-- ── action_items ─────────────────────────────────────────────────────────────
drop policy if exists "items write"  on action_items;
drop policy if exists "items update" on action_items;
drop policy if exists "items delete" on action_items;

create policy "items write"  on action_items for insert
  with check (public.is_action_plan_writer(auth.uid(), client_id));

create policy "items update" on action_items for update
  using (public.is_action_plan_writer(auth.uid(), client_id));

create policy "items delete" on action_items for delete
  using (public.is_action_plan_writer(auth.uid(), client_id));

-- ── action_milestones ────────────────────────────────────────────────────────
drop policy if exists "milestones write"  on action_milestones;
drop policy if exists "milestones update" on action_milestones;
drop policy if exists "milestones delete" on action_milestones;

create policy "milestones write" on action_milestones for insert
  with check (
    exists (
      select 1 from action_items ai
      where ai.id = action_item_id
        and public.is_action_plan_writer(auth.uid(), ai.client_id)
    )
  );

create policy "milestones update" on action_milestones for update
  using (
    exists (
      select 1 from action_items ai
      where ai.id = action_item_id
        and public.is_action_plan_writer(auth.uid(), ai.client_id)
    )
  );

create policy "milestones delete" on action_milestones for delete
  using (
    exists (
      select 1 from action_items ai
      where ai.id = action_item_id
        and public.is_action_plan_writer(auth.uid(), ai.client_id)
    )
  );

-- ── action_updates ───────────────────────────────────────────────────────────
-- Owner app writes via JWT; assignee link and nudge cron use service role (bypasses RLS).
drop policy if exists "updates write" on action_updates;

create policy "updates write" on action_updates for insert
  with check (public.is_action_plan_writer(auth.uid(), client_id));

-- ── action_emails ─────────────────────────────────────────────────────────────
drop policy if exists "emails write" on action_emails;

create policy "emails write" on action_emails for insert
  with check (public.is_action_plan_writer(auth.uid(), client_id));
