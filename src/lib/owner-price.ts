/**
 * Owner-plan catalog keys. Not firm bands. The live product is Milōn Owner
 * with metadata plan=owner and no band key.
 *
 * New Checkout resolves the v2 keys. Subscriptions already on the original
 * keys keep those price ids; this module still recognizes them.
 */

export const OWNER_LOOKUP_KEYS = {
  us: { month: "milon_owner_monthly_v2", year: "milon_owner_annual_v2" },
  za: { month: "milon_za_owner_monthly_v2", year: "milon_za_owner_annual_v2" },
} as const;

/** Prices already billed. New Checkout does not request these. */
export const OWNER_LEGACY_LOOKUP_KEYS = {
  us: { month: "milon_owner_monthly", year: "milon_owner_annual" },
  za: { month: "milon_za_owner_monthly", year: "milon_za_owner_annual" },
} as const;

const ALL_OWNER_LOOKUP_KEYS = new Set<string>([
  OWNER_LOOKUP_KEYS.us.month,
  OWNER_LOOKUP_KEYS.us.year,
  OWNER_LOOKUP_KEYS.za.month,
  OWNER_LOOKUP_KEYS.za.year,
  OWNER_LEGACY_LOOKUP_KEYS.us.month,
  OWNER_LEGACY_LOOKUP_KEYS.us.year,
  OWNER_LEGACY_LOOKUP_KEYS.za.month,
  OWNER_LEGACY_LOOKUP_KEYS.za.year,
]);

export function isOwnerLookupKey(lookupKey: string | null | undefined): boolean {
  const key = lookupKey?.trim() ?? "";
  return ALL_OWNER_LOOKUP_KEYS.has(key);
}

export function isZaOwnerLookup(lookupKey: string | null | undefined): boolean {
  const key = lookupKey?.trim() ?? "";
  return (
    key === OWNER_LOOKUP_KEYS.za.month ||
    key === OWNER_LOOKUP_KEYS.za.year ||
    key === OWNER_LEGACY_LOOKUP_KEYS.za.month ||
    key === OWNER_LEGACY_LOOKUP_KEYS.za.year
  );
}

/** Product metadata plan=owner, or one of the owner lookup keys. */
export function isOwnerCatalogPrice(input: {
  lookupKey?: string | null;
  productPlan?: string | null;
}): boolean {
  if (isOwnerLookupKey(input.lookupKey)) return true;
  return (input.productPlan ?? "").trim().toLowerCase() === "owner";
}
