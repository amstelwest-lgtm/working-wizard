-- expect: pass
CREATE VIEW public.widget_v AS
SELECT 1 AS n;

CREATE SEQUENCE public.widget_id_seq;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.widget_v TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.widget_id_seq TO authenticated, service_role;
