GRANT EXECUTE ON FUNCTION public.is_firm_member(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_client_access(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;