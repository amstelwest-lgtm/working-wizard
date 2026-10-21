/**
 * Two /talk price lines. Amounts are passed in already formatted.
 * This file has no currency table, so either market can import it.
 */
import { FIRM_TRIAL_CLIENT_LIMIT, FIRM_TRIAL_DAYS } from "./starter-trial-constants.ts";

export function talkPriceCopy(starterMonthly: string, ownerMonthly: string): string {
  const accountants = `Accountants: Starter, up to ${FIRM_TRIAL_CLIENT_LIMIT} clients, ${FIRM_TRIAL_DAYS}-day free trial; add a card once you've seen your first result, then ${starterMonthly}.`;
  const owners = `Business owners: ${ownerMonthly}, free when your accountant is on Milōn.`;
  return `${accountants}\n${owners}`;
}
