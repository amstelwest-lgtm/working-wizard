-- Self-service account deletion.
-- Cleans FK rows that block auth.users deletion, removes owned clients/firms,
-- then deletes the auth user. Callable by the signed-in user only.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- ── Break non-cascading FKs to auth.users ────────────────────────────────
  if to_regclass('public.client_note_replies') is not null then
    delete from public.client_note_replies where author_id = v_uid;
  end if;
  if to_regclass('public.client_notes') is not null then
    delete from public.client_notes where author_id = v_uid;
  end if;

  if to_regclass('public.client_review_signoff_history') is not null then
    delete from public.client_review_signoff_history where signed_off_by_id = v_uid;
  end if;
  if to_regclass('public.client_review_signoffs') is not null then
    delete from public.client_review_signoffs where signed_off_by_id = v_uid;
  end if;

  if to_regclass('public.advisory_deliveries') is not null then
    delete from public.advisory_deliveries where created_by = v_uid;
  end if;

  if to_regclass('public.financial_submissions') is not null then
    update public.financial_submissions set reviewed_by = null where reviewed_by = v_uid;
    update public.financial_submissions set submitted_by = null where submitted_by = v_uid;
  end if;

  if to_regclass('public.budget_month_actuals') is not null then
    update public.budget_month_actuals set confirmed_by = null where confirmed_by = v_uid;
  end if;

  -- Intervention / action-plan signer columns (best-effort; tables may vary)
  if to_regclass('public.intervention_signoffs') is not null then
    begin
      execute 'delete from public.intervention_signoffs where signed_off_by_id = $1' using v_uid;
    exception when undefined_column then
      null;
    end;
  end if;

  -- ── Owned business data ──────────────────────────────────────────────────
  -- Practice / SME clients owned by this user (cascades snapshots, notes, etc.)
  if to_regclass('public.clients') is not null then
    delete from public.clients where owner_user_id = v_uid;
  end if;

  -- Firm memberships first, then firms this user owns
  if to_regclass('public.firm_memberships') is not null then
    delete from public.firm_memberships where user_id = v_uid;
  end if;
  if to_regclass('public.firms') is not null then
    delete from public.firms where owner_user_id = v_uid;
  end if;

  if to_regclass('public.client_memberships') is not null then
    delete from public.client_memberships where user_id = v_uid;
  end if;

  if to_regclass('public.user_roles') is not null then
    delete from public.user_roles where user_id = v_uid;
  end if;

  if to_regclass('public.profiles') is not null then
    delete from public.profiles where id = v_uid;
  end if;

  -- ── Auth user ────────────────────────────────────────────────────────────
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Permanently deletes the calling user, their owned clients/firms, and related rows.';
