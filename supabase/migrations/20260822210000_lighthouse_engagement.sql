-- ============================================================================
-- Lighthouse engagement: delivered / clicked / inbound reply.
-- Safe to re-run.
-- ============================================================================

ALTER TABLE public.lighthouse_touches
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_clicked_url text;

CREATE INDEX IF NOT EXISTS lighthouse_touches_delivered_idx
  ON public.lighthouse_touches (delivered_at DESC)
  WHERE delivered_at IS NOT NULL;

ALTER TABLE public.milon_ops_leads
  ADD COLUMN IF NOT EXISTS last_clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_clicked_url text,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

CREATE TABLE IF NOT EXISTS public.lighthouse_inbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.milon_ops_leads(id) ON DELETE CASCADE,
  provider_email_id text,
  from_email text NOT NULL,
  subject text,
  body text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lighthouse_inbound_provider_idx
  ON public.lighthouse_inbound (provider_email_id)
  WHERE provider_email_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lighthouse_inbound_lead_idx
  ON public.lighthouse_inbound (lead_id, received_at DESC);

ALTER TABLE public.lighthouse_inbound ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lighthouse_inbound deny all" ON public.lighthouse_inbound;
CREATE POLICY "lighthouse_inbound deny all" ON public.lighthouse_inbound
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

COMMENT ON TABLE public.lighthouse_inbound IS
  'Inbound replies captured from Resend email.received — feeds the reply drafter.';
