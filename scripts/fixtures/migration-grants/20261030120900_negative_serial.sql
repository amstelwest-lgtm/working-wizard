-- expect: fail
CREATE TABLE public.widget (
  id bigserial PRIMARY KEY
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.widget TO authenticated, service_role;
