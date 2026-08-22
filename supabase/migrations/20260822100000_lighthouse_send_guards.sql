-- ============================================================================
-- Lighthouse send guards: store the Resend message id so bounce/complaint
-- webhooks can find the touch, and index sent_at for the daily cap check.
-- Safe to re-run.
-- ============================================================================

ALTER TABLE public.lighthouse_touches
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS lighthouse_touches_provider_msg_idx
  ON public.lighthouse_touches (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lighthouse_touches_sent_at_idx
  ON public.lighthouse_touches (sent_at DESC)
  WHERE status = 'sent';
