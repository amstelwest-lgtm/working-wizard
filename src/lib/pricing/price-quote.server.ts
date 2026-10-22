/**
 * Quote and label for one surface. Rand strings are built here, at runtime,
 * so the source does not contain a rand price literal. Import from server
 * code only.
 */

import { formatUsdFromCents, type FirmCheckoutBand, type FirmInterval } from "@/lib/stripe-plans";
import {
  resolveCheckoutPriceMarket,
  resolveFirmMarket,
  resolveOwnerMarket,
  resolveVisitorMarket,
  type SurfaceMarket,
} from "@/lib/pricing/market-resolution";
import { perClientRands } from "@/lib/pricing/za-ladder";
import {
  firmSignupOwnerPayLine,
  firmSignupTrialReminder,
} from "@/lib/firm-signup-copy";
import { approvedPrice, type ApprovedCurrency, type ApprovedPlan } from "./price-table.server.ts";

export type QuoteSurface = "visitor" | "firm" | "owner" | "checkout" | "signup" | "wall";

export type PriceQuote = {
  market: SurfaceMarket;
  plan: ApprovedPlan;
  interval: FirmInterval;
  /** Major units: 39 for $39, 799 for R799. */
  amount: number;
  currency: ApprovedCurrency;
  /** Tight rand, such as R799/mo. Per-client hint only where that surface already shows one. */
  label: string;
  lookupKey: string;
};

function currencyFor(market: SurfaceMarket): ApprovedCurrency {
  return market === "za" ? "ZAR" : "USD";
}

function majorUnits(unitAmount: number): number {
  return unitAmount / 100;
}

/** R799 or $39. Built at runtime so the file has no rand price literal. */
function money(amount: number, currency: ApprovedCurrency): string {
  if (currency === "USD") return formatUsdFromCents(Math.round(amount * 100));
  const rands = Math.round(amount * 100) / 100;
  const body = Number.isInteger(rands) ? String(rands) : rands.toFixed(2);
  return `R${body}`;
}

function perClient(monthlyMajor: number, cap: number, currency: ApprovedCurrency): string {
  if (currency === "USD") return `$${Math.round(monthlyMajor / cap)}`;
  return `R${perClientRands(monthlyMajor, cap)}`;
}

function showPerClient(
  surface: QuoteSurface,
  currency: ApprovedCurrency,
  plan: ApprovedPlan,
): boolean {
  if (plan === "owner" || surface === "signup" || surface === "owner") return false;
  if (currency === "USD") return plan === "starter" && (surface === "visitor" || surface === "firm");
  return surface === "visitor" || surface === "firm" || surface === "wall" || surface === "checkout";
}

/**
 * Pure label. Market is already resolved. Unknown plans return null so the
 * caller can name the plan instead of inventing an amount.
 */
export function quotePrice(input: {
  market: SurfaceMarket;
  plan: ApprovedPlan;
  interval: FirmInterval;
  surface: QuoteSurface;
}): PriceQuote | null {
  const currency = currencyFor(input.market);
  const row = approvedPrice(input.plan, input.interval, currency);
  if (!row) return null;
  const amount = majorUnits(row.unitAmount);
  const head = `${money(amount, currency)}/${input.interval === "year" ? "yr" : "mo"}`;
  let label = head;
  if (showPerClient(input.surface, currency, input.plan) && row.clientLimit) {
    const monthly = approvedPrice(input.plan, "month", currency);
    if (monthly) {
      const hint = perClient(majorUnits(monthly.unitAmount), row.clientLimit, currency);
      label = `${head} · about ${hint} per client`;
    }
  }
  return {
    market: input.market,
    plan: input.plan,
    interval: input.interval,
    amount,
    currency,
    label,
    lookupKey: row.lookupKey,
  };
}

/**
 * Which market a surface prices. Firm, wall, and checkout ignore the URL
 * hint. Signup prices the practice country the visitor selected, which is
 * not a public ?country= override.
 */
export function resolveQuoteMarket(input: {
  surface: QuoteSurface;
  geoCountry?: string | null;
  savedChoice?: string | null;
  choiceFromThisVisit?: boolean;
  storedMarket?: unknown;
  billingCountry?: string | null;
  practiceListZar?: boolean;
  practiceCountry?: string | null;
}): SurfaceMarket {
  switch (input.surface) {
    case "visitor":
      return resolveVisitorMarket({
        geoCountry: input.geoCountry,
        savedChoice: input.savedChoice,
        choiceFromThisVisit: input.choiceFromThisVisit,
      });
    case "signup":
      return (input.practiceCountry ?? "").trim().toUpperCase() === "ZA" ? "za" : "us";
    case "firm":
      return resolveFirmMarket(input.storedMarket);
    case "owner":
      return resolveOwnerMarket({
        storedMarket: input.storedMarket,
        geoCountry: input.geoCountry,
      });
    case "checkout":
    case "wall":
      return resolveCheckoutPriceMarket({
        storedFirmMarket: input.storedMarket,
        billingCountry: input.billingCountry,
        practiceListZar: input.practiceListZar,
      });
  }
}

export type SignupQuotePack = {
  country: "ZA" | "US";
  starterMonthly: string;
  ownerMonthly: string;
  ownerPayLine: string;
  trialReminder: string;
};

/** Signup sentences for the practice country select. Missing ZA quote omits the amount. */
export function signupQuotePack(country: string | null | undefined): SignupQuotePack {
  const code = (country ?? "").trim().toUpperCase() === "ZA" ? "ZA" : "US";
  const market = resolveQuoteMarket({ surface: "signup", practiceCountry: code });
  const starter = quotePrice({ market, plan: "starter", interval: "month", surface: "signup" });
  const owner = quotePrice({ market, plan: "owner", interval: "month", surface: "signup" });
  return {
    country: code,
    starterMonthly: starter?.label ?? "",
    ownerMonthly: owner?.label ?? "",
    ownerPayLine: firmSignupOwnerPayLine(code, owner?.label ?? ""),
    trialReminder: firmSignupTrialReminder("Starter", code, starter?.label ?? ""),
  };
}
