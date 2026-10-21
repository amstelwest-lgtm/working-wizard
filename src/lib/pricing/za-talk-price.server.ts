/**
 * ZA price lines for /talk. Built from the same server chunk the public
 * pricing page renders. Do not import this from a US client chunk.
 */
import { formatMoney } from "../market/format.ts";
import { ZA_MARKET } from "../market/resolve.ts";
import { talkPriceCopy } from "../talk-price-lines.ts";
import { loadSaPricingCopy } from "./za-pricing-chunk.server.ts";
import { ZA_MONTHLY_RANDS } from "./za-ladder.ts";

/** "R 299" becomes "R299" so the amount cannot wrap after the R. */
function tightRand(amount: number): string {
  return formatMoney(amount, ZA_MARKET).replace(/\s+/g, "");
}

function tightLabel(label: string): string {
  return label.replace(/\s+/g, "");
}

export function zaTalkPriceLine(): string {
  const copy = loadSaPricingCopy();
  return talkPriceCopy(`${tightRand(ZA_MONTHLY_RANDS.starter)}/mo`, tightLabel(copy.ownerMonthly));
}

export function zaOwnerMonthlyLabel(): string {
  return tightLabel(loadSaPricingCopy().ownerMonthly);
}
