-- Trust: restrict financial snapshot mutations to writers; no DELETE for accessors.
-- SELECT stays has_client_access. UPDATE/INSERT require is_client_writer so invited
-- client_members cannot rewrite history. App upserts current-period rows, so UPDATE
-- must remain for writers (cannot be fully append-only).

drop policy if exists "snapshots update by client access" on public.client_financial_snapshots;
drop policy if exists "snapshots delete by client access" on public.client_financial_snapshots;
drop policy if exists "snapshots insert by client access" on public.client_financial_snapshots;
-- full_schema alias names (if ever applied under shorter labels)
drop policy if exists "snapshots update" on public.client_financial_snapshots;
drop policy if exists "snapshots delete" on public.client_financial_snapshots;
drop policy if exists "snapshots insert" on public.client_financial_snapshots;

create policy "snapshots insert by writer"
  on public.client_financial_snapshots for insert
  to authenticated
  with check (public.is_client_writer(auth.uid(), client_id));

create policy "snapshots update by writer"
  on public.client_financial_snapshots for update
  to authenticated
  using (public.is_client_writer(auth.uid(), client_id))
  with check (public.is_client_writer(auth.uid(), client_id));

-- No DELETE policy → append-only deletes for the authenticated role.
comment on table public.client_financial_snapshots is
  'Period financial snapshots. Writers may INSERT/UPDATE; accessors may SELECT; DELETE denied.';
