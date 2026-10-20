/**
 * Firm billing wall. A hung read becomes a card or an error inside the
 * shell deadline. Unknown market is priced as not-ZA (USD catalog).
 * A ZA quote with no price label is an error. US quotes leave priceLabel
 * null on purpose; the USD catalog fills it in.
 */

import type { FirstFirmClient } from "@/lib/firm-client-gate";
import { settleWithin, type Settled } from "@/lib/bounded-load";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";
import { FIRM_TRIAL_CLIENT_LIMIT, FIRM_TRIAL_DAYS } from "@/lib/starter-trial-constants";
import { FIRM_BAND_CATALOG, firmUsdListPrice, type FirmCheckoutBand, type FirmInterval } from "@/lib/stripe-plans";

export const BILLING_WALL_TRIAL_ACTION = "Start your 14-day free trial · add a card";

/** Primary action. The trial terms live in the body, not on the button. */
export const FIRM_WALL_START_LABEL = "Start trial";

export const FIRM_WALL_BACK_LABEL = "Back to clients";

export const FIRM_WALL_BACK_HREF = "/clients";

/** One trial sentence. The price is not repeated here. */
export const FIRM_WALL_TRIAL_LINE = `Starter · ${FIRM_TRIAL_DAYS}-day free trial · up to ${FIRM_TRIAL_CLIENT_LIMIT} clients · card at signup`;

export const FIRM_WALL_TRIAL_ENDED_LINE =
  "If a trial already ended, billing resumes on the paid band without another trial.";

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

/**
 * Why this wall is up. The first client's file stays open without a plan
 * (`isFirstClientFiguresPath`): that client's figures, not a later file.
 * Home, the client list, and practice stay open too (`isPracticeShellPath`).
 * Reports and a later client do not.
 */
export function firmWallWhyLine(clientName: string | null | undefined): string {
  const name = (clientName ?? "").trim();
  const open = name
    ? `${name} and the figures stay open.`
    : "The first client's figures stay open.";
  return `This firm has no plan yet. ${open} Reports and a later client need Starter.`;
}

export type FirmWallEntitlementOutcome = "entitled" | "not_entitled" | "failed";

export function firmWallEntitlementOutcome(
  settled: Settled<{ entitled: boolean }>,
): FirmWallEntitlementOutcome {
  if (settled.status !== "value") return "failed";
  return settled.value.entitled === true ? "entitled" : "not_entitled";
}

/** Retry only when the entitlement read timed out or threw. A confirmed unpaid firm does not. */
export function firmWallOffersRetry(outcome: FirmWallEntitlementOutcome): boolean {
  return outcome === "failed";
}

export function firmWallTrialEnded(settled: Settled<{ entitled: boolean; introTrialEligible?: boolean }>): boolean {
  if (settled.status !== "value" || settled.value.entitled === true) return false;
  return settled.value.introTrialEligible === false;
}

/**
 * Back leaves the wall. No referrer, an outside site, billing itself, reports,
 * or a later client file all go to the client list, which stays open.
 * Home, practice, settings, and the first client's file are real in-app returns.
 */
export function firmWallBackTarget(input: {
  referrer?: string | null;
  pageOrigin?: string | null;
  firstClientId?: string | null;
}): string {
  const path = inAppPath(input.referrer, input.pageOrigin);
  if (!path) return FIRM_WALL_BACK_HREF;
  const bare = (path.split(/[?#]/, 1)[0] ?? "").replace(/\/$/, "") || "/";
  if (bare.startsWith("/billing")) return FIRM_WALL_BACK_HREF;
  if (bare === "/clients" || bare === "/dashboard" || bare === "/practice") return bare;
  if (bare === "/settings" || bare.startsWith("/settings/")) return bare;
  const first = input.firstClientId?.trim() ?? "";
  if (first && bare === `/clients/${first}`) return bare;
  return FIRM_WALL_BACK_HREF;
}

function inAppPath(referrer: string | null | undefined, pageOrigin: string | null | undefined): string | null {
  const raw = (referrer ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  const origin = (pageOrigin ?? "").trim().replace(/\/$/, "");
  if (!origin || !raw.startsWith(origin)) return null;
  const rest = raw.slice(origin.length);
  if (!rest.startsWith("/")) return null;
  return rest;
}

export type BillingWallResolution = {
  checking: false;
  returnClient: FirstFirmClient | null;
  entitled: boolean;
  entitlementOutcome: FirmWallEntitlementOutcome;
  trialEnded: boolean;
  quote: FirmWallQuote | null;
  quoteError: string;
  priceLabel: string | null;
};

export async function resolveBillingWall(input: {
  client: Promise<FirstFirmClient | null>;
  entitlement: Promise<{ entitled: boolean; introTrialEligible?: boolean }>;
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
    entitlementOutcome: firmWallEntitlementOutcome(entitlement),
    trialEnded: firmWallTrialEnded(entitlement),
    quote: nextQuote,
    quoteError,
    priceLabel,
  };
}
