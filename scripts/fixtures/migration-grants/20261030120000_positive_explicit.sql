-- expect: pass
CREATE TABLE public.widget (
  id uuid PRIMARY KEY
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.widget TO authenticated, service_role;
GRANT SELECT ON TABLE public.widget TO anon;
