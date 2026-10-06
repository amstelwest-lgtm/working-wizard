/**
 * South African pricing copy is shown only when the edge says the visitor
 * is in ZA. Never derive this from ?market= or localStorage — the market
 * picker may change currency and region wording, not the discount.
 */
export function isSaPricingCountry(geoCountry: string | null | undefined): boolean {
  return geoCountry === "ZA";
}
