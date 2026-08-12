-- Create firm-managed clients without requiring SUPABASE_SERVICE_ROLE_KEY.
-- Mirrors ensure_own_client: SECURITY DEFINER bypasses the PostgREST INSERT
-- WITH CHECK quirk on public.clients.

create or replace function public.create_firm_client(
  p_name text,
  p_firm_id uuid,
  p_business_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_client_id uuid;
  v_ok boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Client name is required';
  end if;

  if p_firm_id is null then
    raise exception 'Firm id is required';
  end if;

  select exists (
    select 1 from public.firms f
    where f.id = p_firm_id
      and (
        f.owner_user_id = v_uid
        or public.is_firm_member(v_uid, f.id)
      )
  ) into v_ok;

  if not v_ok then
    raise exception 'Not a member of this firm';
  end if;

  insert into public.clients (name, owner_user_id, firm_id, business_type)
  values (
    trim(p_name),
    v_uid,
    p_firm_id,
    nullif(trim(coalesce(p_business_type, '')), '')
  )
  returning id into v_client_id;

  return v_client_id;
end;
$$;

revoke execute on function public.create_firm_client(text, uuid, text) from public;
grant execute on function public.create_firm_client(text, uuid, text) to authenticated;

comment on function public.create_firm_client(text, uuid, text) is
  'Inserts a practice client under a firm for the calling member. SECURITY DEFINER avoids PostgREST INSERT RLS quirks.';
