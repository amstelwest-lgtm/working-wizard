/**
 * ZA price line for /talk. Built from the same server chunk the public
 * pricing page renders. Do not import this from a US client chunk.
 */
import { FIRM_TRIAL_SENTENCE } from "../starter-trial-constants.ts";
import { loadSaPricingCopy } from "./za-pricing-chunk.server.ts";

export function zaTalkPriceLine(): string {
  const copy = loadSaPricingCopy();
  return `${FIRM_TRIAL_SENTENCE}. ${copy.trialAfter} ${copy.ownerBar}.`;
}

export function zaOwnerMonthlyLabel(): string {
  return loadSaPricingCopy().ownerMonthly;
}
