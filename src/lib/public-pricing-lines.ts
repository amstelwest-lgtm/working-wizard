/**
 * USD sentences the public pricing page renders. Deno loads this file.
 * Rand copy stays in the SA pricing server chunk. This module does not
 * contain it.
 */
import { OWNER_MONTHLY_USD_LABEL } from "./owner-plan.ts";
import { FIRM_TRIAL_CARD_NOTE, FIRM_TRIAL_SENTENCE } from "./starter-trial-constants.ts";
import { firmUsdListPrice } from "./stripe-plans.ts";

const starterUsd = firmUsdListPrice("starter", "month");
if (!starterUsd) throw new Error("Starter has no published monthly price.");

/** Same spelling as the pricing bar: "Then $39/mo." */
export const PUBLIC_STARTER_THEN_US = `Then ${starterUsd}/mo.`;

/** Pricing-bar line under the trial sentence. USD only. */
export const PRICING_TRIAL_AFTER = `On Starter. ${FIRM_TRIAL_CARD_NOTE} ${PUBLIC_STARTER_THEN_US}`;

/** Owner row on the pricing page. USD only. */
export const PRICING_OWNER_BAR_US = `${OWNER_MONTHLY_USD_LABEL} · free when your accountant is on Milōn`;

/** The published US price, with the trial and card lines the pricing page shows. */
export function usTalkPriceLine(): string {
  return `${FIRM_TRIAL_SENTENCE}. ${PRICING_TRIAL_AFTER} ${PRICING_OWNER_BAR_US}.`;
}
