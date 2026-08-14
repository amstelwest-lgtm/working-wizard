-- Collaborator directory for @mentions.
-- profiles RLS is "read own only", so without service-role the app cannot see
-- teammate emails. This SECURITY DEFINER RPC returns emails only for users who
-- already share access to the given client.

create or replace function public.list_note_collaborators(p_client_id uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  role_label text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_client_id is null then
    raise exception 'client id required';
  end if;

  if not public.has_client_access(v_uid, p_client_id) then
    raise exception 'No access to this client';
  end if;

  return query
  with access_users as (
    select c.owner_user_id as uid, 'Owner'::text as role_label
    from public.clients c
    where c.id = p_client_id
      and c.owner_user_id is not null

    union

    select cm.user_id,
      case
        when cm.role = 'client_owner' then 'Owner'
        else 'Team'
      end
    from public.client_memberships cm
    where cm.client_id = p_client_id

    union

    select fm.user_id, 'Accountant'::text
    from public.clients c
    join public.firm_memberships fm on fm.firm_id = c.firm_id
    where c.id = p_client_id
      and c.firm_id is not null
  ),
  ranked as (
    select
      a.uid,
      a.role_label,
      row_number() over (
        partition by a.uid
        order by case a.role_label
          when 'Owner' then 0
          when 'Accountant' then 1
          else 2
        end
      ) as rn
    from access_users a
  )
  select
    r.uid,
    nullif(trim(coalesce(p.email, '')), ''),
    nullif(trim(coalesce(p.full_name, '')), ''),
    r.role_label
  from ranked r
  left join public.profiles p on p.id = r.uid
  where r.rn = 1
    and nullif(trim(coalesce(p.email, '')), '') is not null;
end;
$$;

revoke all on function public.list_note_collaborators(uuid) from public;
grant execute on function public.list_note_collaborators(uuid) to authenticated;

comment on function public.list_note_collaborators(uuid) is
  'Returns email/name/role for users who share access to a client (for @mentions).';
