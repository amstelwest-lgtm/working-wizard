/**
 * Firm-band Stripe catalog. Paying customer is the accounting firm.
 * Prices live in Stripe TEST + LIVE (Milon, Inc. acct_1UEXnwGXDN6PFbnz).
 * Resolve Checkout line items by lookup_key — never hardcode price_ IDs.
 *
 * USD list amounts below are the published catalog unit_amount values for
 * marketing display. South African firms pay in ZAR via Checkout Adaptive
 * Pricing — do not invent hardcoded rand prices.
 *
 * Watchlist clients are free and are not Stripe line items.
 * Owner Spark stays free and does not create a Checkout Session.
 */

export const STRIPE_SAAS_BUSINESS_TAX_CODE = "txcd_10103001";

export const FOUNDING_COUPON_ID = "FOUNDING50";
export const FOUNDING_PROMO_CODE = "FOUNDING";

export const FIRM_INTERVALS = ["month", "year"] as const;
export type FirmInterval = (typeof FIRM_INTERVALS)[number];

export const FIRM_BAND_IDS = [
  "starter",
  "solo",
  "small",
  "growing",
  "established",
  "larger",
  "advanced",
  "scale",
  "enterprise",
] as const;
export type FirmBandId = (typeof FIRM_BAND_IDS)[number];

/** Checkout-eligible bands (Enterprise is quotes-only). */
export const FIRM_CHECKOUT_BANDS = [
  "starter",
  "solo",
  "small",
  "growing",
  "established",
  "larger",
  "advanced",
  "scale",
] as const;
export type FirmCheckoutBand = (typeof FIRM_CHECKOUT_BANDS)[number];

export type StripePlanMarket = "za" | "us";

export type FirmBand = {
  id: FirmBandId;
  name: string;
  /** Max ACTIVE clients in this band. null = unlimited / custom. */
  clientLimit: number | null;
  /** Published USD monthly amount in cents. null = custom quote. */
  monthlyUsdCents: number | null;
  /** Published USD yearly amount in cents (annual charge, ~20% off). */
  yearlyUsdCents: number | null;
  lookup: { month: string | null; year: string | null };
  customQuote: boolean;
};

export const FIRM_BAND_CATALOG: Record<FirmBandId, FirmBand> = {
  starter: {
    id: "starter",
    name: "Starter",
    clientLimit: 3,
    monthlyUsdCents: 0,
    yearlyUsdCents: null,
    lookup: { month: "milon_starter_monthly", year: null },
    customQuote: false,
  },
  solo: {
    id: "solo",
    name: "Solo",
    clientLimit: 15,
    monthlyUsdCents: 9_900,
    yearlyUsdCents: 95_000,
    lookup: { month: "milon_solo_monthly", year: "milon_solo_yearly" },
    customQuote: false,
  },
  small: {
    id: "small",
    name: "Small",
    clientLimit: 25,
    monthlyUsdCents: 14_900,
    yearlyUsdCents: 143_000,
    lookup: { month: "milon_small_monthly", year: "milon_small_yearly" },
    customQuote: false,
  },
  growing: {
    id: "growing",
    name: "Growing",
    clientLimit: 50,
    monthlyUsdCents: 24_900,
    yearlyUsdCents: 239_000,
    lookup: { month: "milon_growing_monthly", year: "milon_growing_yearly" },
    customQuote: false,
  },
  established: {
    id: "established",
    name: "Established",
    clientLimit: 75,
    monthlyUsdCents: 34_900,
    yearlyUsdCents: 335_000,
    lookup: { month: "milon_established_monthly", year: "milon_established_yearly" },
    customQuote: false,
  },
  larger: {
    id: "larger",
    name: "Larger",
    clientLimit: 125,
    monthlyUsdCents: 49_900,
    yearlyUsdCents: 479_000,
    lookup: { month: "milon_larger_monthly", year: "milon_larger_yearly" },
    customQuote: false,
  },
  advanced: {
    id: "advanced",
    name: "Advanced",
    clientLimit: 200,
    monthlyUsdCents: 64_900,
    yearlyUsdCents: 623_000,
    lookup: { month: "milon_advanced_monthly", year: "milon_advanced_yearly" },
    customQuote: false,
  },
  scale: {
    id: "scale",
    name: "Scale",
    clientLimit: 500,
    monthlyUsdCents: 99_900,
    yearlyUsdCents: 959_000,
    lookup: { month: "milon_scale_monthly", year: "milon_scale_yearly" },
    customQuote: false,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    clientLimit: null,
    monthlyUsdCents: null,
    yearlyUsdCents: null,
    lookup: { month: null, year: null },
    customQuote: true,
  },
};

export const FIRM_BAND_TABLE: FirmBand[] = FIRM_BAND_IDS.map((id) => FIRM_BAND_CATALOG[id]);

export const ALL_FIRM_LOOKUP_KEYS: string[] = FIRM_BAND_TABLE.flatMap((band) =>
  [band.lookup.month, band.lookup.year].filter((key): key is string => Boolean(key)),
);

export function isFirmBandId(value: string): value is FirmBandId {
  return (FIRM_BAND_IDS as readonly string[]).includes(value);
}

export function isFirmCheckoutBand(value: string): value is FirmCheckoutBand {
  return (FIRM_CHECKOUT_BANDS as readonly string[]).includes(value);
}

export function isFirmInterval(value: string): value is FirmInterval {
  return (FIRM_INTERVALS as readonly string[]).includes(value);
}

export function isFoundingCode(value: string | null | undefined): boolean {
  const v = value?.trim().toUpperCase();
  return v === FOUNDING_PROMO_CODE || v === FOUNDING_COUPON_ID;
}

/**
 * FOUNDING50 / FOUNDING is monthly-only. It must not stack with the ~20%
 * annual catalog discount.
 */
export function assertFoundingMonthlyOnly(
  interval: FirmInterval,
  promo?: string | null,
): void {
  if (!isFoundingCode(promo)) return;
  if (interval === "year") {
    throw new Error(
      "FOUNDING applies to monthly prices only and cannot stack with annual billing.",
    );
  }
}

export function firmLookupKey(band: FirmCheckoutBand, interval: FirmInterval): string {
  const entry = FIRM_BAND_CATALOG[band];
  const key = interval === "year" ? entry.lookup.year : entry.lookup.month;
  if (!key) {
    throw new Error(
      `${entry.name} has no ${interval === "year" ? "annual" : "monthly"} Stripe price.`,
    );
  }
  return key;
}

export function formatUsdFromCents(cents: number): string {
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) {
    return `$${dollars.toLocaleString("en-US")}`;
  }
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function firmUsdListPrice(band: FirmBandId, interval: FirmInterval): string | null {
  const entry = FIRM_BAND_CATALOG[band];
  if (entry.customQuote) return null;
  const cents = interval === "year" ? entry.yearlyUsdCents : entry.monthlyUsdCents;
  if (cents == null) return null;
  if (cents === 0) return "Free";
  return formatUsdFromCents(cents);
}

export function firmClientLimitLabel(band: FirmBandId): string {
  const limit = FIRM_BAND_CATALOG[band].clientLimit;
  if (limit == null) return "Unlimited active clients";
  return `Up to ${limit} active clients`;
}

/** Default firm Checkout after signup: $0 Starter monthly. */
export function starterCheckoutIntent(market: StripePlanMarket = "us"): {
  plan: "starter";
  interval: "month";
  market: StripePlanMarket;
} {
  return { plan: "starter", interval: "month", market };
}

/* ── Owner Spark remains free. Legacy Orbit/Constellation names are not billed. ── */

export const STRIPE_PAID_PLANS = FIRM_CHECKOUT_BANDS;
export type StripePaidPlan = FirmCheckoutBand;

export function isStripePaidPlan(value: string): value is StripePaidPlan {
  return isFirmCheckoutBand(value);
}
