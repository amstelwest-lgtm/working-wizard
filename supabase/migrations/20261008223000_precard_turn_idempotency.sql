-- A dropped Bot reply can be retried. The same client turn id must not
-- consume a second pre-card allowance. The original increment function stays
-- so a deploy that lands before this migration still records usage.

CREATE TABLE IF NOT EXISTS public.precard_usage_turns (
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  turn_id text NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firm_id, turn_id)
);

ALTER TABLE public.precard_usage_turns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.precard_usage_turns FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_precard_usage_once(
  p_firm_id uuid,
  p_kind text,
  p_turn_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_value integer;
  inserted integer;
  token text;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'precard usage is service-role only';
  END IF;

  token := left(btrim(coalesce(p_turn_id, '')), 80);
  IF token = '' OR token !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    RAISE EXCEPTION 'turn id required';
  END IF;
  IF p_kind NOT IN ('pack', 'email', 'bot') THEN
    RAISE EXCEPTION 'unknown precard kind';
  END IF;

  INSERT INTO public.precard_usage_turns (firm_id, turn_id, kind)
  VALUES (p_firm_id, token, p_kind)
  ON CONFLICT (firm_id, turn_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  IF inserted = 0 THEN
    IF p_kind = 'pack' THEN
      SELECT precard_pack_generations INTO next_value FROM public.firms WHERE id = p_firm_id;
    ELSIF p_kind = 'email' THEN
      SELECT precard_email_drafts INTO next_value FROM public.firms WHERE id = p_firm_id;
    ELSE
      SELECT precard_bot_messages INTO next_value FROM public.firms WHERE id = p_firm_id;
    END IF;
    IF next_value IS NULL THEN
      RAISE EXCEPTION 'firm not found';
    END IF;
    RETURN next_value;
  END IF;

  next_value := public.increment_precard_usage(p_firm_id, p_kind);
  RETURN next_value;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_precard_usage_once(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_precard_usage_once(uuid, text, text) TO service_role;
