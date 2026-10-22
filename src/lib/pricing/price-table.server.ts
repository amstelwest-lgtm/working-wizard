/**
 * Approved prices. One module. Server-only: rand amounts stay out of the
 * US client bundle. Checkout still resolves Stripe by lookup_key.
 *
 * Annual firm rand uses the existing USD ratio (nearest whole rand).
 * Owner annual uses the existing monthly × 12 × 0.8 rule. Nothing new.
 */

import { OWNER_LOOKUP_KEYS } from "@/lib/owner-price";
import { firmLookupKey, type FirmCheckoutBand, type FirmInterval } from "@/lib/stripe-plans";
import { annualZarCents } from "./za-ladder.ts";
import { zaLookupKey } from "./za-lookup.ts";

export type ApprovedPlan = "owner" | FirmCheckoutBand;
export type ApprovedCurrency = "USD" | "ZAR";

export type ApprovedPrice = {
  audience: "owner" | "accountant";
  plan: ApprovedPlan;
  interval: FirmInterval;
  currency: ApprovedCurrency;
  /** Stripe unit_amount in minor units. */
  unitAmount: number;
  lookupKey: string;
  /** Active-client cap. The owner plan has none. */
  clientLimit: number | null;
};

type FirmRow = {
  plan: FirmCheckoutBand;
  clientLimit: number;
  usdMonthlyCents: number;
  usdYearlyCents: number;
  /** Approved monthly rand, in cents. */
  zarMonthlyCents: number;
};

/** Accountant ladder. Starter is 5 clients. USD cents match the live catalog. */
const FIRM_ROWS: readonly FirmRow[] = [
  { plan: "starter", clientLimit: 5, usdMonthlyCents: 3_900, usdYearlyCents: 37_000, zarMonthlyCents: 29_900 },
  { plan: "solo", clientLimit: 15, usdMonthlyCents: 9_900, usdYearlyCents: 95_000, zarMonthlyCents: 79_900 },
  { plan: "small", clientLimit: 25, usdMonthlyCents: 14_900, usdYearlyCents: 143_000, zarMonthlyCents: 119_900 },
  { plan: "growing", clientLimit: 50, usdMonthlyCents: 24_900, usdYearlyCents: 239_000, zarMonthlyCents: 199_900 },
  { plan: "established", clientLimit: 75, usdMonthlyCents: 34_900, usdYearlyCents: 335_000, zarMonthlyCents: 279_900 },
  { plan: "larger", clientLimit: 125, usdMonthlyCents: 49_900, usdYearlyCents: 479_000, zarMonthlyCents: 399_900 },
  { plan: "advanced", clientLimit: 200, usdMonthlyCents: 64_900, usdYearlyCents: 623_000, zarMonthlyCents: 529_900 },
  { plan: "scale", clientLimit: 500, usdMonthlyCents: 99_900, usdYearlyCents: 959_000, zarMonthlyCents: 799_900 },
];

/** Same rule as ownerAnnualCents in stripe-checkout.core.ts. */
function ownerAnnualCents(monthlyCents: number): number {
  return Math.round((monthlyCents * 12 * 4) / 5);
}

const OWNER_USD_MONTHLY_CENTS = 3_900;
const OWNER_ZAR_MONTHLY_CENTS = 29_900;

function firmEntries(row: FirmRow): ApprovedPrice[] {
  const zarYearlyCents = annualZarCents(row.zarMonthlyCents, row.usdYearlyCents, row.usdMonthlyCents);
  return [
    {
      audience: "accountant",
      plan: row.plan,
      interval: "month",
      currency: "USD",
      unitAmount: row.usdMonthlyCents,
      lookupKey: firmLookupKey(row.plan, "month"),
      clientLimit: row.clientLimit,
    },
    {
      audience: "accountant",
      plan: row.plan,
      interval: "year",
      currency: "USD",
      unitAmount: row.usdYearlyCents,
      lookupKey: firmLookupKey(row.plan, "year"),
      clientLimit: row.clientLimit,
    },
    {
      audience: "accountant",
      plan: row.plan,
      interval: "month",
      currency: "ZAR",
      unitAmount: row.zarMonthlyCents,
      lookupKey: zaLookupKey(row.plan, "month"),
      clientLimit: row.clientLimit,
    },
    {
      audience: "accountant",
      plan: row.plan,
      interval: "year",
      currency: "ZAR",
      unitAmount: zarYearlyCents,
      lookupKey: zaLookupKey(row.plan, "year"),
      clientLimit: row.clientLimit,
    },
  ];
}

const OWNER_ENTRIES: ApprovedPrice[] = [
  {
    audience: "owner",
    plan: "owner",
    interval: "month",
    currency: "USD",
    unitAmount: OWNER_USD_MONTHLY_CENTS,
    lookupKey: OWNER_LOOKUP_KEYS.us.month,
    clientLimit: null,
  },
  {
    audience: "owner",
    plan: "owner",
    interval: "year",
    currency: "USD",
    unitAmount: ownerAnnualCents(OWNER_USD_MONTHLY_CENTS),
    lookupKey: OWNER_LOOKUP_KEYS.us.year,
    clientLimit: null,
  },
  {
    audience: "owner",
    plan: "owner",
    interval: "month",
    currency: "ZAR",
    unitAmount: OWNER_ZAR_MONTHLY_CENTS,
    lookupKey: OWNER_LOOKUP_KEYS.za.month,
    clientLimit: null,
  },
  {
    audience: "owner",
    plan: "owner",
    interval: "year",
    currency: "ZAR",
    unitAmount: ownerAnnualCents(OWNER_ZAR_MONTHLY_CENTS),
    lookupKey: OWNER_LOOKUP_KEYS.za.year,
    clientLimit: null,
  },
];

export const APPROVED_PRICES: readonly ApprovedPrice[] = [
  ...FIRM_ROWS.flatMap(firmEntries),
  ...OWNER_ENTRIES,
];

export function approvedPrice(
  plan: ApprovedPlan,
  interval: FirmInterval,
  currency: ApprovedCurrency,
): ApprovedPrice | null {
  return (
    APPROVED_PRICES.find(
      (row) => row.plan === plan && row.interval === interval && row.currency === currency,
    ) ?? null
  );
}

export function approvedFirmMonthlyRands(plan: FirmCheckoutBand): number {
  const row = approvedPrice(plan, "month", "ZAR");
  return row ? row.unitAmount / 100 : 0;
}
