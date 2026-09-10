-- ============================================================================
-- Milōn Lighthouse — accountant_v1 sequence v2 + Reply-To lock.
-- Idempotent: safe to re-run. Does not rewrite owner_v1.
-- ============================================================================

UPDATE public.lighthouse_sequences
SET steps = '[
  {"step":1,"day":0,"angle":"observation","goal":"Lead with the practice problem: advisory work that does not scale. Soft-ask whether they work on a monthly retainer or ad hoc. No URLs.","max_words":90,"cta":"reply_interest","asset":null,"asset_fallback":null},
  {"step":2,"day":3,"angle":"value","goal":"Show the portfolio triage view — which clients need attention this month. Include both 60s teasers (practice https://youtu.be/J4vJki7HcIs and owner https://youtu.be/k3aRM4toTvU). No trial link.","max_words":100,"cta":"watch_walkthrough","asset":"teaser_accountant","asset_fallback":"teaser_owner"},
  {"step":3,"day":7,"angle":"proof","goal":"Describe the product outcome path for a practice (time and clarity across the book). Soft-ask the firm signup link. No invented case studies or named clients.","max_words":100,"cta":"reply_interest","asset":null,"asset_fallback":null},
  {"step":4,"day":12,"angle":"pain_reframe","goal":"Reframe the cost of not knowing which clients need attention. Only CTA is the firm signup / free-trial link.","max_words":100,"cta":"start_trial","asset":null,"asset_fallback":null},
  {"step":5,"day":18,"angle":"breakup","goal":"Honest close. Stop the sequence. Invite them to reply later if they want one link. No URL in the body.","max_words":60,"cta":"reply_interest","asset":null,"asset_fallback":null}
]'::jsonb,
    updated_at = now()
WHERE key = 'accountant_v1';

-- Lock lighthouse.reply_to when missing or still on hello@milon.co.za.
INSERT INTO public.milon_ops_settings (key, value)
VALUES ('lighthouse', '{"reply_to":"team@milonfinance.com"}'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = CASE
  WHEN milon_ops_settings.value->>'reply_to' IS NULL
    OR btrim(COALESCE(milon_ops_settings.value->>'reply_to', '')) = ''
    OR lower(milon_ops_settings.value->>'reply_to') = 'hello@milon.co.za'
  THEN jsonb_set(
    COALESCE(milon_ops_settings.value, '{}'::jsonb),
    '{reply_to}',
    '"team@milonfinance.com"'
  )
  ELSE milon_ops_settings.value
END,
    updated_at = now();
