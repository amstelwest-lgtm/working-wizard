import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { marketingPackForGeo, type MarketingCopyPack } from "@/lib/geo-country";
import { visitorMarketFromSearch } from "@/lib/market/storage";
import type { DraftMarket } from "@/lib/market/types";

const EMPTY_DRAFT: DraftMarket = { country: null, regionCode: null };

function geoFromRequest(): { country: string; requested: string | null; draft: DraftMarket } {
  let country = "";
  let requested: string | null = null;
  let draft: DraftMarket = EMPTY_DRAFT;
  try {
    const request = getRequest();
    const header = request.headers.get("x-vercel-ip-country") ?? "";
    if (header.trim()) country = header.trim();
    const url = new URL(request.url);
    requested = url.searchParams.get("market");
    draft = visitorMarketFromSearch(url.search);
  } catch {
    // No request scope (tests, build). Fall through.
  }
  if (!country && process.env.NODE_ENV !== "production") {
    country = (process.env.MILON_DEV_GEO ?? "").trim();
  }
  return { country, requested, draft };
}

/**
 * Country from Vercel's edge header. Empty when the header is absent.
 * Local dev may set MILON_DEV_GEO. That fallback is ignored in production.
 * The header read stays inside the server function so the client bundle
 * does not import the server request API.
 */
export const readRequestGeoCountry = createServerFn({ method: "GET" }).handler(async () => {
  return geoFromRequest().country;
});

export type MarketingVisitor = {
  geoCountry: string;
  geoZa: boolean;
  copyPack: MarketingCopyPack;
  showSaPricing: boolean;
  /** Practice-location draft. A non-ZA edge never receives a ZA country from the URL. */
  urlDraft: DraftMarket;
};

/**
 * Marketing copy for this request. Geo wins. `?market=ZA` is ignored unless
 * the edge is ZA. `?market=US` lets a ZA visitor see the US view.
 */
export const readMarketingVisitor = createServerFn({ method: "GET" }).handler(
  async (): Promise<MarketingVisitor> => {
    const { country, requested, draft } = geoFromRequest();
    const copyPack = marketingPackForGeo(country, requested ?? draft.country);
    const urlDraft =
      country === "ZA" || draft.country !== "ZA"
        ? draft
        : EMPTY_DRAFT;
    return {
      geoCountry: country,
      geoZa: country === "ZA",
      copyPack,
      showSaPricing: copyPack === "za",
      urlDraft,
    };
  },
);
