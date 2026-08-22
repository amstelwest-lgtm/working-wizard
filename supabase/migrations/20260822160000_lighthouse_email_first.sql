-- ============================================================================
-- Milōn Lighthouse — email-first sales motion.
--
-- Calendar booking is optional and off by default. The funnel's `meeting`
-- stage is an email conversation, not a booked call. Update the booking_link
-- asset copy so the console does not imply Google Appointments are required.
-- ============================================================================

UPDATE public.lighthouse_assets
SET
  title = 'Calendar booking link (optional)',
  purpose = 'Not required. Leave blank — replies stay on email. Only add a Cal.com / Google Appointments URL if you later want live calls.',
  used_in = 'optional — reply drafter call intent only; unused by the 5-touch email sequence',
  updated_at = now()
WHERE key = 'booking_link';
