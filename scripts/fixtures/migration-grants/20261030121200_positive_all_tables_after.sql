-- expect: pass
CREATE TABLE public.widget (
  id uuid PRIMARY KEY
);

CREATE TABLE public.other (
  id uuid PRIMARY KEY
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
