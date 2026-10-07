-- Lock client_review_signoffs identity to the actor and the client's firm.
-- A partner update policy used to allow any column to change, so a signed row
-- could be rewritten to a sample practice with no trustworthy name. This
-- trigger stamps signed_off_by_name / initials from the actor's profile and
-- firm_name from the client's firm on every write. On UPDATE it rejects a
-- signer id other than the actor, a timestamp change by anyone else, and a
-- name or firm that is neither the previous value nor the derived one.
-- A re-sign by the acting partner may refresh signed_off_at; the name and
-- firm still come from the database, not from the row the client sent.

CREATE OR REPLACE FUNCTION public.review_signoff_initials(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_name IS NULL OR btrim(p_name) = '' THEN NULL
    WHEN array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1) = 1
      THEN upper(left(btrim(p_name), 2))
    ELSE upper(left((
      SELECT string_agg(left(part, 1), '')
      FROM unnest(regexp_split_to_array(btrim(p_name), '\s+')) AS part
      WHERE part <> ''
    ), 4))
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_client_review_signoff_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_name text;
  client_firm text;
  incoming_name text;
  incoming_firm text;
  previous_name text;
  previous_firm text;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Sign-off requires an authenticated user';
  END IF;

  SELECT COALESCE(
    NULLIF(btrim(p.full_name), ''),
    NULLIF(btrim(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(btrim(u.raw_user_meta_data->>'name'), ''),
    NULLIF(split_part(COALESCE(u.email, ''), '@', 1), '')
  )
  INTO actor_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = actor;

  IF actor_name IS NULL OR actor_name = '' THEN
    RAISE EXCEPTION 'Signer profile has no name';
  END IF;

  SELECT NULLIF(btrim(f.name), '')
  INTO client_firm
  FROM public.clients c
  LEFT JOIN public.firms f ON f.id = c.firm_id
  WHERE c.id = NEW.client_id;

  IF TG_OP = 'UPDATE' THEN
    incoming_name := NULLIF(btrim(NEW.signed_off_by_name), '');
    incoming_firm := NULLIF(btrim(NEW.firm_name), '');
    previous_name := NULLIF(btrim(OLD.signed_off_by_name), '');
    previous_firm := NULLIF(btrim(OLD.firm_name), '');

    IF NEW.signed_off_by_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'signed_off_by_id cannot be changed';
    END IF;

    IF NEW.signed_off_at IS DISTINCT FROM OLD.signed_off_at
       AND NEW.signed_off_by_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'signed_off_at cannot be changed';
    END IF;

    IF incoming_name IS DISTINCT FROM actor_name
       AND incoming_name IS DISTINCT FROM previous_name THEN
      RAISE EXCEPTION 'signed_off_by_name cannot be changed';
    END IF;

    IF incoming_firm IS DISTINCT FROM client_firm
       AND incoming_firm IS DISTINCT FROM previous_firm THEN
      RAISE EXCEPTION 'firm_name cannot be changed';
    END IF;
  END IF;

  NEW.signed_off_by_id := actor;
  NEW.signed_off_by_name := actor_name;
  NEW.signed_off_by_initials := public.review_signoff_initials(actor_name);
  NEW.firm_name := client_firm;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_client_review_signoff_identity ON public.client_review_signoffs;

CREATE TRIGGER enforce_client_review_signoff_identity
  BEFORE INSERT OR UPDATE ON public.client_review_signoffs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_client_review_signoff_identity();
