/**
 * Lighthouse Reply-To lock.
 *
 * From stays RESEND_FROM_EMAIL (production: Milōn <team@milonfinance.com>).
 * Replies must land on hello@milonfinance.com — not the retired milon.co.za
 * mailbox and not team@ (From only).
 */

export const LIGHTHOUSE_REPLY_TO = "hello@milonfinance.com";

/** Empty, any *@milon.co.za, or team@milonfinance.com is replaced. */
export function resolveLighthouseReplyTo(settingsReplyTo: string | null | undefined): string {
  const raw = String(settingsReplyTo ?? "").trim().toLowerCase();
  if (!raw) return LIGHTHOUSE_REPLY_TO;
  const host = raw.includes("@") ? raw.slice(raw.lastIndexOf("@") + 1) : "";
  if (host === "milon.co.za") return LIGHTHOUSE_REPLY_TO;
  if (raw === "team@milonfinance.com") return LIGHTHOUSE_REPLY_TO;
  return raw;
}
