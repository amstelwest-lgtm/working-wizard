/**
 * Lighthouse cold From display name.
 *
 * Every geo signs as The MILŌN Team. The founder name and Founder title are
 * not defaults and are not kept when they are still stored on the lighthouse
 * settings row. A later custom display name (anything that is not that
 * founder identity) is left alone. The mailbox stays team@trymilon.com
 * (lighthouse-from.ts). Reply-To stays hello@milonfinance.com
 * (lighthouse-reply-to.ts).
 */

/** Wordmark spelling: MILŌN uses U+014C, matching the product mark. */
export const LIGHTHOUSE_SENDER_NAME = "The MILŌN Team";

function settingText(value: unknown): string {
  return String(value ?? "").trim();
}

/** Seeded founder display name, including a camelCase leftover. */
export function isRetiredLighthouseSenderName(value: unknown): boolean {
  const folded = settingText(value).toLowerCase();
  if (!folded) return false;
  return folded.includes("theo") && folded.includes("westhuizen");
}

/** A title that still says founder, or still names Theo. */
export function isRetiredLighthouseSenderTitle(value: unknown): boolean {
  const folded = settingText(value).toLowerCase();
  if (!folded) return false;
  if (folded.includes("founder")) return true;
  return folded.includes("theo") && folded.includes("westhuizen");
}

/**
 * Display name for the cold From header and the email footer.
 * Reads snake_case first, then a leftover camelCase `senderName`.
 * Empty and the retired founder name both become The MILŌN Team.
 */
export function resolveLighthouseSenderName(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const text = settingText(candidate);
    if (!text || isRetiredLighthouseSenderName(text)) continue;
    return text;
  }
  return LIGHTHOUSE_SENDER_NAME;
}

/**
 * Optional title under the display name. The founder title is dropped.
 * An unrelated custom title is kept.
 */
export function resolveLighthouseSenderTitle(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const text = settingText(candidate);
    if (!text || isRetiredLighthouseSenderTitle(text)) continue;
    return text;
  }
  return "";
}
