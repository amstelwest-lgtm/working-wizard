/**
 * Lighthouse Reply-To lock.
 *
 * Replies land on hello@milonfinance.com. Empty settings, any *@milon.co.za,
 * and leftover team@ mailboxes (team@trymilon.com, team@milonfinance.com)
 * resolve here. Other *@milonfinance.com addresses are kept — that host is
 * the product inbox, not a retired domain. Cold From stays team@trymilon.com
 * (see lighthouse-from.ts); this helper does not move From to hello@.
 */

export const LIGHTHOUSE_REPLY_TO = "hello@milonfinance.com";

const RETIRED_LIGHTHOUSE_REPLY_HOSTS = new Set(["milon.co.za"]);

/** Previous reply locks. team@ is the cold From, not the inbox replies should hit. */
const RETIRED_LIGHTHOUSE_REPLY_MAILBOXES = new Set(["team@trymilon.com", "team@milonfinance.com"]);

/** Empty, *@milon.co.za, or a leftover team@ mailbox is replaced. */
export function resolveLighthouseReplyTo(settingsReplyTo: string | null | undefined): string {
  const raw = String(settingsReplyTo ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return LIGHTHOUSE_REPLY_TO;
  const host = raw.includes("@") ? raw.slice(raw.lastIndexOf("@") + 1) : "";
  if (RETIRED_LIGHTHOUSE_REPLY_HOSTS.has(host)) return LIGHTHOUSE_REPLY_TO;
  if (RETIRED_LIGHTHOUSE_REPLY_MAILBOXES.has(raw)) return LIGHTHOUSE_REPLY_TO;
  return raw;
}
