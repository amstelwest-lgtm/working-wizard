-- expect: pass
CREATE TABLE public.widget (
  id uuid PRIMARY KEY
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.widget TO authenticated;
GRANT ALL ON TABLE public.widget TO service_role;
