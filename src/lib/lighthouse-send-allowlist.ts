/**
 * Hard recipient gate for Lighthouse cold sends.
 *
 * When LIGHTHOUSE_SEND_ALLOWLIST or LIGHTHOUSE_DRY_RUN is set, Send now only
 * delivers to addresses on the allowlist — everything else fails closed.
 */

/** Day-0 dry-run inboxes — used when LIGHTHOUSE_DRY_RUN is on without an explicit list. */
export const LIGHTHOUSE_DEFAULT_DRY_RUN_INBOXES = [
  "amstel.west@gmail.com",
  "team@milon.co.za",
  "team@milonfinance.com",
  "theoamstel123@gmail.com",
] as const;

function truthyEnv(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseEmailList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Active allowlist, or null when sends are not restricted. */
export function lighthouseSendAllowlist(): string[] | null {
  const explicit = parseEmailList(process.env.LIGHTHOUSE_SEND_ALLOWLIST);
  if (explicit.length) return explicit;

  if (truthyEnv(process.env.LIGHTHOUSE_DRY_RUN)) {
    return [...LIGHTHOUSE_DEFAULT_DRY_RUN_INBOXES];
  }

  return null;
}

export function lighthouseSendAllowlistEnforced(): boolean {
  return lighthouseSendAllowlist() !== null;
}

/** Throws when the recipient is outside the active allowlist. */
export function assertLighthouseSendRecipientAllowed(to: string): void {
  const allowlist = lighthouseSendAllowlist();
  if (!allowlist) return;

  const normalized = to.trim().toLowerCase();
  if (!allowlist.includes(normalized)) {
    throw new Error(
      `Send blocked — ${to} is not on the Lighthouse send allowlist. ` +
        `Day-0 dry-run only permits: ${allowlist.join(", ")}. ` +
        `Add the address to LIGHTHOUSE_SEND_ALLOWLIST or turn off LIGHTHOUSE_DRY_RUN before production sends.`,
    );
  }
}
