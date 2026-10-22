import { COMPANY_ADDRESS, LEGAL_ENTITY } from "@/lib/legal";
import { OWNER_MONTHLY_USD_LABEL } from "@/lib/owner-plan";
import { withVisitorMarketHint } from "@/lib/pricing/visitor-market-hint";
import {
  FIRM_TRIAL_CARD_LINE,
  FIRM_TRIAL_SENTENCE,
  firmUsdListPrice,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";

/**
 * Card after the first result, then the Starter price. Shared by the trial
 * banner, the add-client card, and the billing wall. The signup form does
 * not use this sentence.
 */
export const FIRM_CARD_TIMING = FIRM_TRIAL_CARD_LINE;

/**
 * Catalog monthly label. A South African practice uses the quote passed in
 * from the server. This file does not contain a rand amount. Every other
 * country, including a missing one, stays on the dollar catalog.
 */
export function firmSignupStarterMonthly(
  country: string | null | undefined,
  quotedLabel?: string | null,
): string {
  if ((country ?? "").trim().toUpperCase() === "ZA") {
    return (quotedLabel ?? "").replace(/\s+/g, "");
  }
  const quoted = quotedLabel?.trim();
  if (quoted) return quoted;
  const usd = firmUsdListPrice("starter", "month");
  if (!usd) throw new Error("Starter has no published monthly price.");
  return `${usd}/mo`;
}

export function firmSignupOwnerMonthly(
  country: string | null | undefined,
  quotedLabel?: string | null,
): string {
  if ((country ?? "").trim().toUpperCase() === "ZA") {
    return (quotedLabel ?? "").replace(/\s+/g, "");
  }
  const quoted = quotedLabel?.trim();
  if (quoted) return quoted;
  return OWNER_MONTHLY_USD_LABEL;
}

/** Owner price under the accountant signup form. No VAT wording. */
export function firmSignupOwnerPayLine(
  country: string | null | undefined,
  quotedLabel?: string | null,
): string {
  const amount = firmSignupOwnerMonthly(country, quotedLabel);
  if (!amount) {
    return "Business owners are on the Owner plan, or pay nothing when their accountant is on Milōn.";
  }
  return `Business owners pay ${amount}, or nothing when their accountant is on Milōn.`;
}

/**
 * Trial line on the homepage #register firm form and /auth Create Firm.
 * The price follows the country select. Auth and the homepage share this
 * helper so the two surfaces cannot drift.
 */
export function firmSignupTrialReminder(
  _planLabel: string,
  country?: string | null,
  quotedLabel?: string | null,
): string {
  const price = firmSignupStarterMonthly(country, quotedLabel);
  const then = price ? ` Then ${price}.` : "";
  return `Your first client is free to explore. Add a card to start your ${FIRM_TRIAL_SENTENCE}.${then}`;
}

/** Accountant nav / hero label. Firms need a card, so this is not "Start free". */
export const FIRM_TRIAL_CTA_LABEL = "Start 14-day trial";

/** Same role label as the homepage #register firm form. */
export const FIRM_ROLE_PROMPT = "I am an";
export const FIRM_ROLE_LABEL = "Accountant / Advisory firm";

/** Create Firm tab with Starter preselected — not the Sign in default at /auth. */
export function firmSignupHref(
  plan: FirmCheckoutBand = "starter",
  interval: FirmInterval = "month",
  marketHint?: string | null,
): string {
  const q = new URLSearchParams({
    signup: "true",
    plan,
    interval,
  });
  return withVisitorMarketHint(`/auth?${q.toString()}`, marketHint);
}

export const FIRM_SIGNUP_HREF = firmSignupHref();

/** Why Create Firm stays disabled. Null when the practice location is complete. */
export function practiceLocationHint(draft: {
  country: string | null;
  regionCode: string | null;
}): string | null {
  if (!draft.country) {
    return "Choose where this practice is. A United States practice also needs a state.";
  }
  if (draft.country === "US" && !draft.regionCode) {
    return "Required. Your practice's state.";
  }
  return null;
}

/**
 * Enterprise quotes. Public contact mailbox (hello@milonfinance.com).
 * Not a sign-in URL. Cold Lighthouse From stays on its own constant.
 */
export const ENTERPRISE_CONTACT_EMAIL = "hello@milonfinance.com";
export const ENTERPRISE_CONTACT_HREF = `mailto:${ENTERPRISE_CONTACT_EMAIL}?subject=${encodeURIComponent("Enterprise firm pricing")}`;

export const PRACTICE_LOCATION_PROMPT = "Where is this practice?";
export const BUSINESS_LOCATION_PROMPT = "Where is this business?";

/** One framing line for homepage and collateral footers. No country claim. */
export const DUAL_MARKET_TAGLINE = "for accounting firms and the businesses they advise.";

/** Footer copyright line: legal name plus the registered address. */
export const MARKETING_COPYRIGHT_ENTITY = `${LEGAL_ENTITY} ${COMPANY_ADDRESS}`;

export const DUAL_MARKET_FOOTER =
  "Milōn — an AI finance team for accounting firms and the businesses they advise.";

export const DUAL_MARKET_BUILT = "An AI finance team for accounting firms";
