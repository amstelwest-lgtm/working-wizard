import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isFirmCheckoutBand, type FirmCheckoutBand, type FirmInterval } from "@/lib/stripe-plans";

export type SignupQuotePack = {
  country: "ZA" | "US";
  starterMonthly: string;
  ownerMonthly: string;
  ownerPayLine: string;
  trialReminder: string;
};

function signupCountry(input: unknown): { country: "ZA" | "US" } {
  const raw = (input ?? {}) as { country?: unknown };
  const country =
    typeof raw.country === "string" && raw.country.trim().toUpperCase() === "ZA" ? "ZA" : "US";
  return { country };
}

/** Signup sentences for the practice country the visitor selected. */
export const readSignupQuotes = createServerFn({ method: "GET" })
  .inputValidator(signupCountry)
  .handler(async ({ data }): Promise<SignupQuotePack> => {
    const { signupQuotePack } = await import("@/lib/pricing/price-quote.server");
    return signupQuotePack(data.country);
  });

const SURFACES = ["visitor", "firm", "owner", "checkout", "signup", "wall"] as const;
type QuoteSurfaceName = (typeof SURFACES)[number];

function quoteInput(input: unknown): {
  surface: QuoteSurfaceName;
  plan: "owner" | FirmCheckoutBand;
  interval: FirmInterval;
  storedCountry: string;
  practiceCountry: string | null;
} {
  const raw = (input ?? {}) as Record<string, unknown>;
  const surface = SURFACES.includes(raw.surface as QuoteSurfaceName)
    ? (raw.surface as QuoteSurfaceName)
    : "visitor";
  const plan =
    raw.plan === "owner"
      ? "owner"
      : typeof raw.plan === "string" && isFirmCheckoutBand(raw.plan)
        ? raw.plan
        : "starter";
  const interval: FirmInterval = raw.interval === "year" ? "year" : "month";
  const storedCountry = typeof raw.storedCountry === "string" ? raw.storedCountry : "";
  const practiceCountry = typeof raw.practiceCountry === "string" ? raw.practiceCountry : null;
  return { surface, plan, interval, storedCountry, practiceCountry };
}

function requestGeo(): string {
  let country = "";
  try {
    const header = getRequest().headers.get("x-vercel-ip-country") ?? "";
    if (header.trim()) country = header.trim().toUpperCase();
  } catch {
    // No request scope (tests, build).
  }
  if (!country && process.env.NODE_ENV !== "production") {
    country = (process.env.MILON_DEV_GEO ?? "").trim().toUpperCase();
  }
  return country;
}

/**
 * Display quote. Firm, wall, and checkout ignore a URL hint: pass the stored
 * country only. Checkout charges still use the server's stored firm market.
 */
export const readPriceQuote = createServerFn({ method: "GET" })
  .inputValidator(quoteInput)
  .handler(async ({ data }) => {
    const { quotePrice, resolveQuoteMarket } = await import("@/lib/pricing/price-quote.server");
    const storedMarket = data.storedCountry.trim() ? { country: data.storedCountry } : null;
    const market = resolveQuoteMarket({
      surface: data.surface,
      geoCountry: requestGeo(),
      storedMarket,
      practiceCountry: data.practiceCountry,
    });
    return quotePrice({
      market,
      plan: data.plan,
      interval: data.interval,
      surface: data.surface,
    });
  });
