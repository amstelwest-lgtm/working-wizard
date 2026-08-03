
revoke execute on function public.has_role(uuid, public.app_role) from anon, authenticated, public;
revoke execute on function public.is_firm_member(uuid, uuid) from anon, authenticated, public;
revoke execute on function public.has_client_access(uuid, uuid) from anon, authenticated, public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
