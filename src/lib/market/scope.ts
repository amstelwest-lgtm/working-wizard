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
 * Presentation default for a firm. Null, missing, and unreadable
 * `firms.market` values are South Africa (ZAR, en-ZA, Africa/Johannesburg).
 * Never throws, including when the firm row itself is null.
 * Use this for dates, timezone, and locale formatting only.
 * ZA-only content and pricing must use the stored country
 * (`parseMarketSelection(...)?.country ?? null`) and treat null as not ZA.
 */
export function effectiveFirmMarket(firm: { market?: unknown } | null | undefined): ResolvedMarket {
  return resolveMarket(coerceMarketSelection(firm?.market));
}

/**
 * Firm-scoped dates and timezone. Same presentation rule as
 * `effectiveFirmMarket`. Not a gate for ZA-only content or prices.
 */
export function marketForFirm(firm: { market?: unknown } | null | undefined): ResolvedMarket {
  return effectiveFirmMarket(firm);
}
