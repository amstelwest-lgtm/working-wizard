-- expect: fail
CREATE TABLE public.widget (
  id uuid PRIMARY KEY
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.widget TO authenticated;
