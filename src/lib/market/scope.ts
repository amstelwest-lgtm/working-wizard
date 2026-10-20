import { coerceMarketSelection } from "./parse.ts";
import { resolveMarket } from "./resolve.ts";
import type { ResolvedMarket } from "./types.ts";

/**
 * Client-scoped dates. A missing or unreadable market is South Africa.
 * Never throws, including when the row itself is null.
 */
export function marketForClient(client: { market?: unknown } | null | undefined): ResolvedMarket {
  return resolveMarket(coerceMarketSelection(client?.market));
}

/**
 * Canonical effective market for a firm. Null, missing, and unreadable
 * `firms.market` values are South Africa (ZAR, en-ZA, Africa/Johannesburg).
 * Never throws, including when the firm row itself is null. Callers derive
 * currency, locale, and timezone from this instead of waiting on a stored market.
 */
export function effectiveFirmMarket(firm: { market?: unknown } | null | undefined): ResolvedMarket {
  return resolveMarket(coerceMarketSelection(firm?.market));
}

/**
 * Firm-scoped chrome, such as the practice header. Same rule as
 * `effectiveFirmMarket`.
 */
export function marketForFirm(firm: { market?: unknown } | null | undefined): ResolvedMarket {
  return effectiveFirmMarket(firm);
}
