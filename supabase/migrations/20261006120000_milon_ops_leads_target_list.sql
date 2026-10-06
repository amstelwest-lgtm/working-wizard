-- ============================================================================
-- Lighthouse sales console — SA + US target list on milon_ops_leads.
--
-- Additive only. The live console keeps writing milon_ops_leads.
-- Does not copy, backfill, or migrate rows into lighthouse_firms,
-- lighthouse_contacts, lighthouse_activities, or the other Phase-1 CRM tables.
-- RLS stays deny-all for authenticated and anon (service role after the
-- ops-console gate). Safe to re-run.
-- ============================================================================

ALTER TABLE public.milon_ops_leads
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS persona text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS conversation_held boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conversation_held_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversation_held_by text,
  ADD COLUMN IF NOT EXISTS conversation_kind text;

COMMENT ON COLUMN public.milon_ops_leads.country IS
  'Target market. US, SA, or OTHER. Null until known.';

COMMENT ON COLUMN public.milon_ops_leads.phone_e164 IS
  'Normalised on write when the number is recognisable. SA numbers starting with 0 become +27. US 10-digit numbers become +1.';

COMMENT ON COLUMN public.milon_ops_leads.conversation_held IS
  'A person marked that a call or meeting actually happened. Stops the cold email cadence. Distinct from stage=meeting, which is an email thread.';

COMMENT ON COLUMN public.milon_ops_leads.conversation_held_by IS
  'Auth user id of the person who ticked Call / meeting held. Text so a non-uuid id cannot fail the update.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'milon_ops_leads_country_check'
  ) THEN
    ALTER TABLE public.milon_ops_leads
      ADD CONSTRAINT milon_ops_leads_country_check
      CHECK (country IS NULL OR country IN ('US', 'SA', 'OTHER'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'milon_ops_leads_conversation_kind_check'
  ) THEN
    ALTER TABLE public.milon_ops_leads
      ADD CONSTRAINT milon_ops_leads_conversation_kind_check
      CHECK (conversation_kind IS NULL OR conversation_kind IN ('phone', 'video', 'in_person'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS milon_ops_leads_country_idx
  ON public.milon_ops_leads (country);

-- Unique on lower(email) when that cannot collide. Duplicate emails keep a
-- plain index so this migration still applies.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'milon_ops_leads_email_lower_idx'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.milon_ops_leads
    WHERE email IS NOT NULL AND btrim(email) <> ''
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) THEN
    CREATE INDEX milon_ops_leads_email_lower_idx
      ON public.milon_ops_leads (lower(email));
  ELSE
    CREATE UNIQUE INDEX milon_ops_leads_email_lower_idx
      ON public.milon_ops_leads (lower(email))
      WHERE email IS NOT NULL AND btrim(email) <> '';
  END IF;
END $$;
