/**
 * USD sentences the public pricing page renders. Deno loads this file.
 * Rand copy stays in the SA pricing server chunk. This module does not
 * contain it.
 */
import { OWNER_MONTHLY_USD_LABEL } from "./owner-plan.ts";
import { FIRM_TRIAL_CARD_NOTE, FIRM_TRIAL_SENTENCE } from "./starter-trial-constants.ts";
import { firmUsdListPrice } from "./stripe-plans.ts";
import { talkPriceCopy } from "./talk-price-lines.ts";

const starterUsd = firmUsdListPrice("starter", "month");
if (!starterUsd) throw new Error("Starter has no published monthly price.");

/** Same spelling as the pricing bar: "Then $39/mo." */
export const PUBLIC_STARTER_THEN_US = `Then ${starterUsd}/mo.`;

/** Pricing-bar line under the trial sentence. USD only. */
export const PRICING_TRIAL_AFTER = `On Starter. ${FIRM_TRIAL_CARD_NOTE} ${PUBLIC_STARTER_THEN_US}`;

/** Owner row on the pricing page. USD only. */
export const PRICING_OWNER_BAR_US = `${OWNER_MONTHLY_USD_LABEL} · free when your accountant is on Milōn`;

/**
 * Two lines for /talk. Starter and the owner plan stay labelled, and the
 * amounts come from the same USD catalog the pricing page uses.
 */
export function usTalkPriceLine(): string {
  const starter = firmUsdListPrice("starter", "month");
  if (!starter) throw new Error("Starter has no published monthly price.");
  return talkPriceCopy(`${starter}/mo`, OWNER_MONTHLY_USD_LABEL);
}
