-- Outreach sample: Northwind Advisory (Sample) / Harbor & Pine Supply Co.
--
-- Idempotent. Does NOT run on migrate. CoS/Theo apply it by hand.
-- Do not commit this as a supabase/migrations file: the source client
-- (id prefix 3cc31b6a) exists only in the live database.
--
-- Apply (Supabase SQL editor, role postgres / service, one shot):
--   paste this file and run it.
-- Or:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-outreach-sample.sql
--
-- Sign-in after it succeeds:
--   email:    alex.rivera@northwind-advisory.example
--   password: HarborSample-2026
--
-- Export the samples (logged in as Alex):
--   1. Open client "Harbor & Pine Supply Co." (is_demo = true, US / USD).
--   2. Reports studio → Financial Health Scorecard → download PDF.
--   3. Reports studio → Intervention Roadmap → download PDF.
--   4. Advisory tab → download the pack PDF (status approved).
-- Each page is stamped SAMPLE, the live QA figures are kept, and page 1
-- shows the Alex Rivera sign-off under the title.
--
-- Re-running copies the QA client's financials, cashflow, and snapshot rows
-- again and refreshes the sign-off so it stays newer than financials_updated_at.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  alex_id uuid := '0e17a001-0000-4000-8000-000000000002';
  firm_id uuid := '0e17a001-0000-4000-8000-000000000001';
  client_id uuid := '0e17a001-0000-4000-8000-000000000003';
  src_id uuid;
  src_name text;
  signed_at timestamptz;
  src_pack public.advisory_packs%ROWTYPE;
BEGIN
  SELECT c.id, c.name
    INTO src_id, src_name
  FROM public.clients c
  WHERE c.id::text LIKE '3cc31b6a%'
  ORDER BY c.financials_updated_at DESC NULLS LAST, c.created_at DESC
  LIMIT 1;

  IF src_id IS NULL THEN
    RAISE EXCEPTION 'QA US client id prefix 3cc31b6a was not found. Seed was not applied.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users u
    WHERE lower(u.email) = 'alex.rivera@northwind-advisory.example'
      AND u.id <> alex_id
  ) THEN
    RAISE EXCEPTION 'alex.rivera@northwind-advisory.example already belongs to a different user';
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    alex_id,
    'authenticated',
    'authenticated',
    'alex.rivera@northwind-advisory.example',
    crypt('HarborSample-2026', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Alex Rivera, CPA (fictional)"}'::jsonb,
    now(),
    now(),
    '', '', '', ''
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        encrypted_password = EXCLUDED.encrypted_password,
        email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
        raw_user_meta_data = EXCLUDED.raw_user_meta_data,
        updated_at = now();

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  )
  SELECT
    alex_id,
    alex_id,
    jsonb_build_object(
      'sub', alex_id::text,
      'email', 'alex.rivera@northwind-advisory.example',
      'email_verified', true
    ),
    'email',
    alex_id::text,
    now(),
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = alex_id AND i.provider = 'email'
  );

  UPDATE public.profiles
     SET full_name = 'Alex Rivera, CPA (fictional)',
         email = 'alex.rivera@northwind-advisory.example'
   WHERE id = alex_id;

  INSERT INTO public.user_roles (user_id, role)
  SELECT alex_id, r.role
  FROM (VALUES ('accountant'::public.app_role), ('firm_admin'::public.app_role)) AS r(role)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = alex_id AND ur.role = r.role
  );

  INSERT INTO public.firms (
    id, name, owner_user_id, referral_code, is_internal, market
  )
  VALUES (
    firm_id,
    'Northwind Advisory (Sample)',
    alex_id,
    'NORTHWIND-SAMPLE',
    true,
    '{"country":"US","regionCode":"NY"}'::jsonb
  )
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        owner_user_id = EXCLUDED.owner_user_id,
        is_internal = true,
        market = EXCLUDED.market;

  INSERT INTO public.firm_memberships (firm_id, user_id, role)
  SELECT firm_id, alex_id, 'owner'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.firm_memberships m WHERE m.firm_id = firm_id AND m.user_id = alex_id
  );

  INSERT INTO public.clients (
    id, name, owner_user_id, firm_id, is_demo, market, contact_email
  )
  VALUES (
    client_id,
    'Harbor & Pine Supply Co.',
    alex_id,
    firm_id,
    true,
    '{"country":"US","regionCode":"NY"}'::jsonb,
    'harbor@example.com'
  )
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        owner_user_id = EXCLUDED.owner_user_id,
        firm_id = EXCLUDED.firm_id,
        is_demo = true;

  UPDATE public.clients dst
     SET financials = src.financials,
         cashflow = src.cashflow,
         financials_updated_at = src.financials_updated_at,
         last_forecast_at = src.last_forecast_at,
         operating_profile = src.operating_profile,
         cash_runway_weeks = src.cash_runway_weeks,
         business_type = src.business_type,
         is_demo = true,
         market = CASE
           WHEN src.market->>'country' = 'US' THEN src.market
           ELSE '{"country":"US","regionCode":"NY"}'::jsonb
         END
    FROM public.clients src
   WHERE dst.id = client_id
     AND src.id = src_id;

  INSERT INTO public.client_financial_snapshots (
    client_id, period_label, period_date, financials, ratios, source, created_by
  )
  SELECT
    client_id,
    s.period_label,
    s.period_date,
    s.financials,
    s.ratios,
    'outreach_sample',
    alex_id
  FROM public.client_financial_snapshots s
  WHERE s.client_id = src_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.client_financial_snapshots d
      WHERE d.client_id = client_id
        AND d.period_date = s.period_date
        AND d.period_label = s.period_label
    );

  SELECT COALESCE(c.financials_updated_at, now()) + interval '2 minutes'
    INTO signed_at
  FROM public.clients c
  WHERE c.id = client_id;

  PERFORM set_config('request.jwt.claim.sub', alex_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', alex_id, 'role', 'authenticated')::text,
    true
  );

  INSERT INTO public.client_review_signoffs (
    client_id, scope, signed_off_by_id, signed_off_by_name, firm_name, signed_off_at
  )
  VALUES
    (client_id, 'financials', alex_id, 'Alex Rivera, CPA (fictional)', 'Northwind Advisory (Sample)', signed_at),
    (client_id, 'advisory', alex_id, 'Alex Rivera, CPA (fictional)', 'Northwind Advisory (Sample)', signed_at)
  ON CONFLICT (client_id, scope) DO UPDATE
    SET signed_off_at = EXCLUDED.signed_off_at,
        signed_off_by_id = EXCLUDED.signed_off_by_id;

  SELECT p.*
    INTO src_pack
  FROM public.advisory_packs p
  WHERE p.client_id = src_id
  ORDER BY p.version DESC
  LIMIT 1;

  IF src_pack.id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.advisory_packs WHERE client_id = client_id) THEN
      UPDATE public.advisory_packs dst
         SET status = 'approved',
             requires_review = true,
             reviewed_by = alex_id,
             reviewed_by_kind = 'accountant',
             reviewed_at = signed_at,
             period_label = src_pack.period_label,
             figures_as_of = src_pack.figures_as_of,
             content = replace(src_pack.content::text, src_name, 'Harbor & Pine Supply Co.')::jsonb,
             ai_draft = replace(src_pack.ai_draft::text, src_name, 'Harbor & Pine Supply Co.')::jsonb,
             review_note = 'Outreach sample sign-off'
       WHERE dst.id = (
         SELECT id FROM public.advisory_packs
         WHERE client_id = client_id
         ORDER BY version DESC
         LIMIT 1
       );
    ELSE
      INSERT INTO public.advisory_packs (
        client_id, version, status, requires_review, period_label, figures_as_of,
        generator, ai_draft, content, generated_by, generated_at,
        reviewed_by, reviewed_by_kind, reviewed_at, review_note
      )
      VALUES (
        client_id,
        1,
        'approved',
        true,
        src_pack.period_label,
        src_pack.figures_as_of,
        src_pack.generator,
        replace(src_pack.ai_draft::text, src_name, 'Harbor & Pine Supply Co.')::jsonb,
        replace(src_pack.content::text, src_name, 'Harbor & Pine Supply Co.')::jsonb,
        alex_id,
        signed_at,
        alex_id,
        'accountant',
        signed_at,
        'Outreach sample sign-off'
      );
    END IF;
  END IF;

  RAISE NOTICE 'Outreach sample ready. Source client %, sample client %, signed at %',
    src_id, client_id, signed_at;
END $$;
