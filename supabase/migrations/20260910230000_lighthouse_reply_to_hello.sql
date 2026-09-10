-- ============================================================================
-- Milōn Lighthouse — Reply-To → hello@milonfinance.com.
-- Idempotent: safe to re-run. Does not touch From / RESEND_FROM_EMAIL.
-- Remaps missing, empty, any *@milon.co.za, and team@milonfinance.com.
-- ============================================================================

INSERT INTO public.milon_ops_settings (key, value)
VALUES ('lighthouse', '{"reply_to":"hello@milonfinance.com"}'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = CASE
  WHEN milon_ops_settings.value->>'reply_to' IS NULL
    OR btrim(COALESCE(milon_ops_settings.value->>'reply_to', '')) = ''
    OR lower(split_part(btrim(COALESCE(milon_ops_settings.value->>'reply_to', '')), '@', 2)) = 'milon.co.za'
    OR lower(btrim(milon_ops_settings.value->>'reply_to')) = 'team@milonfinance.com'
  THEN jsonb_set(
    COALESCE(milon_ops_settings.value, '{}'::jsonb),
    '{reply_to}',
    '"hello@milonfinance.com"'
  )
  ELSE milon_ops_settings.value
END,
    updated_at = now();
