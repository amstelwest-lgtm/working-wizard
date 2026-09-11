import { createHash } from "node:crypto";

/**
 * Resend idempotency key for a Lighthouse send.
 *
 * Re-drafting the same sequence step updates the existing `lighthouse_touches`
 * row, so the touch UUID is stable. A touch-only key then 409s
 * (`invalid_idempotent_request`) when subject/body change within 24 hours.
 *
 * Hashing the exact JSON posted to POST /emails means:
 * - same payload (double-click / retry) → same key → Resend returns the original send
 * - modified draft → different key → the new body actually goes out
 */
export function lighthouseResendIdempotencyKey(touchId: string, requestBody: string): string {
  const digest = createHash("sha256").update(requestBody).digest("hex").slice(0, 32);
  return `lighthouse/${touchId}/${digest}`.slice(0, 256);
}
