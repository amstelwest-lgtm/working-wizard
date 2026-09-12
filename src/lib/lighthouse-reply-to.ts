/**
 * Lighthouse Reply-To lock.
 *
 * From stays RESEND_FROM_EMAIL (set to Milōn <team@trymilon.com> once
 * trymilon.com is verified in Resend). Replies must land on team@trymilon.com
 * — not milon.co.za and not milonfinance.com (those domains stay off Lighthouse).
 */

export const LIGHTHOUSE_REPLY_TO = "team@trymilon.com";

const RETIRED_LIGHTHOUSE_REPLY_HOSTS = new Set(["milon.co.za", "milonfinance.com"]);

/** Empty or any leftover *@milon.co.za / *@milonfinance.com address is replaced. */
export function resolveLighthouseReplyTo(settingsReplyTo: string | null | undefined): string {
  const raw = String(settingsReplyTo ?? "").trim().toLowerCase();
  if (!raw) return LIGHTHOUSE_REPLY_TO;
  const host = raw.includes("@") ? raw.slice(raw.lastIndexOf("@") + 1) : "";
  if (RETIRED_LIGHTHOUSE_REPLY_HOSTS.has(host)) return LIGHTHOUSE_REPLY_TO;
  return raw;
}
