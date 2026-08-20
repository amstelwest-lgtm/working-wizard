-- ============================================================================
-- Milōn Lighthouse — founder lead-gen / outreach engine
-- All tables are deny-all RLS; the owner console reaches them via service role
-- after the MILON_OWNER_EMAILS check in lighthouse.functions.ts.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Extend the existing lead table into a funnel record ──────────────────
ALTER TABLE public.milon_ops_leads
  ADD COLUMN IF NOT EXISTS persona text NOT NULL DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'sourced',
  ADD COLUMN IF NOT EXISTS signal text,
  ADD COLUMN IF NOT EXISTS role_title text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS sequence_key text NOT NULL DEFAULT 'owner_v1',
  ADD COLUMN IF NOT EXISTS sequence_step integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_touch_on date,
  ADD COLUMN IF NOT EXISTS last_touch_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_token text,
  ADD COLUMN IF NOT EXISTS trial_clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_signed_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lost_reason text;

-- Older rows used a narrow status CHECK; the funnel lives in `stage` now.
ALTER TABLE public.milon_ops_leads
  DROP CONSTRAINT IF EXISTS milon_ops_leads_status_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'milon_ops_leads_stage_check'
  ) THEN
    ALTER TABLE public.milon_ops_leads
      ADD CONSTRAINT milon_ops_leads_stage_check CHECK (stage IN (
        'sourced', 'researched', 'contacted', 'replied',
        'meeting', 'trial', 'activated', 'won', 'lost', 'nurture'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'milon_ops_leads_persona_check'
  ) THEN
    ALTER TABLE public.milon_ops_leads
      ADD CONSTRAINT milon_ops_leads_persona_check
      CHECK (persona IN ('owner', 'accountant'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS milon_ops_leads_trial_token_idx
  ON public.milon_ops_leads (trial_token) WHERE trial_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS milon_ops_leads_stage_idx
  ON public.milon_ops_leads (stage, created_at DESC);
CREATE INDEX IF NOT EXISTS milon_ops_leads_next_touch_idx
  ON public.milon_ops_leads (next_touch_on) WHERE do_not_contact = false;

-- ── 2. Touches: one row per planned / drafted / sent message ────────────────
CREATE TABLE IF NOT EXISTS public.lighthouse_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.milon_ops_leads(id) ON DELETE CASCADE,
  step_no integer NOT NULL CHECK (step_no BETWEEN 1 AND 8),
  channel text NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'linkedin', 'call', 'whatsapp')),
  angle text,
  subject text,
  body text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sent', 'replied', 'skipped', 'failed')),
  scheduled_for date,
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS lighthouse_touches_lead_idx
  ON public.lighthouse_touches (lead_id, step_no);
CREATE INDEX IF NOT EXISTS lighthouse_touches_status_idx
  ON public.lighthouse_touches (status, scheduled_for);

COMMENT ON TABLE public.lighthouse_touches IS
  'Outreach messages per lead — AI-drafted, owner-approved, then sent via Resend.';

-- ── 3. Assets: videos / FAQs / demos, most are placeholders for now ─────────
CREATE TABLE IF NOT EXISTS public.lighthouse_assets (
  key text PRIMARY KEY,
  kind text NOT NULL DEFAULT 'video'
    CHECK (kind IN ('video', 'faq', 'demo', 'one_pager', 'case_study', 'link')),
  title text NOT NULL,
  purpose text,
  used_in_step integer,
  persona text NOT NULL DEFAULT 'both'
    CHECK (persona IN ('owner', 'accountant', 'both')),
  url text,
  status text NOT NULL DEFAULT 'placeholder'
    CHECK (status IN ('placeholder', 'in_progress', 'ready')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lighthouse_assets IS
  'Sales collateral slots. url NULL + status placeholder = still to be built.';

-- ── 4. Sequence definitions (editable playbooks) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.lighthouse_sequences (
  key text PRIMARY KEY,
  name text NOT NULL,
  persona text NOT NULL DEFAULT 'owner'
    CHECK (persona IN ('owner', 'accountant')),
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lighthouse_sequences IS
  '5-touch outreach playbooks: day offsets, angle, goal, CTA, asset slot.';

ALTER TABLE public.lighthouse_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lighthouse_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lighthouse_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lighthouse_touches deny all" ON public.lighthouse_touches;
CREATE POLICY "lighthouse_touches deny all" ON public.lighthouse_touches
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "lighthouse_assets deny all" ON public.lighthouse_assets;
CREATE POLICY "lighthouse_assets deny all" ON public.lighthouse_assets
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "lighthouse_sequences deny all" ON public.lighthouse_sequences;
CREATE POLICY "lighthouse_sequences deny all" ON public.lighthouse_sequences
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

-- ── 5. Seed the two playbooks ───────────────────────────────────────────────
-- Cadence follows 2026 cold-outreach benchmarks: 5 touches over ~18 days with
-- widening gaps, each touch a distinct angle, breakup last (highest reply rate).
INSERT INTO public.lighthouse_sequences (key, name, persona, steps) VALUES
  ('owner_v1', 'SME owner — 5 touch', 'owner', '[
    {"step":1,"day":0,"angle":"observation","goal":"Open with one specific, true observation about their business and a single soft CTA.","max_words":90,"cta":"reply_interest","asset":null},
    {"step":2,"day":3,"angle":"value","goal":"Give a free, useful insight (what their numbers likely say) — no pitch.","max_words":80,"cta":"watch_60s","asset":"video_teaser_60s"},
    {"step":3,"day":7,"angle":"proof","goal":"Short, honest example of what changed for a similar SA business.","max_words":80,"cta":"read_case","asset":"case_study_first_client"},
    {"step":4,"day":12,"angle":"pain_reframe","goal":"Reframe the cost of not knowing runway; offer the free trial link directly.","max_words":80,"cta":"start_trial","asset":"video_demo_3min"},
    {"step":5,"day":18,"angle":"breakup","goal":"Honest close. Leave the trial link and permission to say no.","max_words":50,"cta":"start_trial","asset":null}
  ]'::jsonb),
  ('accountant_v1', 'Accountant / practice — 5 touch', 'accountant', '[
    {"step":1,"day":0,"angle":"observation","goal":"Lead with the practice problem: advisory work that does not scale across clients.","max_words":90,"cta":"reply_interest","asset":null},
    {"step":2,"day":3,"angle":"value","goal":"Show the portfolio triage view — which clients need attention this month.","max_words":80,"cta":"watch_walkthrough","asset":"video_accountant_walkthrough"},
    {"step":3,"day":7,"angle":"proof","goal":"Practice economics: time per client report before vs after.","max_words":80,"cta":"read_case","asset":"one_pager_accountant"},
    {"step":4,"day":12,"angle":"pain_reframe","goal":"Retention/limited-pilot angle, then the free trial link.","max_words":80,"cta":"start_trial","asset":"video_demo_3min"},
    {"step":5,"day":18,"angle":"breakup","goal":"Honest close with the pilot link and a clean opt-out.","max_words":50,"cta":"start_trial","asset":null}
  ]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── 6. Seed asset placeholders (build these later) ──────────────────────────
INSERT INTO public.lighthouse_assets (key, kind, title, purpose, used_in_step, persona) VALUES
  ('video_teaser_60s', 'video', '60-second teaser', 'One problem, one number, one promise. Hook for touch 2.', 2, 'both'),
  ('video_demo_3min', 'video', '3-minute product demo', 'Upload figures → score → next moves. Used before trial ask.', 4, 'both'),
  ('video_accountant_walkthrough', 'video', 'Practice walkthrough', 'Portfolio triage + client report in under 3 minutes.', 2, 'accountant'),
  ('case_study_first_client', 'case_study', 'First pilot story', 'Honest before/after from the first real client. No invented numbers.', 3, 'both'),
  ('one_pager_accountant', 'one_pager', 'Practice one-pager', 'PDF for partners: what Milōn does for a client book.', 3, 'accountant'),
  ('one_pager_owner', 'one_pager', 'Owner one-pager', 'PDF: what an owner gets in the first week.', 3, 'owner'),
  ('faq_objections', 'faq', 'Objection FAQ', 'Security, data, price, "my accountant already does this".', NULL, 'both'),
  ('demo_sandbox', 'demo', 'Click-through sandbox', 'Read-only demo account so prospects can look before signing up.', NULL, 'both'),
  ('booking_link', 'link', 'Meeting booking link', 'Cal.com / Google appointment URL used in replies.', NULL, 'both')
ON CONFLICT (key) DO NOTHING;

-- ── 7. Lighthouse settings defaults ─────────────────────────────────────────
INSERT INTO public.milon_ops_settings (key, value) VALUES
  ('lighthouse', '{
    "sender_name": "Theo van der Westhuizen",
    "sender_title": "Founder, Milōn",
    "trial_days": 14,
    "daily_send_cap": 25,
    "booking_url": "",
    "send_window": "Tue-Thu 07:00-09:00 SAST",
    "auto_send": false
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;
