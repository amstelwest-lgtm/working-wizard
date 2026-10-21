import { COMPANY_ADDRESS, LEGAL_ENTITY } from "@/lib/legal";
import {
  FIRM_TRIAL_CARD_LINE,
  FIRM_TRIAL_CARD_NOTE,
  FIRM_TRIAL_SENTENCE,
  firmUsdListPrice,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";

/**
 * Card after the first result, then the Starter price. Keep this sentence on
 * landing, register, pricing, and the firm form. It does not name a rand amount.
 */
export const FIRM_CARD_TIMING = FIRM_TRIAL_CARD_LINE;

/**
 * Paid-plan sentence on the homepage #register firm form.
 * Auth Create Firm must use this helper so the two surfaces cannot drift.
 * The trial is Starter. The dollar price is the US catalog only.
 */
export function firmSignupTrialReminder(_planLabel: string): string {
  return `Starter. ${FIRM_TRIAL_SENTENCE}. ${FIRM_TRIAL_CARD_NOTE} Then ${firmUsdListPrice("starter", "month")}/mo.`;
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
): string {
  const q = new URLSearchParams({
    signup: "true",
    plan,
    interval,
  });
  return `/auth?${q.toString()}`;
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
