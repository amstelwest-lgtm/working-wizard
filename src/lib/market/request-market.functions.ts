import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { visitorMarketFromSearch } from "@/lib/market/storage";
import type { DraftMarket } from "@/lib/market/types";

const emptyDraft: DraftMarket = { country: null, regionCode: null };

/** URL `?market=` only. localStorage is client-only and must not decide the first paint. */
export const readVisitorMarketFromRequest = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const url = new URL(getRequest().url);
    return visitorMarketFromSearch(url.search);
  } catch {
    return emptyDraft;
  }
});
