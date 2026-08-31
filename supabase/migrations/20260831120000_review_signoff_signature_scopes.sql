-- Per-deliverable sign-off: handwritten signature + extra tab scopes.
-- Signature lives on the stamp row so proof stays with that deliverable only.

ALTER TABLE public.client_review_signoffs
  ADD COLUMN IF NOT EXISTS signature_data TEXT;

ALTER TABLE public.client_review_signoff_history
  ADD COLUMN IF NOT EXISTS signature_data TEXT;

ALTER TABLE public.client_review_signoffs
  DROP CONSTRAINT IF EXISTS client_review_signoffs_scope_check;

ALTER TABLE public.client_review_signoffs
  ADD CONSTRAINT client_review_signoffs_scope_check
  CHECK (scope IN (
    'financials',
    'profitability',
    'cash_forecast',
    'budget',
    'action_plan',
    'advisory'
  ));

COMMENT ON COLUMN public.client_review_signoffs.scope IS
  'financials | profitability | cash_forecast | budget | action_plan | advisory — one stamp per deliverable tab';

COMMENT ON COLUMN public.client_review_signoffs.signature_data IS
  'Optional data-URL of the accountant''s drawn signature, copied onto this deliverable only.';

-- History mirror must copy the signature with each sign / retract.
CREATE OR REPLACE FUNCTION public.client_review_signoffs_history_mirror()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF tg_op = 'DELETE' THEN
    INSERT INTO public.client_review_signoff_history (
      client_id, scope, signed_off_by_id, signed_off_by_name,
      signed_off_by_initials, signed_off_by_title, firm_name, note,
      signature_data, signed_off_at, action
    ) VALUES (
      old.client_id, old.scope, coalesce(auth.uid(), old.signed_off_by_id),
      coalesce(old.signed_off_by_name, 'Unknown'),
      old.signed_off_by_initials, old.signed_off_by_title, old.firm_name, old.note,
      old.signature_data, now(), 'retract'
    );
    RETURN old;
  END IF;

  INSERT INTO public.client_review_signoff_history (
    client_id, scope, signed_off_by_id, signed_off_by_name,
    signed_off_by_initials, signed_off_by_title, firm_name, note,
    signature_data, signed_off_at, action
  ) VALUES (
    new.client_id, new.scope, new.signed_off_by_id, new.signed_off_by_name,
    new.signed_off_by_initials, new.signed_off_by_title, new.firm_name, new.note,
    new.signature_data, new.signed_off_at, 'sign'
  );
  RETURN new;
END;
$$;
