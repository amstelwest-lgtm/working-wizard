/**
 * ZA pricing copy is shown only when the edge says the visitor is in ZA.
 * A URL `?market=` or a stored market never opens that view for anyone else.
 * A ZA visitor may opt into the US view.
 */
export function isSaPricingCountry(geoCountry: string | null | undefined): boolean {
  return geoCountry === "ZA";
}

export type MarketingCopyPack = "za" | "us";

/** Non-ZA geos stay on US. ZA may pass ?market=US to see the US view. */
export function marketingPackForGeo(
  geoCountry: string | null | undefined,
  requestedMarket: string | null | undefined,
): MarketingCopyPack {
  if (!isSaPricingCountry(geoCountry)) return "us";
  return (requestedMarket ?? "").trim().toUpperCase() === "US" ? "us" : "za";
}
