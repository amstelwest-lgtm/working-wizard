-- Point locked teaser assets and sequence goals at the founder's videos.
-- Accountant: https://youtu.be/oILDudRd7Qk
-- Owner / business: https://youtu.be/EhIFIdez-1M
-- Idempotent. Does not rewrite cadence, assets keys, or one-pager URLs.

UPDATE public.lighthouse_assets
SET url = 'https://youtu.be/oILDudRd7Qk',
    updated_at = now()
WHERE key = 'teaser_accountant'
  AND url IS DISTINCT FROM 'https://youtu.be/oILDudRd7Qk';

UPDATE public.lighthouse_assets
SET url = 'https://youtu.be/EhIFIdez-1M',
    updated_at = now()
WHERE key = 'teaser_owner'
  AND url IS DISTINCT FROM 'https://youtu.be/EhIFIdez-1M';

UPDATE public.lighthouse_sequences
SET steps = replace(
      replace(steps::text, 'https://youtu.be/J4vJki7HcIs', 'https://youtu.be/oILDudRd7Qk'),
      'https://youtu.be/k3aRM4toTvU',
      'https://youtu.be/EhIFIdez-1M'
    )::jsonb,
    updated_at = now()
WHERE steps::text LIKE '%https://youtu.be/J4vJki7HcIs%'
   OR steps::text LIKE '%https://youtu.be/k3aRM4toTvU%';
