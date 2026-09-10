-- ============================================================================
-- Milōn Lighthouse — accountant_v1 sequence v3 + Reply-To lock.
-- Idempotent: safe to re-run. Does not rewrite owner_v1.
-- Cadence: day 0, 4, 9, 17, 28. Voice: The Milōn Team.
-- ============================================================================

UPDATE public.lighthouse_sequences
SET steps = '[
  {"step":1,"day":0,"angle":"observation","goal":"Capacity-ceiling observation. Soft-ask whether the book is full and they work on a monthly retainer or ad hoc. No URLs.","max_words":90,"cta":"reply_interest","asset":null,"asset_fallback":null},
  {"step":2,"day":4,"angle":"value","goal":"Show the portfolio triage view. Include both 60s teasers (practice https://youtu.be/J4vJki7HcIs and owner https://youtu.be/k3aRM4toTvU). No trial link.","max_words":100,"cta":"watch_walkthrough","asset":"teaser_accountant","asset_fallback":"teaser_owner"},
  {"step":3,"day":9,"angle":"pain_reframe","goal":"Reframe the cost of a full book that still cannot see which clients need attention. Only CTA is the free-trial link. Include the practice one-pager.","max_words":110,"cta":"start_trial","asset":"one_pager_accountant","asset_fallback":null},
  {"step":4,"day":17,"angle":"proof","goal":"Unusual-question bait that invites a short reply. No URLs and no PDF.","max_words":90,"cta":"reply_interest","asset":null,"asset_fallback":null},
  {"step":5,"day":28,"angle":"capacity","goal":"Capacity close. Include the free-trial link, both teaser videos (https://youtu.be/J4vJki7HcIs and https://youtu.be/k3aRM4toTvU), and the practice one-pager.","max_words":120,"cta":"start_trial","asset":"one_pager_accountant","asset_fallback":null}
]'::jsonb,
    updated_at = now()
WHERE key = 'accountant_v1';

-- Lock lighthouse.reply_to when missing or still on hello@milon.co.za.
-- Later remapped to hello@milonfinance.com (see 20260910230000).
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
