-- Last confirmed firm plan. A timed-out billing check reads this and
-- does not overwrite it. Null until a live check or an entitling webhook
-- writes it. No backfill. Signed-in users cannot set it.
-- Apply with CoS's OK before the column is read in production.

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS billing_plan_known text;

ALTER TABLE public.firms
  DROP CONSTRAINT IF EXISTS firms_billing_plan_known_value;

ALTER TABLE public.firms
  ADD CONSTRAINT firms_billing_plan_known_value
  CHECK (billing_plan_known IS NULL OR billing_plan_known IN ('entitled', 'none'));

COMMENT ON COLUMN public.firms.billing_plan_known IS
  'Last confirmed firm plan: entitled or none. Null until a live check succeeds. A timed-out check reads it and does not treat the timeout as unpaid.';

CREATE OR REPLACE FUNCTION public.protect_firm_stripe_customer_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Service role and SQL sessions may store billing. Signed-in users may not.
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.stripe_customer_id := NULL;
    NEW.billing_plan_known := NULL;
    RETURN NEW;
  END IF;
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.billing_plan_known := OLD.billing_plan_known;
  RETURN NEW;
END;
$$;
