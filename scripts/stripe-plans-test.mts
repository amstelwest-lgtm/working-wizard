/**
 * Stripe plan catalog amounts match published list prices.
 * Run: pnpm test:stripe-plans
 */
import { STRIPE_PLAN_CATALOG } from "../src/lib/stripe-plans";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(STRIPE_PLAN_CATALOG.orbit.za.unitAmount === 69_900, "Orbit ZAR is R699");
assert(STRIPE_PLAN_CATALOG.orbit.us.unitAmount === 3_900, "Orbit USD is $39");
assert(STRIPE_PLAN_CATALOG.constellation.za.unitAmount === 129_900, "Constellation ZAR is R1299");
assert(STRIPE_PLAN_CATALOG.constellation.us.unitAmount === 7_500, "Constellation USD is $75");
assert(STRIPE_PLAN_CATALOG.orbit.za.currency === "zar", "Orbit ZA currency");
assert(STRIPE_PLAN_CATALOG.orbit.us.currency === "usd", "Orbit US currency");

console.log("stripe-plans ok");
