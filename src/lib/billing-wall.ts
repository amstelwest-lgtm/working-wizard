/**
 * Firm billing wall. A hung read becomes a card or an error inside the
 * shell deadline. Unknown market is priced as not-ZA (USD catalog).
 * A ZA quote with no price label is an error. US quotes leave priceLabel
 * null on purpose; the USD catalog fills it in.
 */

import type { FirstFirmClient } from "@/lib/firm-client-gate";
import { settleWithin } from "@/lib/bounded-load";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";
import { FIRM_BAND_CATALOG, firmUsdListPrice, type FirmCheckoutBand, type FirmInterval } from "@/lib/stripe-plans";

export const BILLING_WALL_TRIAL_ACTION = "Start your 14-day free trial · add a card";

export const BILLING_WALL_QUOTE_ERROR =
  "We couldn't read this firm's billing market. Refresh and try again.";

export type FirmWallQuote = {
  market: "za" | "us";
  priceLabel: string | null;
};

export function firmWallDisplayPrice(input: {
  market: "za" | "us" | null;
  zaPriceLabel: string | null;
  plan: FirmCheckoutBand;
  interval: FirmInterval;
}): string | null {
  if (input.market === "za") {
    const label = input.zaPriceLabel?.trim() ?? "";
    return label || null;
  }
  const usd = firmUsdListPrice(input.plan, input.interval);
  if (!usd) return null;
  return input.interval === "year" ? `${usd}/yr` : `${usd}/mo`;
}

export function firmWallTrialDetail(priceLabel: string | null): string {
  const limit = FIRM_BAND_CATALOG.starter.clientLimit;
  const head = `Starter, up to ${limit} clients`;
  if (!priceLabel) return `${head}.`;
  return `${head}, then ${priceLabel}.`;
}

export type BillingWallResolution = {
  checking: false;
  returnClient: FirstFirmClient | null;
  entitled: boolean;
  quote: FirmWallQuote | null;
  quoteError: string;
  priceLabel: string | null;
};

export async function resolveBillingWall(input: {
  client: Promise<FirstFirmClient | null>;
  entitlement: Promise<{ entitled: boolean }>;
  quote: Promise<FirmWallQuote | null>;
  plan: FirmCheckoutBand;
  interval: FirmInterval;
  timeoutMs?: number;
}): Promise<BillingWallResolution> {
  const timeoutMs = input.timeoutMs ?? SHELL_GATE_TIMEOUT_MS;
  const [client, entitlement, quote] = await Promise.all([
    settleWithin(input.client, timeoutMs),
    settleWithin(input.entitlement, timeoutMs),
    settleWithin(input.quote, timeoutMs),
  ]);
  const nextQuote = quote.status === "value" ? quote.value : null;
  let quoteError = "";
  if (!nextQuote) quoteError = BILLING_WALL_QUOTE_ERROR;
  const priceLabel = firmWallDisplayPrice({
    market: nextQuote?.market ?? null,
    zaPriceLabel: nextQuote?.market === "za" ? nextQuote.priceLabel : null,
    plan: input.plan,
    interval: input.interval,
  });
  if (nextQuote?.market === "za" && !nextQuote.priceLabel?.trim()) {
    quoteError = quoteError || BILLING_WALL_QUOTE_ERROR;
  }
  return {
    checking: false,
    returnClient: client.status === "value" ? client.value : null,
    entitled: entitlement.status === "value" && entitlement.value.entitled === true,
    quote: nextQuote,
    quoteError,
    priceLabel,
  };
}
