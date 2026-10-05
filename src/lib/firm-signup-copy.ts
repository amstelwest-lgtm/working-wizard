import { FIRM_TRIAL_SENTENCE } from "@/lib/stripe-plans";

/**
 * Paid-plan sentence on the homepage #register firm form.
 * Auth Create Firm must use this helper so the two surfaces cannot drift.
 */
export function firmSignupTrialReminder(planLabel: string): string {
  return `You will start on ${planLabel} with a ${FIRM_TRIAL_SENTENCE}. A card is required. After day 14 the paid band bills automatically.`;
}

/** Accountant nav / hero label. Firms need a card, so this is not "Start free". */
export const FIRM_TRIAL_CTA_LABEL = "Start 14-day trial";

/** Create Firm tab — not the Sign in default at /auth. */
export const FIRM_SIGNUP_HREF = "/auth?signup=true";

/**
 * Enterprise quotes. Same mailbox Lighthouse replies already land in
 * (`LIGHTHOUSE_REPLY_TO` in lighthouse-reply-to.ts). Not a sign-in URL.
 */
export const ENTERPRISE_CONTACT_EMAIL = "team@trymilon.com";
export const ENTERPRISE_CONTACT_HREF = `mailto:${ENTERPRISE_CONTACT_EMAIL}?subject=${encodeURIComponent("Enterprise firm pricing")}`;

export const PRACTICE_LOCATION_PROMPT = "Where is this practice?";
export const BUSINESS_LOCATION_PROMPT = "Where is this business?";

/** One framing line for homepage and collateral footers. */
export const DUAL_MARKET_TAGLINE =
  "for accounting firms and small businesses in South Africa and the United States.";

export const DUAL_MARKET_FOOTER =
  "MILŌN — the AI finance function for accounting firms and the businesses they serve in South Africa and the United States.";

export const DUAL_MARKET_BUILT = "Built for South Africa and the United States";
