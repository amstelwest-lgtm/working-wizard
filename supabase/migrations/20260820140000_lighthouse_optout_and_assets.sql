-- ============================================================================
-- Milōn Lighthouse — opt-out plumbing, booking-link wiring, asset fallbacks.
--
-- 1. Every lead gets a stable opt-out token so cold emails can carry a real
--    unsubscribe link and an RFC 8058 one-click List-Unsubscribe header.
-- 2. Sequence steps gain an `asset_fallback` so a placeholder primary asset
--    degrades to a second slot before degrading to "no link at all".
-- 3. Assets gain `used_in` so slots used outside the 5-step sequence (reply
--    handling, booking) stop looking orphaned in the console.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Opt-out state on the lead ────────────────────────────────────────────
ALTER TABLE public.milon_ops_leads
  ADD COLUMN IF NOT EXISTS optout_token text DEFAULT encode(gen_random_bytes(12), 'hex'),
  ADD COLUMN IF NOT EXISTS optout_at timestamptz,
  ADD COLUMN IF NOT EXISTS optout_source text;

UPDATE public.milon_ops_leads
SET optout_token = encode(gen_random_bytes(12), 'hex')
WHERE optout_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS milon_ops_leads_optout_token_idx
  ON public.milon_ops_leads (optout_token) WHERE optout_token IS NOT NULL;

-- ── 2. Asset usage outside the numbered sequence steps ──────────────────────
ALTER TABLE public.lighthouse_assets
  ADD COLUMN IF NOT EXISTS used_in text;

-- ── 3. Rewrite the playbooks with fallback assets ───────────────────────────
-- Primary asset is the ideal collateral; fallback is what the drafter may link
-- when the primary is still a placeholder. Only when both are unready does the
-- drafter fall back to describing the point in a sentence with no link.
UPDATE public.lighthouse_sequences
SET steps = '[
  {"step":1,"day":0,"angle":"observation","goal":"Open with one specific, true observation about their business and a single soft CTA.","max_words":90,"cta":"reply_interest","asset":null,"asset_fallback":null},
  {"step":2,"day":3,"angle":"value","goal":"Give a free, useful insight (what their numbers likely say) — no pitch.","max_words":80,"cta":"watch_60s","asset":"video_teaser_60s","asset_fallback":"demo_sandbox"},
  {"step":3,"day":7,"angle":"proof","goal":"Short, honest example of what changed for a similar SA business.","max_words":80,"cta":"read_case","asset":"case_study_first_client","asset_fallback":"one_pager_owner"},
  {"step":4,"day":12,"angle":"pain_reframe","goal":"Reframe the cost of not knowing runway; offer the free trial link directly.","max_words":80,"cta":"start_trial","asset":"video_demo_3min","asset_fallback":null},
  {"step":5,"day":18,"angle":"breakup","goal":"Honest close. Leave the trial link and permission to say no.","max_words":50,"cta":"start_trial","asset":null,"asset_fallback":null}
]'::jsonb,
    updated_at = now()
WHERE key = 'owner_v1';

UPDATE public.lighthouse_sequences
SET steps = '[
  {"step":1,"day":0,"angle":"observation","goal":"Lead with the practice problem: advisory work that does not scale across a client book.","max_words":90,"cta":"reply_interest","asset":null,"asset_fallback":null},
  {"step":2,"day":3,"angle":"value","goal":"Show the portfolio triage view — which clients need attention this month.","max_words":80,"cta":"watch_walkthrough","asset":"video_accountant_walkthrough","asset_fallback":"demo_sandbox"},
  {"step":3,"day":7,"angle":"proof","goal":"Practice economics: time per client report before vs after.","max_words":80,"cta":"read_case","asset":"one_pager_accountant","asset_fallback":"case_study_first_client"},
  {"step":4,"day":12,"angle":"pain_reframe","goal":"Retention/limited-pilot angle, then the free trial link.","max_words":80,"cta":"start_trial","asset":"video_demo_3min","asset_fallback":null},
  {"step":5,"day":18,"angle":"breakup","goal":"Honest close with the pilot link and a clean opt-out.","max_words":50,"cta":"start_trial","asset":null,"asset_fallback":null}
]'::jsonb,
    updated_at = now()
WHERE key = 'accountant_v1';

-- ── 4. Point the written assets at the pages that now exist ─────────────────
-- Status stays `in_progress`, not `ready`: the pages are live but unlinked
-- until the owner has read them and flipped the switch, so no email can point
-- at copy the founder has not signed off.
UPDATE public.lighthouse_assets
SET url = '/for-owners', status = 'in_progress', used_in = 'sequence step 3 fallback (owner)', updated_at = now()
WHERE key = 'one_pager_owner' AND (url IS NULL OR url = '');

UPDATE public.lighthouse_assets
SET url = '/for-accountants', status = 'in_progress', used_in = 'sequence step 3 (accountant)', updated_at = now()
WHERE key = 'one_pager_accountant' AND (url IS NULL OR url = '');

UPDATE public.lighthouse_assets
SET url = '/faq', status = 'in_progress', used_in = 'reply drafter — objection handling', updated_at = now()
WHERE key = 'faq_objections' AND (url IS NULL OR url = '');

UPDATE public.lighthouse_assets
SET used_in = 'sequence step 2 fallback (both personas)', updated_at = now()
WHERE key = 'demo_sandbox';

UPDATE public.lighthouse_assets
SET used_in = 'reply drafter — meeting proposals; mirrors Settings booking link', updated_at = now()
WHERE key = 'booking_link';

UPDATE public.lighthouse_assets SET used_in = 'sequence step 2 (owner)', updated_at = now()
WHERE key = 'video_teaser_60s';
UPDATE public.lighthouse_assets SET used_in = 'sequence step 4 (both personas)', updated_at = now()
WHERE key = 'video_demo_3min';
UPDATE public.lighthouse_assets SET used_in = 'sequence step 2 (accountant)', updated_at = now()
WHERE key = 'video_accountant_walkthrough';
UPDATE public.lighthouse_assets SET used_in = 'sequence step 3 (owner), fallback for accountant', updated_at = now()
WHERE key = 'case_study_first_client';

-- ── 5. Keep the booking link in one place ───────────────────────────────────
-- The drafter reads Settings; the console also exposes a booking_link asset.
-- Seed Settings from the asset if the asset already carries a URL, so the two
-- never disagree on first load.
UPDATE public.milon_ops_settings s
SET value = s.value || jsonb_build_object('booking_url', a.url)
FROM public.lighthouse_assets a
WHERE s.key = 'lighthouse'
  AND a.key = 'booking_link'
  AND a.url IS NOT NULL
  AND a.url <> ''
  AND COALESCE(s.value->>'booking_url', '') = '';
