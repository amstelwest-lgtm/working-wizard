-- expect: fail
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

CREATE TABLE public.widget (
  id uuid PRIMARY KEY
);
