-- Chill Pepper Boutique Hotel QA client.
-- The stored 13-week forecast was copied from a seminar bank file
-- (Andre Galvao Seminar, Seminar Guest Instructor Fee). This client is a hotel.
-- The script drops those seminar and instructor lines. Every other stored
-- amount stays: rent, staff, card settlements, housekeeping, municipal.
-- It does not insert a new figure.
--
-- Does NOT run on migrate. Re-seed by hand after this lands:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-chill-pepper-hotel.sql
--
-- Client: Chill Pepper Boutique Hotel
-- id: 79c4c485-9fa7-4499-9139-e1bb7cb40649

UPDATE public.clients AS c
SET cashflow = c.cashflow || jsonb_build_object(
  'revenue', (
    SELECT coalesce(jsonb_agg(line ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(c.cashflow->'revenue', '[]'::jsonb)) WITH ORDINALITY AS row(line, ord)
    WHERE coalesce(line->>'name', '') !~* 'seminar|instructor'
  ),
  'expenses', (
    SELECT coalesce(jsonb_agg(line ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(c.cashflow->'expenses', '[]'::jsonb)) WITH ORDINALITY AS row(line, ord)
    WHERE coalesce(line->>'name', '') !~* 'seminar|instructor'
  ),
  'other', (
    SELECT coalesce(jsonb_agg(line ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(c.cashflow->'other', '[]'::jsonb)) WITH ORDINALITY AS row(line, ord)
    WHERE coalesce(line->>'name', '') !~* 'seminar|instructor'
  )
)
WHERE c.id = '79c4c485-9fa7-4499-9139-e1bb7cb40649'
  AND c.name = 'Chill Pepper Boutique Hotel'
  AND (
    c.cashflow::text ~* 'seminar'
    OR c.cashflow::text ~* 'instructor'
  );
