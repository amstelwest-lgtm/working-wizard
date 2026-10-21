-- Grace start for a failed firm subscription invoice.
-- Null until invoice.payment_failed. Cleared on invoice.paid or when the
-- subscription is active again. No backfill. Signed-in users cannot set it.
-- Apply with CoS's OK before the column is read in production.

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS billing_past_due_at timestamptz;

COMMENT ON COLUMN public.firms.billing_past_due_at IS
  'When a firm subscription invoice.payment_failed started the grace. Null when the firm is not past due. Cleared on invoice.paid or when the subscription is active. Signed-in users cannot set it.';

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
    NEW.billing_past_due_at := NULL;
    NEW.trial_clock_start_override := NULL;
    RETURN NEW;
  END IF;
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.billing_plan_known := OLD.billing_plan_known;
  NEW.billing_past_due_at := OLD.billing_past_due_at;
  NEW.trial_clock_start_override := OLD.trial_clock_start_override;
  RETURN NEW;
END;
$$;
