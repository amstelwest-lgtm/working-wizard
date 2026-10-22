import { cardFreeTrialPriceFromQuote, firmPlanNameOnly } from "@/lib/billing-wall";
import { firmUsdListPrice } from "@/lib/stripe-plans";

export type StarterMonthlyQuote = {
  market?: string | null;
  /** Server-built ZA line. Null for a US firm. */
  priceLabel?: string | null;
};

/** Shown when the Starter quote failed or the market is not US or ZA. No amount. */
export const STARTER_PLAN_ONLY = firmPlanNameOnly("starter");

/**
 * One Starter monthly price. A ZA quote keeps the server's rand label
 * (the part before the per-client clause). A US quote uses the USD catalog.
 * A missing quote, or any other market, is the plan name. This file does
 * not contain a rand amount.
 */
export function starterMonthlyFromQuote(quote: StarterMonthlyQuote | null | undefined): string {
  const market = quote?.market;
  if (market !== "za" && market !== "us") return STARTER_PLAN_ONLY;
  const head = (quote?.priceLabel ?? "").split(" · ")[0]?.trim() ?? "";
  if (head) return head;
  if (market === "us") {
    const usd = firmUsdListPrice("starter", "month");
    return usd ? `${usd}/mo` : STARTER_PLAN_ONLY;
  }
  return STARTER_PLAN_ONLY;
}

/** Quote read for the trial card. A throw or a null quote is the plan name. */
export async function resolveStarterMonthlyLabel(
  read: () => Promise<StarterMonthlyQuote | null | undefined>,
): Promise<string> {
  try {
    return starterMonthlyFromQuote(await read());
  } catch {
    return STARTER_PLAN_ONLY;
  }
}

let inflight: Promise<string> | null = null;
let fullLineInflight: Promise<string | null> | null = null;

/**
 * Full Starter line for the practice home. Same quote and formatter as
 * the Start trial wall. A failed read is the plan name, not a dollar price.
 */
export function loadCardFreeTrialPriceLabel(): Promise<string | null> {
  if (!fullLineInflight) {
    fullLineInflight = (async () => {
      try {
        const { readFirmBillingQuote } = await import("@/lib/pricing/za-pricing.functions");
        const quote = await readFirmBillingQuote({ data: { plan: "starter", interval: "month" } });
        return cardFreeTrialPriceFromQuote(quote) || STARTER_PLAN_ONLY;
      } catch {
        fullLineInflight = null;
        return STARTER_PLAN_ONLY;
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
        const label = starterMonthlyFromQuote(quote);
        if (label === STARTER_PLAN_ONLY) inflight = null;
        return label;
      } catch {
        inflight = null;
        return STARTER_PLAN_ONLY;
      }
    })();
  }
  return inflight;
}
