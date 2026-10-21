/**
 * South African firm-band amounts. Display sentences live in the server
 * pricing chunk so a US download never contains them.
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
import { type ZaCheckoutBand } from "./za-lookup.ts";

/** Published monthly amount in rands (not cents). */
export const ZA_MONTHLY_RANDS: Record<ZaCheckoutBand, number> = {
  starter: 299,
  solo: 799,
  small: 1_199,
  growing: 1_999,
  established: 2_799,
  larger: 3_999,
  advanced: 5_299,
  scale: 7_999,
};

/** Stripe unit_amount. Two-decimal currency, so rands * 100. */
export const ZA_MONTHLY_CENTS: Record<ZaCheckoutBand, number> = {
  starter: 29_900,
  solo: 79_900,
  small: 119_900,
  growing: 199_900,
  established: 279_900,
  larger: 399_900,
  advanced: 529_900,
  scale: 799_900,
};

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
