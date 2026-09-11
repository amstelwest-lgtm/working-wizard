-- ============================================================================
-- Milōn Lighthouse — accountant_oneshot_v1 (single-banger, not the 5-step drip).
-- Idempotent. Does not rewrite accountant_v1 or owner_v1.
-- ============================================================================

INSERT INTO public.lighthouse_sequences (key, name, persona, steps, active)
VALUES (
  'accountant_oneshot_v1',
  'Accountant / practice — one-shot',
  'accountant',
  '[
    {"step":1,"day":0,"angle":"advisory_banger","goal":"One-shot commercial-rollout ask. Keep the follow-up call, both teaser videos, and both one-pager URLs. Do not convert this into drip copy.","max_words":750,"cta":"call_followup","asset":"one_pager_accountant","asset_fallback":"one_pager_owner"}
  ]'::jsonb,
  true
)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    persona = EXCLUDED.persona,
    steps = EXCLUDED.steps,
    active = EXCLUDED.active,
    updated_at = now();
