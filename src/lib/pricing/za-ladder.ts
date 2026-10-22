/**
 * South African firm-band helpers. Approved amounts live in the server
 * price table so a US download of this file never contains a rand price.
 *
 * Annual charge uses the same ratio as the USD band:
 * monthly cents * yearlyUsdCents / monthlyUsdCents, nearest whole rand.
 */

export {
  isZaCheckoutBand,
  parseZaLookupKey,
  zaLookupKey,
  ZA_CHECKOUT_BANDS,
  type ZaCheckoutBand,
} from "./za-lookup.ts";

/** Nearest whole rand, returned as cents. */
export function annualZarCents(
  monthlyCents: number,
  yearlyUsdCents: number,
  monthlyUsdCents: number,
): number {
  if (!Number.isFinite(monthlyCents) || monthlyCents < 0) return 0;
  if (!Number.isFinite(yearlyUsdCents) || !Number.isFinite(monthlyUsdCents) || monthlyUsdCents <= 0) {
    return 0;
  }
  return Math.round((monthlyCents * yearlyUsdCents) / monthlyUsdCents / 100) * 100;
}

/** Monthly rands divided by the band cap, rounded to the nearest rand. */
export function perClientRands(monthlyRands: number, cap: number): number {
  if (!Number.isFinite(monthlyRands) || !Number.isFinite(cap) || cap <= 0) return 0;
  return Math.round(monthlyRands / cap);
}
