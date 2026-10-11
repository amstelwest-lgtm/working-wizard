/**
 * Owner-plan catalog keys. Not firm bands. The live product is Milōn Owner
 * with metadata plan=owner and no band key.
 */

export const OWNER_LOOKUP_KEYS = {
  us: { month: "milon_owner_monthly", year: "milon_owner_annual" },
  za: { month: "milon_za_owner_monthly", year: "milon_za_owner_annual" },
} as const;

export function isOwnerLookupKey(lookupKey: string | null | undefined): boolean {
  const key = lookupKey?.trim() ?? "";
  return (
    key === OWNER_LOOKUP_KEYS.us.month ||
    key === OWNER_LOOKUP_KEYS.us.year ||
    key === OWNER_LOOKUP_KEYS.za.month ||
    key === OWNER_LOOKUP_KEYS.za.year
  );
}

export function isZaOwnerLookup(lookupKey: string | null | undefined): boolean {
  const key = lookupKey?.trim() ?? "";
  return key === OWNER_LOOKUP_KEYS.za.month || key === OWNER_LOOKUP_KEYS.za.year;
}

/** Product metadata plan=owner, or one of the owner lookup keys. */
export function isOwnerCatalogPrice(input: {
  lookupKey?: string | null;
  productPlan?: string | null;
}): boolean {
  if (isOwnerLookupKey(input.lookupKey)) return true;
  return (input.productPlan ?? "").trim().toLowerCase() === "owner";
}
