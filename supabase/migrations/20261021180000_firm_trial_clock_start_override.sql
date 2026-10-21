-- QA start for the no-plan 14-day clock. When set, the trial starts here
-- instead of max(created_at, the cutover). Null keeps the real clock.
-- No backfill. Signed-in users cannot set it. Service role and SQL can.
-- No extra privileges: the column stays on firms under the existing table privileges.

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS trial_clock_start_override timestamptz;

COMMENT ON COLUMN public.firms.trial_clock_start_override IS
  'QA-only start of the no-plan 14-day clock. Null uses max(created_at, the cutover). Signed-in users cannot set it. trial_clock_start_override is a QA-only tool: it is only ever set (by service role/SQL, with CoS approval) on AQA throwaway firms, never on real customer firms.';

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
    NEW.trial_clock_start_override := NULL;
    RETURN NEW;
  END IF;
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.billing_plan_known := OLD.billing_plan_known;
  NEW.trial_clock_start_override := OLD.trial_clock_start_override;
  RETURN NEW;
END;
$$;
