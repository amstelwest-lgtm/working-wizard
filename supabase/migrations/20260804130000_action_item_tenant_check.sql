-- Enforce tenant consistency on action_items: plan and owner must belong to the item's client.
create or replace function public.action_item_tenant_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select client_id from action_plans where id = new.plan_id) is distinct from new.client_id then
    raise exception 'plan does not belong to this client';
  end if;
  if new.owner_id is not null and
     (select client_id from client_employees where id = new.owner_id) is distinct from new.client_id then
    raise exception 'owner does not belong to this client';
  end if;
  return new;
end $$;

drop trigger if exists action_item_tenant_check on action_items;
create trigger action_item_tenant_check
  before insert or update of plan_id, client_id, owner_id on action_items
  for each row execute function public.action_item_tenant_check();
