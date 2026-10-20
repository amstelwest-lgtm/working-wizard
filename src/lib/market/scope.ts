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
 * Firm-scoped chrome, such as the practice header. A missing or unreadable
 * market is South Africa. Never throws.
 */
export function marketForFirm(firm: { market?: unknown } | null | undefined): ResolvedMarket {
  return resolveMarket(coerceMarketSelection(firm?.market));
}
