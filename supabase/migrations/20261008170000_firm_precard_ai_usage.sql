-- Pre-card AI allowance. Counters are per firm. Authenticated users can
-- still update a firm, but not these columns, so a practice cannot clear
-- the allowance and generate again. Service role increments them after a
-- successful pack, client email, or Bot answer.

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS precard_pack_generations integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precard_email_drafts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precard_bot_messages integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precard_cap_applies boolean;

ALTER TABLE public.firms
  DROP CONSTRAINT IF EXISTS firms_precard_pack_generations_nonnegative,
  DROP CONSTRAINT IF EXISTS firms_precard_email_drafts_nonnegative,
  DROP CONSTRAINT IF EXISTS firms_precard_bot_messages_nonnegative;

ALTER TABLE public.firms
  ADD CONSTRAINT firms_precard_pack_generations_nonnegative CHECK (precard_pack_generations >= 0),
  ADD CONSTRAINT firms_precard_email_drafts_nonnegative CHECK (precard_email_drafts >= 0),
  ADD CONSTRAINT firms_precard_bot_messages_nonnegative CHECK (precard_bot_messages >= 0);

COMMENT ON COLUMN public.firms.precard_pack_generations IS
  'Successful advisory pack generations before a card is on file. Limit 1.';
COMMENT ON COLUMN public.firms.precard_email_drafts IS
  'Successful client-email drafts before a card is on file. Limit 1.';
COMMENT ON COLUMN public.firms.precard_bot_messages IS
  'Successful Milōn Bot answers before a card is on file. Limit 10.';
COMMENT ON COLUMN public.firms.precard_cap_applies IS
  'True when the firm has no entitling Stripe subscription. Null until billing sync. Edge reads this and does not call Stripe.';

CREATE OR REPLACE FUNCTION public.protect_precard_usage_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Service role and SQL sessions may record usage. Signed-in users may not.
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.precard_pack_generations := 0;
    NEW.precard_email_drafts := 0;
    NEW.precard_bot_messages := 0;
    NEW.precard_cap_applies := NULL;
    RETURN NEW;
  END IF;
  NEW.precard_pack_generations := OLD.precard_pack_generations;
  NEW.precard_email_drafts := OLD.precard_email_drafts;
  NEW.precard_bot_messages := OLD.precard_bot_messages;
  NEW.precard_cap_applies := OLD.precard_cap_applies;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS firms_protect_precard_usage ON public.firms;
CREATE TRIGGER firms_protect_precard_usage
  BEFORE INSERT OR UPDATE ON public.firms
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_precard_usage_columns();

CREATE OR REPLACE FUNCTION public.increment_precard_usage(p_firm_id uuid, p_kind text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_value integer;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'precard usage is service-role only';
  END IF;
  IF p_kind = 'pack' THEN
    UPDATE public.firms
      SET precard_pack_generations = precard_pack_generations + 1
      WHERE id = p_firm_id
      RETURNING precard_pack_generations INTO next_value;
  ELSIF p_kind = 'email' THEN
    UPDATE public.firms
      SET precard_email_drafts = precard_email_drafts + 1
      WHERE id = p_firm_id
      RETURNING precard_email_drafts INTO next_value;
  ELSIF p_kind = 'bot' THEN
    UPDATE public.firms
      SET precard_bot_messages = precard_bot_messages + 1
      WHERE id = p_firm_id
      RETURNING precard_bot_messages INTO next_value;
  ELSE
    RAISE EXCEPTION 'unknown precard kind';
  END IF;
  IF next_value IS NULL THEN
    RAISE EXCEPTION 'firm not found';
  END IF;
  RETURN next_value;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_precard_usage(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_precard_usage(uuid, text) TO service_role;
