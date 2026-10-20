-- expect: fail
CREATE TABLE public.widget (
  id uuid PRIMARY KEY
);

GRANT ALL ON TABLE public.widget TO service_role;
