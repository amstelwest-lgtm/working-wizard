/**
 * South African firm-band amounts. Display sentences live in the server
 * pricing chunk so a US download never contains them.
 *
 * Annual charge uses the same ratio as the USD band:
 * monthly cents * yearlyUsdCents / monthlyUsdCents, nearest whole rand.
 */

export const ZA_CHECKOUT_BANDS = [
  "solo",
  "small",
  "growing",
  "established",
  "larger",
  "advanced",
  "scale",
] as const;

export type ZaCheckoutBand = (typeof ZA_CHECKOUT_BANDS)[number];

/** Published monthly amount in rands (not cents). */
export const ZA_MONTHLY_RANDS: Record<ZaCheckoutBand, number> = {
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
  solo: 79_900,
  small: 119_900,
  growing: 199_900,
  established: 279_900,
  larger: 399_900,
  advanced: 529_900,
  scale: 799_900,
};

export function isZaCheckoutBand(value: string): value is ZaCheckoutBand {
  return (ZA_CHECKOUT_BANDS as readonly string[]).includes(value);
}

/** milon_za_solo_monthly / milon_za_solo_annual */
export function zaLookupKey(band: ZaCheckoutBand, interval: "month" | "year"): string {
  return `milon_za_${band}_${interval === "year" ? "annual" : "monthly"}`;
}

const ZA_LOOKUP =
  /^milon_za_(solo|small|growing|established|larger|advanced|scale)_(monthly|annual)$/;

export function parseZaLookupKey(
  lookupKey: string | null | undefined,
): { band: ZaCheckoutBand; interval: "month" | "year" } | null {
  const key = lookupKey?.trim() ?? "";
  const match = ZA_LOOKUP.exec(key);
  if (!match) return null;
  const band = match[1] ?? "";
  if (!isZaCheckoutBand(band)) return null;
  return { band, interval: match[2] === "annual" ? "year" : "month" };
}

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
