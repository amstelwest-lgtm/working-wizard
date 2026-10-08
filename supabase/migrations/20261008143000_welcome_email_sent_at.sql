-- One welcome email per account. The stamp is written by the service role
-- after a successful Resend send. Authenticated users can still update their
-- profile, but not these columns, so a client cannot clear the stamp and
-- receive the welcome again.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS welcome_email_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS welcome_email_last_attempt_at timestamptz;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_welcome_email_attempts_nonnegative;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_welcome_email_attempts_nonnegative
  CHECK (welcome_email_attempts >= 0);

COMMENT ON COLUMN public.profiles.welcome_email_sent_at IS
  'When the signup welcome email was accepted by Resend. Null until the one allowed send succeeds.';
COMMENT ON COLUMN public.profiles.welcome_email_attempts IS
  'Welcome send attempts. Capped in the app (3). A failure records an attempt and is not retried for 24 hours.';
COMMENT ON COLUMN public.profiles.welcome_email_last_attempt_at IS
  'Last welcome send attempt, successful or not.';

CREATE OR REPLACE FUNCTION public.protect_welcome_email_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Service role and SQL sessions may stamp the send. Signed-in users may not.
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;
  NEW.welcome_email_sent_at := OLD.welcome_email_sent_at;
  NEW.welcome_email_attempts := OLD.welcome_email_attempts;
  NEW.welcome_email_last_attempt_at := OLD.welcome_email_last_attempt_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_welcome_email ON public.profiles;
CREATE TRIGGER profiles_protect_welcome_email
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_welcome_email_columns();
