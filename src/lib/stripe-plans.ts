/**
 * Published paid tiers for Stripe Checkout.
 * Amounts are Stripe minor units (cents). Spark stays free / no Checkout.
 */

export const STRIPE_PAID_PLANS = ["orbit", "constellation"] as const;
export type StripePaidPlan = (typeof STRIPE_PAID_PLANS)[number];
export type StripePlanMarket = "za" | "us";

type PlanPrice = {
  currency: "zar" | "usd";
  unitAmount: number;
};

export const STRIPE_PLAN_CATALOG: Record<
  StripePaidPlan,
  { name: string; za: PlanPrice; us: PlanPrice }
> = {
  orbit: {
    name: "Orbit",
    za: { currency: "zar", unitAmount: 69_900 },
    us: { currency: "usd", unitAmount: 3_900 },
  },
  constellation: {
    name: "Constellation",
    za: { currency: "zar", unitAmount: 129_900 },
    us: { currency: "usd", unitAmount: 7_500 },
  },
};

export function isStripePaidPlan(value: string): value is StripePaidPlan {
  return (STRIPE_PAID_PLANS as readonly string[]).includes(value);
}

export function stripePlanPrice(
  plan: StripePaidPlan,
  market: StripePlanMarket,
): PlanPrice & { name: string } {
  const entry = STRIPE_PLAN_CATALOG[plan];
  return { name: entry.name, ...entry[market] };
}
