import { FIRM_TRIAL_SENTENCE, type FirmCheckoutBand, type FirmInterval } from "@/lib/stripe-plans";

/**
 * Paid-plan sentence on the homepage #register firm form.
 * Auth Create Firm must use this helper so the two surfaces cannot drift.
 */
export function firmSignupTrialReminder(planLabel: string): string {
  return `You will start on ${planLabel} with a ${FIRM_TRIAL_SENTENCE}. A card is required. After day 14 the paid band bills automatically.`;
}

/** Accountant nav / hero label. Firms need a card, so this is not "Start free". */
export const FIRM_TRIAL_CTA_LABEL = "Start 14-day trial";

/** Same role label as the homepage #register firm form. */
export const FIRM_ROLE_PROMPT = "I am an";
export const FIRM_ROLE_LABEL = "Accountant / Advisory firm";

/** Create Firm tab with Solo preselected — not the Sign in default at /auth. */
export function firmSignupHref(
  plan: FirmCheckoutBand = "solo",
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
    return "Choose where this practice is — South Africa or the United States.";
  }
  if (draft.country === "US" && !draft.regionCode) {
    return "Choose a US state. It is required for sales tax.";
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

/** One framing line for homepage and collateral footers. */
export const DUAL_MARKET_TAGLINE =
  "for accounting firms and small businesses in South Africa and the United States.";

export const DUAL_MARKET_FOOTER =
  "MILŌN — the AI finance function for accounting firms and the businesses they serve in South Africa and the United States.";

export const DUAL_MARKET_BUILT = "Built for South Africa and the United States";
