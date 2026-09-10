/**
 * Lighthouse Reply-To lock.
 *
 * From stays RESEND_FROM_EMAIL (production: Milōn <team@milonfinance.com>).
 * Replies must not land on the retired milon.co.za mailbox.
 */

export const LIGHTHOUSE_REPLY_TO = "team@milonfinance.com";

/** Empty or any *@milon.co.za address (especially hello@) is replaced. */
export function resolveLighthouseReplyTo(settingsReplyTo: string | null | undefined): string {
  const raw = String(settingsReplyTo ?? "").trim().toLowerCase();
  if (!raw) return LIGHTHOUSE_REPLY_TO;
  const host = raw.includes("@") ? raw.slice(raw.lastIndexOf("@") + 1) : "";
  if (host === "milon.co.za") return LIGHTHOUSE_REPLY_TO;
  return raw;
}
