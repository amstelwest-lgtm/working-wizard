/**
 * Firm billing wall. A hung read becomes a card or an error inside the
 * shell deadline. Unknown market is priced as not-ZA (USD catalog).
 * A ZA quote with no price label is an error. US quotes leave priceLabel
 * null on purpose; the USD catalog fills it in.
 */

import type { FirstFirmClient } from "@/lib/firm-client-gate";
import { settleWithin, type Settled } from "@/lib/bounded-load";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";
import { CARD_FREE_TRIAL_LINE, cardFreeTrialLine } from "@/lib/starter-trial-constants";
import {
  FIRM_BAND_CATALOG,
  firmSignupCheckoutIntent,
  firmUsdListPrice,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";

export { cardFreeTrialLine };

export const BILLING_WALL_TRIAL_ACTION = "Start your 14-day free trial · add a card";

/** Primary action. The trial terms live in the body, not on the button. */
export const FIRM_WALL_START_LABEL = "Start trial";

export const FIRM_WALL_BACK_LABEL = "Back to clients";

export const FIRM_WALL_BACK_HREF = "/clients";

/** Card-free firm (no subscription). Trialing firms do not land on this wall. The price is separate. */
export const FIRM_WALL_TRIAL_LINE = CARD_FREE_TRIAL_LINE;

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

/**
 * Price under the card-free trial line. Starter monthly, the same plan
 * Checkout opens for a firm with no subscription. A ZA label is the
 * server's Starter line. Every other market uses the USD catalog.
 */
export function cardFreeTrialPrice(input: {
  market: "za" | "us" | null;
  zaPriceLabel: string | null;
}): string | null {
  const intent = firmSignupCheckoutIntent(input.market === "za" ? "za" : "us");
  return firmWallDisplayPrice({
    market: input.market,
    zaPriceLabel: input.zaPriceLabel,
    plan: intent.plan,
    interval: intent.interval,
  });
}

/**
 * Starter monthly label for a firm quote. The same market split the
 * Start trial wall uses: a ZA quote keeps the server line, including the
 * per-client clause. A US quote is the USD catalog. Any other quote is
 * not treated as South Africa.
 */
export function cardFreeTrialPriceFromQuote(
  quote: { market?: string | null; priceLabel?: string | null } | null | undefined,
): string | null {
  const market = quote?.market === "za" ? "za" : quote?.market === "us" ? "us" : null;
  return cardFreeTrialPrice({
    market,
    zaPriceLabel: market === "za" ? (quote?.priceLabel ?? null) : null,
  });
}

export function firmWallTrialDetail(priceLabel: string | null): string {
  const limit = FIRM_BAND_CATALOG.starter.clientLimit;
  const head = `Starter, up to ${limit} clients`;
  if (!priceLabel) return `${head}.`;
  return `${head}, then ${priceLabel}.`;
}

/**
 * Why this wall is up. The first client's file stays open without a plan
 * (`isFirstClientFiguresPath`): that client's numbers, not a later file.
 * The sentence names the file in accountant terms. A client display name
 * such as a sports team reads as if that business is what stays open.
 * Home, the client list, and practice stay open too (`isPracticeShellPath`).
 * Reports and a later client do not.
 */
const FIRM_WALL_WHY_FIRST =
  "This firm has no plan yet. Your first client and its numbers stay open. Reports and a later client need Starter.";

/** More than one client. Does not name a first or earliest file. */
const FIRM_WALL_WHY_LATER =
  "This firm has no plan yet. Reports and a later client need Starter.";

export function firmWallWhyLine(
  _clientName: string | null | undefined,
  clientCount?: number | null,
): string {
  if (typeof clientCount === "number" && Number.isFinite(clientCount) && clientCount > 1) {
    return FIRM_WALL_WHY_LATER;
  }
  return FIRM_WALL_WHY_FIRST;
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

export function firmWallTrialEnded(
  settled: Settled<{ entitled: boolean; introTrialEligible?: boolean }>,
): boolean {
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

function inAppPath(
  referrer: string | null | undefined,
  pageOrigin: string | null | undefined,
): string | null {
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
  /** Cap count for the trial sentence. Null when the read failed or was omitted. */
  clientCount: number | null;
  entitled: boolean;
  entitlementOutcome: FirmWallEntitlementOutcome;
  trialEnded: boolean;
  quote: FirmWallQuote | null;
  quoteError: string;
  priceLabel: string | null;
};

export async function resolveBillingWall(input: {
  client: Promise<FirstFirmClient | null>;
  /** Same count the client cap uses. Omitted or failed stays null, never 0. */
  clientCount?: Promise<number | null>;
  entitlement: Promise<{ entitled: boolean; introTrialEligible?: boolean }>;
  quote: Promise<FirmWallQuote | null>;
  plan: FirmCheckoutBand;
  interval: FirmInterval;
  timeoutMs?: number;
}): Promise<BillingWallResolution> {
  const timeoutMs = input.timeoutMs ?? SHELL_GATE_TIMEOUT_MS;
  const [client, entitlement, quote, clientCount] = await Promise.all([
    settleWithin(input.client, timeoutMs),
    settleWithin(input.entitlement, timeoutMs),
    settleWithin(input.quote, timeoutMs),
    input.clientCount
      ? settleWithin(input.clientCount, timeoutMs)
      : Promise.resolve({ status: "value" as const, value: null as number | null }),
  ]);
  const nextQuote = quote.status === "value" ? quote.value : null;
  let quoteError = "";
  if (!nextQuote) quoteError = BILLING_WALL_QUOTE_ERROR;
  const signup = firmSignupCheckoutIntent();
  const zaPriceLabel = nextQuote?.market === "za" ? nextQuote.priceLabel : null;
  const priceLabel =
    input.plan === signup.plan && input.interval === signup.interval
      ? cardFreeTrialPrice({ market: nextQuote?.market ?? null, zaPriceLabel })
      : firmWallDisplayPrice({
          market: nextQuote?.market ?? null,
          zaPriceLabel,
          plan: input.plan,
          interval: input.interval,
        });
  if (nextQuote?.market === "za" && !nextQuote.priceLabel?.trim()) {
    quoteError = quoteError || BILLING_WALL_QUOTE_ERROR;
  }
  const counted = clientCount.status === "value" ? clientCount.value : null;
  return {
    checking: false,
    returnClient: client.status === "value" ? client.value : null,
    clientCount: typeof counted === "number" && Number.isFinite(counted) ? counted : null,
    entitled: entitlement.status === "value" && entitlement.value.entitled === true,
    entitlementOutcome: firmWallEntitlementOutcome(entitlement),
    trialEnded: firmWallTrialEnded(entitlement),
    quote: nextQuote,
    quoteError,
    priceLabel,
  };
}
