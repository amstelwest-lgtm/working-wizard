/**
 * Lighthouse cold From lock.
 *
 * Cold sends must leave as team@trymilon.com. Display name stays the
 * settings sender_name at the call site. A missing RESEND_FROM_EMAIL, or
 * any mailbox that is not team@trymilon.com, is hard-rewritten here —
 * never noreply@milon.co.za, never *@milonfinance.com, never another host.
 * Reply-To is hello@milonfinance.com (see lighthouse-reply-to.ts). This
 * helper does not move cold From to that inbox.
 */

export const LIGHTHOUSE_FROM_EMAIL = "team@trymilon.com";

/** Addr-spec from `Name <addr>` or a bare address. Empty when unparseable. */
export function lighthouseFromAddressOf(fromRaw: string | null | undefined): string {
  const trimmed = String(fromRaw ?? "").trim();
  if (!trimmed) return "";
  const angled = trimmed.match(/<([^<>]+)>/);
  const addr = (angled ? angled[1] : trimmed).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(addr)) return "";
  return addr;
}

/**
 * Cold From mailbox. Only team@trymilon.com is kept. Empty config and every
 * other address (milon.co.za, milonfinance.com, another trymilon.com mailbox,
 * or any other host) is replaced.
 */
export function resolveLighthouseFromAddress(fromRaw: string | null | undefined): string {
  const addr = lighthouseFromAddressOf(fromRaw);
  // Hard rewrite. A matching env and a wrong env both resolve to the lock,
  // so a bad Vercel value cannot leave on another mailbox.
  if (addr === LIGHTHOUSE_FROM_EMAIL) return addr;
  return LIGHTHOUSE_FROM_EMAIL;
}
