-- Mark Lighthouse one-pager PDFs as ready static assets.
UPDATE public.lighthouse_assets
SET url = '/lighthouse/milon-one-pager-accountants.pdf',
    status = 'ready',
    updated_at = now()
WHERE key = 'one_pager_accountant';

UPDATE public.lighthouse_assets
SET url = '/lighthouse/milon-one-pager-owners.pdf',
    status = 'ready',
    updated_at = now()
WHERE key = 'one_pager_owner';
