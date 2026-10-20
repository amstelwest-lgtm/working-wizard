-- expect: fail
CREATE TABLE public.widget (
  id uuid PRIMARY KEY
);

SELECT 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.widget TO authenticated, service_role';
