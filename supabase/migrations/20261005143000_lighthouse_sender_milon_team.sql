-- ============================================================================
-- Milōn Lighthouse — cold From display name → The MILŌN Team.
-- Idempotent. Does not change reply_to, auto_send, From, or Resend domains.
-- Sets sender_name to The MILŌN Team. If a camelCase senderName key is
-- present, sets that path too. Removes founder title fields
-- (sender_title / senderTitle) when they name a founder or Theo.
-- A non-founder title is left in place.
-- ============================================================================

INSERT INTO public.milon_ops_settings (key, value)
VALUES ('lighthouse', '{"sender_name":"The MILŌN Team"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

UPDATE public.milon_ops_settings AS settings
SET
  value = computed.stepped,
  updated_at = now()
FROM (
  SELECT
    key,
    CASE
      WHEN no_camel ? 'senderName'
      THEN jsonb_set(no_camel, '{senderName}', '"The MILŌN Team"'::jsonb, true)
      ELSE no_camel
    END AS stepped
  FROM (
    SELECT
      key,
      CASE
        WHEN lower(btrim(coalesce(no_title->>'senderTitle', ''))) LIKE '%founder%'
          OR (
            lower(btrim(coalesce(no_title->>'senderTitle', ''))) LIKE '%theo%'
            AND lower(btrim(coalesce(no_title->>'senderTitle', ''))) LIKE '%westhuizen%'
          )
        THEN no_title - 'senderTitle'
        ELSE no_title
      END AS no_camel
    FROM (
      SELECT
        key,
        CASE
          WHEN lower(btrim(coalesce(named->>'sender_title', ''))) LIKE '%founder%'
            OR (
              lower(btrim(coalesce(named->>'sender_title', ''))) LIKE '%theo%'
              AND lower(btrim(coalesce(named->>'sender_title', ''))) LIKE '%westhuizen%'
            )
          THEN named - 'sender_title'
          ELSE named
        END AS no_title
      FROM (
        SELECT
          key,
          jsonb_set(
            COALESCE(value, '{}'::jsonb),
            '{sender_name}',
            '"The MILŌN Team"'::jsonb,
            true
          ) AS named
        FROM public.milon_ops_settings
        WHERE key = 'lighthouse'
      ) named_rows
    ) title_rows
  ) camel_rows
) computed
WHERE settings.key = computed.key;
