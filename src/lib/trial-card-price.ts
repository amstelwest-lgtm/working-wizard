import { cardFreeTrialPriceFromQuote } from "@/lib/billing-wall";
import { firmUsdListPrice } from "@/lib/stripe-plans";

export type StarterMonthlyQuote = {
  market?: string | null;
  /** Server-built ZA line. Null for a US firm. */
  priceLabel?: string | null;
};

/**
 * One Starter monthly price. A ZA quote keeps the server's rand label
 * (the part before the per-client clause). Every other quote uses the
 * USD catalog. This file does not contain a rand amount.
 */
export function starterMonthlyFromQuote(quote: StarterMonthlyQuote | null | undefined): string {
  if (quote?.market === "za") {
    const head = (quote.priceLabel ?? "").split(" · ")[0]?.trim() ?? "";
    return head;
  }
  const usd = firmUsdListPrice("starter", "month");
  return usd ? `${usd}/mo` : "";
}

let inflight: Promise<string> | null = null;
let fullLineInflight: Promise<string | null> | null = null;

/**
 * Full Starter line for the practice home. Same quote and formatter as
 * the Start trial wall. A failed read does not invent a dollar price.
 */
export function loadCardFreeTrialPriceLabel(): Promise<string | null> {
  if (!fullLineInflight) {
    fullLineInflight = (async () => {
      try {
        const { readFirmBillingQuote } = await import("@/lib/pricing/za-pricing.functions");
        const quote = await readFirmBillingQuote({ data: { plan: "starter", interval: "month" } });
        return cardFreeTrialPriceFromQuote(quote);
      } catch {
        fullLineInflight = null;
        return null;
      }
    })();
  }
  return fullLineInflight;
}

/** Firm market from the billing quote. One request shared by the card and the Bot. */
export function loadStarterMonthlyLabel(): Promise<string> {
  if (!inflight) {
    inflight = (async () => {
      try {
        const { readFirmBillingQuote } = await import("@/lib/pricing/za-pricing.functions");
        const quote = await readFirmBillingQuote({ data: { plan: "starter", interval: "month" } });
        return starterMonthlyFromQuote(quote);
      } catch {
        return starterMonthlyFromQuote({ market: "us", priceLabel: null });
      }
    })();
  }
  return inflight;
}
