/**
 * One market decision per surface. Call these functions everywhere a price,
 * gate, or signup country is chosen. Do not re-implement the order below.
 *
 * Precedence
 * 1. Anonymous visitor (landing, /auth, signup, FAQ, terms)
 *    Geo country, trimmed and uppercased: "ZA" is ZA, every other value is US.
 *    A saved dropdown choice overrides geo only when the visitor changed it
 *    on this visit (or this request's URL carries ?market=).
 *    A stale saved "US" does not override ZA geo. A non-ZA geo never accepts ZA.
 * 2. Firm billing, pricing, and gates
 *    Stored firm market only. Null, missing, or non-ZA country is not ZA.
 *    Never geo, never a URL market, never a stored currency or locale.
 *    Dates and timezone may still fall back to ZA for non-price display.
 * 3. Owner plan
 *    Stored owner or firm market, otherwise geo (same ZA rule as a visitor).
 *    When the stored market is chosen from the owner's businesses, any
 *    explicit non-ZA country wins over ZA. No explicit country stays unset
 *    so geo can decide (resolveStoredOwnerClientMarket).
 * 4. Checkout charge currency
 *    Rand only when that charge's billing country allows it:
 *    a stored ZA firm starts on rand when billing country is ZA or still
 *    unknown (Checkout collects the address) and falls back to USD when the
 *    country is known and is not ZA. Any other firm is rand only when the
 *    practice list is rand and the billing country is ZA.
 *    Geo and the requested URL market are not inputs.
 */

import type { DraftMarket } from "../market/types.ts";

export type SurfaceMarket = "za" | "us";

export type VisitorMarketInput = {
  geoCountry?: string | null;
  /** Dropdown value or ?market=. Ignored unless choiceFromThisVisit is set. */
  savedChoice?: string | null;
  /**
   * True only for a dropdown change during this visit, or for ?market= on
   * this request. A value read from localStorage is not this.
   */
  choiceFromThisVisit?: boolean;
};

function countryCode(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function choiceCode(value: string | null | undefined): "ZA" | "US" | null {
  const text = countryCode(value);
  if (text === "ZA" || text === "US") return text;
  return null;
}

/** Anonymous visitor pack. ZA geo stays ZA unless this visit explicitly chose US. */
export function resolveVisitorMarket(input: VisitorMarketInput): SurfaceMarket {
  if (countryCode(input.geoCountry) !== "ZA") return "us";
  if (input.choiceFromThisVisit && choiceCode(input.savedChoice) === "US") return "us";
  return "za";
}

/**
 * Practice-location draft for signup prices. Stale storage cannot move a ZA
 * visitor onto the dollar price. A this-visit choice can.
 */
export function resolveVisitorDraft(input: {
  geoCountry?: string | null;
  saved?: { country?: string | null; regionCode?: string | null } | null;
  choiceFromThisVisit?: boolean;
}): DraftMarket {
  const savedCountry = choiceCode(input.saved?.country);
  const market = resolveVisitorMarket({
    geoCountry: input.geoCountry,
    savedChoice: savedCountry,
    choiceFromThisVisit: Boolean(input.choiceFromThisVisit && savedCountry),
  });
  if (market === "za") {
    return { country: "ZA", regionCode: null };
  }
  const region =
    savedCountry === "US" && input.saved?.regionCode
      ? (input.saved.regionCode as DraftMarket["regionCode"])
      : null;
  return { country: "US", regionCode: region };
}

function storedCountry(firmMarket: unknown): string {
  if (!firmMarket || typeof firmMarket !== "object" || Array.isArray(firmMarket)) return "";
  const country = (firmMarket as { country?: unknown }).country;
  return typeof country === "string" ? country.trim().toUpperCase() : "";
}

/**
 * Firm pricing and gates. Null is not ZA. Currency and locale are not a market.
 */
export function resolveFirmMarket(firmMarket: unknown): SurfaceMarket {
  return storedCountry(firmMarket) === "ZA" ? "za" : "us";
}

/** "USD" or "zar" for a firm price label. Missing market is USD. */
export function resolveFirmPriceCurrency(firmMarket: unknown): "USD" | "zar" {
  return resolveFirmMarket(firmMarket) === "za" ? "zar" : "USD";
}

/**
 * Boot-timing label. Same trim and uppercase as resolveFirmMarket, so a
 * stored "za" logs as za. ZA and US are known. Anything else, including a
 * firm row that has not loaded, stays unknown so the shell can wait.
 * This is not a price. Prices use resolveFirmMarket, where unknown is US.
 */
export function resolveFirmBootMarket(firmMarket: unknown): "za" | "us" | "unknown" {
  const country = storedCountry(firmMarket);
  if (country === "ZA") return "za";
  if (country === "US") return "us";
  return "unknown";
}

/**
 * Owner plan. A stored market wins, including a stored non-ZA country.
 * No stored market: geo, trimmed and uppercased, same ZA rule as a visitor.
 */
export function resolveOwnerMarket(input: {
  storedMarket: unknown;
  geoCountry?: string | null;
}): SurfaceMarket {
  if (input.storedMarket != null) return resolveFirmMarket(input.storedMarket);
  return countryCode(input.geoCountry) === "ZA" ? "za" : "us";
}

/**
 * Stored market from the businesses an owner already has.
 * Any explicit non-ZA country wins, so one US business keeps the USD price.
 * ZA is used only when every explicit country is ZA. No explicit country
 * returns null and the caller may fall through to geo.
 */
export function resolveStoredOwnerClientMarket(
  clients: Array<{ market: unknown }>,
): unknown {
  let us: unknown = null;
  let za: unknown = null;
  for (const client of clients) {
    const market = client.market;
    if (!market || typeof market !== "object" || Array.isArray(market)) continue;
    const country = (market as { country?: unknown }).country;
    if (typeof country !== "string" || !country.trim()) continue;
    if (countryCode(country) === "ZA") {
      if (!za) za = market;
    } else if (!us) {
      us = market;
    }
  }
  if (us) return us;
  if (za) return za;
  return null;
}

/**
 * Checkout charge currency. See the module header. practiceListZar is the
 * non-ZA firm whose clients are mostly in ZA.
 */
export function resolveCheckoutPriceMarket(input: {
  storedFirmMarket: unknown;
  billingCountry?: string | null;
  practiceListZar?: boolean;
}): SurfaceMarket {
  const country = (input.billingCountry ?? "").trim().toUpperCase();
  if (resolveFirmMarket(input.storedFirmMarket) === "za") {
    if (country && country !== "ZA") return "us";
    return "za";
  }
  if (input.practiceListZar && country === "ZA") return "za";
  return "us";
}
