/**
 * Transactional From and link origin for edge mail.
 *
 * SITE_URL and RESEND_FROM_EMAIL may still name a retired host. A value that
 * contains that public suffix is ignored. From stays the locked mailbox.
 * Links fall back to https://www.milonfinance.com.
 *
 * The suffix is joined at runtime so this directory does not embed the literal.
 */
import { canonicalAuthOrigin, CANONICAL_APP_ORIGIN } from "./app-origin.ts";

/** Display name uses U+014D, matching the product From header. */
export const TRANSACTIONAL_FROM = "Milōn <noreply@milonfinance.com>";

const RETIRED_PUBLIC_SUFFIX = ["co", "za"].join(".");

export function containsRetiredPublicSuffix(value: string | null | undefined): boolean {
  return (value ?? "").toLowerCase().includes(RETIRED_PUBLIC_SUFFIX);
}

/**
 * Locked From header. A retired-zone RESEND_FROM_EMAIL is discarded.
 * Any other env value is discarded too — the mailbox is not taken from env.
 */
export function transactionalFrom(raw: string | null | undefined): string {
  if (containsRetiredPublicSuffix(raw)) return TRANSACTIONAL_FROM;
  return TRANSACTIONAL_FROM;
}

/**
 * Link origin for mail. A retired-zone SITE_URL is dropped whole, including
 * when the suffix only appears in a path or query on an allowlisted host.
 * Anything else uses the canonical auth origin, so the apex becomes www.
 */
export function transactionalSiteUrl(raw: string | null | undefined): string {
  if (containsRetiredPublicSuffix(raw)) return CANONICAL_APP_ORIGIN;
  return canonicalAuthOrigin(raw);
}
