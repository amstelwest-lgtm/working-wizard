/**
 * ZA firm-band lookup keys. Amounts stay in za-ladder.ts so a US download
 * of this parser does not ship a rand price.
 */

export const ZA_CHECKOUT_BANDS = [
  "starter",
  "solo",
  "small",
  "growing",
  "established",
  "larger",
  "advanced",
  "scale",
] as const;

export type ZaCheckoutBand = (typeof ZA_CHECKOUT_BANDS)[number];

export function isZaCheckoutBand(value: string): value is ZaCheckoutBand {
  return (ZA_CHECKOUT_BANDS as readonly string[]).includes(value);
}

/** milon_za_solo_monthly / milon_za_solo_annual */
export function zaLookupKey(band: ZaCheckoutBand, interval: "month" | "year"): string {
  return `milon_za_${band}_${interval === "year" ? "annual" : "monthly"}`;
}

const ZA_LOOKUP =
  /^milon_za_(starter|solo|small|growing|established|larger|advanced|scale)_(monthly|annual)$/;

/**
 * Firm-band keys only. Owner prices (including the v2 keys) must not become
 * a band named owner.
 */
export function parseZaLookupKey(
  lookupKey: string | null | undefined,
): { band: ZaCheckoutBand; interval: "month" | "year" } | null {
  const key = lookupKey?.trim() ?? "";
  if (key.startsWith("milon_za_owner_")) return null;
  const match = ZA_LOOKUP.exec(key);
  if (!match) return null;
  const band = match[1] ?? "";
  if (!isZaCheckoutBand(band)) return null;
  return { band, interval: match[2] === "annual" ? "year" : "month" };
}
