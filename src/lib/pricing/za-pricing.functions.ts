import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveVisitorMarket } from "@/lib/pricing/market-resolution";
import { isFirmCheckoutBand, type FirmCheckoutBand, type FirmInterval } from "@/lib/stripe-plans";

export type FirmBillingQuote = {
  market: "za" | "us";
  /** Approved label for this firm's market. Null when the table has no row. */
  priceLabel: string | null;
};

function quoteArgs(input: unknown): { plan: FirmCheckoutBand; interval: FirmInterval } {
  const raw = (input ?? {}) as { plan?: unknown; interval?: unknown };
  const plan = typeof raw.plan === "string" && isFirmCheckoutBand(raw.plan) ? raw.plan : "starter";
  const interval: FirmInterval = raw.interval === "year" ? "year" : "month";
  return { plan, interval };
}

/**
 * Rand sentences for a ZA edge only. Anyone else gets null, so the
 * literals stay in the server chunk. The header read stays inside this
 * handler so the client bundle does not import the server request API.
 */
export const readSaPricingCopy = createServerFn({ method: "GET" }).handler(async () => {
  let country = "";
  try {
    const header = getRequest().headers.get("x-vercel-ip-country") ?? "";
    if (header.trim()) country = header.trim();
  } catch {
    // No request scope (tests, build). Fall through.
  }
  if (!country && process.env.NODE_ENV !== "production") {
    country = (process.env.MILON_DEV_GEO ?? "").trim();
  }
  if (resolveVisitorMarket({ geoCountry: country, choiceFromThisVisit: false }) !== "za") return null;
  const { loadSaPricingCopy } = await import("@/lib/pricing/za-pricing-chunk.server");
  return loadSaPricingCopy();
});

/**
 * Price line for the signed-in firm's stored market. The URL is not an
 * argument. Both currencies come from the approved price table.
 */
export const readFirmBillingQuote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(quoteArgs)
  .handler(async ({ data, context }): Promise<FirmBillingQuote> => {
    const ctx = context as { supabase: unknown; userId: string };
    const { loadCallerFirmMarket } = await import("@/lib/firm-client-cap.server");
    const firmMarket = await loadCallerFirmMarket({
      supabase: ctx.supabase,
      userId: ctx.userId,
    });
    const { quotePrice, resolveQuoteMarket } = await import("@/lib/pricing/price-quote.server");
    const market = resolveQuoteMarket({ surface: "wall", storedMarket: firmMarket });
    const quote = quotePrice({
      market,
      plan: data.plan,
      interval: data.interval,
      surface: "wall",
    });
    return { market, priceLabel: quote?.label ?? null };
  });
