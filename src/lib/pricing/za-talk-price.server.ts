/**
 * ZA price lines for /talk. Built from the same server chunk the public
 * pricing page renders. Do not import this from a US client chunk.
 */
import { talkPriceCopy } from "../talk-price-lines.ts";
import { quotePrice } from "./price-quote.server.ts";
import { loadSaPricingCopy } from "./za-pricing-chunk.server.ts";

/** Drop spaces so the amount cannot wrap after the currency mark. */
function tightLabel(label: string): string {
  return label.replace(/\s+/g, "");
}

export function zaTalkPriceLine(): string {
  const copy = loadSaPricingCopy();
  const starter =
    quotePrice({ market: "za", plan: "starter", interval: "month", surface: "signup" })?.label ?? "";
  return talkPriceCopy(tightLabel(starter), tightLabel(copy.ownerMonthly));
}

export function zaOwnerMonthlyLabel(): string {
  return tightLabel(loadSaPricingCopy().ownerMonthly);
}
