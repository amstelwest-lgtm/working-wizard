-- Stable Stripe customer for the firm plan. Email is not the key.
-- No backfill: existing rows stay null until Checkout or the billing webhook
-- writes the id. Authenticated owners can still update a firm, but not this
-- column, so a practice cannot point billing at another customer.

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

ALTER TABLE public.firms
  DROP CONSTRAINT IF EXISTS firms_stripe_customer_id_format;

ALTER TABLE public.firms
  ADD CONSTRAINT firms_stripe_customer_id_format
  CHECK (stripe_customer_id IS NULL OR stripe_customer_id ~ '^cus_[A-Za-z0-9]+$');

CREATE UNIQUE INDEX IF NOT EXISTS firms_stripe_customer_id_uidx
  ON public.firms (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN public.firms.stripe_customer_id IS
  'Stripe customer id (cus_…) for the firm plan. Written by Checkout or the billing webhook. Not the owner Spark customer. Null until that write.';

CREATE OR REPLACE FUNCTION public.protect_firm_stripe_customer_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Service role and SQL sessions may store the customer. Signed-in users may not.
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.stripe_customer_id := NULL;
    RETURN NEW;
  END IF;
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS firms_protect_stripe_customer_id ON public.firms;
CREATE TRIGGER firms_protect_stripe_customer_id
  BEFORE INSERT OR UPDATE ON public.firms
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_firm_stripe_customer_id();
