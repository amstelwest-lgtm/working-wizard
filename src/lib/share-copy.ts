/**
 * Canonical share / install copy for Milōn.
 *
 * Native share sheets, WhatsApp, email, and Open Graph tags all read from
 * here so a visitor never gets the old "31 ratios" pitch in one place and
 * the current product in another.
 */

export const SHARE_TITLE = "Milōn — a full finance function in your pocket";

export const SHARE_LINES = [
  "You already have the numbers.",
  "You just don't know what they're telling you.",
  "Milōn turns numbers into understanding.",
  "Understanding into action.",
  "Milōn. A full finance function in your pocket.",
] as const;

/** Newline-separated body for native share sheets, WhatsApp, and email. */
export const SHARE_TEXT = SHARE_LINES.join("\n");

/** Single-line body for Open Graph / meta description tags. */
export const SHARE_DESCRIPTION = SHARE_LINES.join(" ");

export function shareMessageWithUrl(url: string): string {
  return `${SHARE_TEXT}\n\n${url}`;
}
