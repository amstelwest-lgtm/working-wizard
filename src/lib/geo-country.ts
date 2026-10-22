/**
 * Anonymous visitor pack. The decision lives in resolveVisitorMarket.
 * A URL `?market=` on this request may opt a ZA visitor into US.
 * A stored market is not an input here.
 */
import { resolveVisitorMarket, type SurfaceMarket } from "./pricing/market-resolution.ts";

export type MarketingCopyPack = SurfaceMarket;

export function isSaPricingCountry(geoCountry: string | null | undefined): boolean {
  return (
    resolveVisitorMarket({
      geoCountry,
      choiceFromThisVisit: false,
    }) === "za"
  );
}

/** Non-ZA geos stay on US. A ZA visitor may pass ?market=US on this request. */
export function marketingPackForGeo(
  geoCountry: string | null | undefined,
  requestedMarket: string | null | undefined,
): MarketingCopyPack {
  const requested = (requestedMarket ?? "").trim();
  return resolveVisitorMarket({
    geoCountry,
    savedChoice: requested || null,
    choiceFromThisVisit: requested.length > 0,
  });
}
