-- ============================================================================
-- Milōn Lighthouse — wire locked Milōn teaser YouTube links.
--
-- Only two teasers exist (accountant + owner). Both are ready for Day-3
-- outreach and referenced from accountant_v1 and owner_v1 step 2.
-- ============================================================================

INSERT INTO public.lighthouse_assets (key, kind, title, purpose, used_in_step, persona, url, status, used_in)
VALUES
  (
    'teaser_accountant',
    'video',
    'Practice teaser (60s)',
    'Short practice-facing Milōn overview — portfolio triage and client advisory.',
    2,
    'accountant',
    'https://youtu.be/J4vJki7HcIs',
    'ready',
    'sequence step 2 (accountant); paired with teaser_owner on Day 3'
  ),
  (
    'teaser_owner',
    'video',
    'Owner teaser (60s)',
    'Short owner-facing Milōn overview — health score and cash runway.',
    2,
    'owner',
    'https://youtu.be/k3aRM4toTvU',
    'ready',
    'sequence step 2 (owner); paired with teaser_accountant on Day 3'
  )
ON CONFLICT (key) DO UPDATE SET
  kind = EXCLUDED.kind,
  title = EXCLUDED.title,
  purpose = EXCLUDED.purpose,
  used_in_step = EXCLUDED.used_in_step,
  persona = EXCLUDED.persona,
  url = EXCLUDED.url,
  status = EXCLUDED.status,
  used_in = EXCLUDED.used_in,
  updated_at = now();

-- Day-3 touch: persona-primary teaser + cross-persona fallback; step goal instructs both links.
UPDATE public.lighthouse_sequences
SET steps = '[
  {"step":1,"day":0,"angle":"observation","goal":"Open with one specific, true observation about their business and a single soft CTA.","max_words":90,"cta":"reply_interest","asset":null,"asset_fallback":null},
  {"step":2,"day":3,"angle":"value","goal":"Give a free, useful insight (what their numbers likely say) — no pitch. Gift both 60s teasers (owner + practice).","max_words":80,"cta":"watch_60s","asset":"teaser_owner","asset_fallback":"teaser_accountant"},
  {"step":3,"day":7,"angle":"proof","goal":"Short, honest example of what changed for a similar SA business.","max_words":80,"cta":"read_case","asset":"case_study_first_client","asset_fallback":"one_pager_owner"},
  {"step":4,"day":12,"angle":"pain_reframe","goal":"Reframe the cost of not knowing runway; offer the free trial link directly.","max_words":80,"cta":"start_trial","asset":"video_demo_3min","asset_fallback":null},
  {"step":5,"day":18,"angle":"breakup","goal":"Honest close. Leave the trial link and permission to say no.","max_words":50,"cta":"start_trial","asset":null,"asset_fallback":null}
]'::jsonb,
    updated_at = now()
WHERE key = 'owner_v1';

UPDATE public.lighthouse_sequences
SET steps = '[
  {"step":1,"day":0,"angle":"observation","goal":"Lead with the practice problem: advisory work that does not scale across a client book.","max_words":90,"cta":"reply_interest","asset":null,"asset_fallback":null},
  {"step":2,"day":3,"angle":"value","goal":"Show the portfolio triage view — which clients need attention this month. Gift both 60s teasers (practice + owner).","max_words":80,"cta":"watch_walkthrough","asset":"teaser_accountant","asset_fallback":"teaser_owner"},
  {"step":3,"day":7,"angle":"proof","goal":"Practice economics: time per client report before vs after.","max_words":80,"cta":"read_case","asset":"one_pager_accountant","asset_fallback":"case_study_first_client"},
  {"step":4,"day":12,"angle":"pain_reframe","goal":"Retention/limited-pilot angle, then the free trial link.","max_words":80,"cta":"start_trial","asset":"video_demo_3min","asset_fallback":null},
  {"step":5,"day":18,"angle":"breakup","goal":"Honest close with the pilot link and a clean opt-out.","max_words":50,"cta":"start_trial","asset":null,"asset_fallback":null}
]'::jsonb,
    updated_at = now()
WHERE key = 'accountant_v1';

-- Superseded placeholders — no longer linked from sequences.
UPDATE public.lighthouse_assets
SET status = 'placeholder', url = NULL, used_in = 'superseded by teaser_owner / teaser_accountant', updated_at = now()
WHERE key IN ('video_teaser_60s', 'video_accountant_walkthrough');
