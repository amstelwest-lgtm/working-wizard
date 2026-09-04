/**
 * Market for a single PDF render tree. Nested report components read this
 * instead of a module-level mutable so concurrent pdf().toBlob() calls stay isolated.
 */

import { createContext, useContext } from "react";
import { ZA_MARKET, type ResolvedMarket } from "@/lib/market";

export const PdfMarketContext = createContext<ResolvedMarket>(ZA_MARKET);

export function usePdfMarket(): ResolvedMarket {
  return useContext(PdfMarketContext);
}
