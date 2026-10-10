import { FIRM_CARD_TIMING, FIRM_TRIAL_CTA_LABEL } from "@/lib/firm-signup-copy";
import { LIST_PRICES } from "@/lib/market/marketing";
import { HOMEPAGE_FAQ_ITEMS } from "@/lib/marketing-faq";
import type { FaqItem } from "@/lib/seo";

/** Empty unless VITE_WALKTHROUGH_URL is set. The hero slot stays unrendered. */
export const WALKTHROUGH_URL = String(import.meta.env.VITE_WALKTHROUGH_URL ?? "").trim();

export const HERO_BADGE = "For accounting firms and the businesses they advise";
export const HERO_H1_LEAD = "Your AI finance team.";
export const HERO_H1_GOLD = "You sign off.";
export const HERO_LEDE =
  "Plug in QuickBooks Online or Xero. Milōn Financial Manager, Milōn Analyst and Milōn Advisor read the numbers, diagnose the business and draft the advisory. You review and sign off.";
export const HERO_CTA_LABEL = "Start my 14-day free trial";
export const HERO_WALKTHROUGH_LABEL = "Book a 30-min walkthrough";
export const HERO_CTA_NOTE = `${FIRM_CARD_TIMING} Plans from ${LIST_PRICES.us.firmSolo}/mo after day 14.`;
export const HERO_CONTACT_EMAIL = "hello@milonfinance.com";
export const HERO_CONTACT_HREF =
  "mailto:hello@milonfinance.com?subject=Question%20about%20Mil%C5%8Dn";
export const HERO_OWNER_PREFIX = "Business owner?";

/**
 * VERIFY-1. Unsigned packs, recommendations, and a cash-forecast email can
 * reach the owner before an accountant signs off, so the line does not claim
 * that sign-off gates what the client sees.
 */
export const HERO_SIGNOFF_POINT = "You review and sign off every advisory pack.";

export const HERO_POINTS = [
  "Connect a client's QuickBooks Online or Xero file, or upload a P&L and balance sheet.",
  "Milōn Financial Manager, Milōn Analyst and Milōn Advisor build the health score, 13-week cash forecast and action plan.",
  HERO_SIGNOFF_POINT,
] as const;

export const TRUST_BOOKS = "The books stay in QuickBooks Online or Xero";
/**
 * VERIFY-3 fallback. ask-ai sanitises the question text, but brain-propose,
 * brain-deliverable-draft, advisory drafts, client briefings, and statement
 * extraction send the client name (and, for uploads, the file) unstripped.
 */
export const TRUST_IDENTIFIERS =
  "The in-app assistant filters tax IDs and account numbers from questions; amounts stay so the workings are real";
/** VERIFY-4: confirmed. Cite the /ai notice (SEO_PAGES.ai plus the public page). */
export const TRUST_TRAINING = "Client data isn't used to train third-party AI models";
/** firm_name is nullable on the sign-off history row, so the strip does not claim it. */
export const TRUST_SIGNOFF = "Every sign-off logged with name and time";

export const TRUST_ITEMS = [
  TRUST_BOOKS,
  TRUST_IDENTIFIERS,
  TRUST_TRAINING,
  TRUST_SIGNOFF,
] as const;

export const TRUST_AI_LINK = "How we handle data and AI →";

export const HOW_STEP_03 =
  "Your Milōn finance team turns the analysis and business context into clear recommendations, a 13-week cash forecast, and an action plan.";

export const BRIDGE_DRAFT_LABEL = "Your AI finance team drafts";
export const BRIDGE_DRAFT_BODY =
  "It prepares the first version of the analysis and the advisory deliverables.";

/** Three distinct agents on /for-accountants. Same <strong> + body pattern as the old single bullet. */
export const FIRM_TEAM_BULLETS = [
  {
    title: "Milōn Financial Manager, data quality for QBO and Xero.",
    body: "Checks the books, the 13-week cash and the budget, and prepares action points and the hand-off to your firm.",
  },
  {
    title: "Milōn Analyst, health score and ratios.",
    body: "Calculates the health score and the ratios, and explains variances in plain words.",
  },
  {
    title: "Milōn Advisor, next moves and the advisory.",
    body: "Drafts the next moves and the advisory deliverables. You correct, sign off and send. The judgement stays yours.",
  },
] as const;

/** Role strip in #problem. Reuses .bridge-facts / .bridge-fact; no new CSS. */
export const FINANCE_TEAM = [
  {
    name: "Milōn Financial Manager",
    body: "Data quality from QuickBooks and Xero, the 13-week cash and budget, and action points.",
    bold: "Hands the pack to your accountant.",
  },
  {
    name: "Milōn Analyst",
    body: "Health score, ratios, and variances from the figures on file.",
    bold: "Says what moved.",
  },
  {
    name: "Milōn Advisor",
    body: "Next moves and the advisory deliverables.",
    bold: "You review and sign off.",
  },
] as const;

export const WATCH_EYEBROW = "See it in 30 seconds";
export const WATCH_TITLE = "Two seats. One workspace.";
export const WATCH_SUB =
  "The accountant runs the analysis and signs off every advisory pack. The owner uses the same workspace to see what to do next.";

export const ACCOUNTANT_TEASER = {
  label: "For accounting firms",
  title: "The accountant's view",
  meta: "0:30",
  videoId: "J4vJki7HcIs",
  accessibleName: "Play video: The accountant's view, 30 seconds",
} as const;

export const OWNER_TEASER = {
  label: "For business owners",
  title: "The owner's view",
  meta: "0:30",
  videoId: "k3aRM4toTvU",
  accessibleName: "Play video: The owner's view, 30 seconds",
} as const;

export const OWNER_TEASER_LINK = "Spark is free during early access →";

export const AI_USE_LEAD = "How we use AI is set out in our";

export const DASH_ARIA_LABEL =
  "Sample client dashboard: health score 78 with four pillar scores and a 13-week cash forecast showing a dip in week 6";

export const PRICING_H2_USD = "Flat USD pricing by active clients, Solo to Scale.";
export const PRICING_INTRO =
  "One monthly price, set by how many clients you actively advise. Start on Solo and move up a band as your client list grows.";
/**
 * VERIFY-2 confirmed. Checkout creates a subscription on the chosen band price
 * (`firmCheckoutSessionParams`: `trial_period_days` 14, `payment_method_collection: "always"`).
 * Stripe bills that price when the trial ends and a card is on file.
 */
export const PRICING_TRIAL_AFTER = `${FIRM_CARD_TIMING} After day 14 the paid band bills.`;
export const PRICING_WATCHLIST_NOTE =
  "Watchlist clients are free and don't count toward your band until you open a full workspace for them.";
export const PRICING_OWNER_BAR =
  "Business owners: Spark is free during early access, no card needed.";
export const PRICING_OWNER_CTA = "Start free on Spark";
export const SOLO_TRIAL_BUTTON = "Start my 14-day free trial";
export const SOLO_CARD_NOTE = FIRM_CARD_TIMING;

/** Same label as /for-accountants. Do not fork a second trial string. */
export const NAV_TRIAL_LABEL = FIRM_TRIAL_CTA_LABEL;
export const NAV_TRIAL_ARIA = "Start my 14-day free trial";

export const PROOF_EYEBROW = "Proof, not promises";
export const PROOF_H2 = "Every number shows its workings. Every sign-off leaves a trail.";

/**
 * VERIFY-12 confirmed. `ratioActualLine` leaves the calculation blank and
 * `ratioFormulaLine` prints `Need: …` when an input is missing. Blank fields
 * stay NaN in `computeRatios` rather than becoming 0.
 */
export const PROOF_RATIO_BODY =
  "Each of the 19 ratios shows the figures behind it. Where a number is missing, Milōn says so instead of guessing.";
/**
 * VERIFY-11 confirmed: the PDF footer prints `signedOffByName` and the formatted
 * `signedOffAt` (`report-footer.tsx`). Firm is omitted when `firm_name` is null.
 * VERIFY-5 confirmed: `signoffStampFor` / `stampFromSignoff` drop the stamp when
 * the figures' freshness timestamp is later than `signed_off_at`.
 */
export const PROOF_SIGNOFF_BODY =
  "Signed-off reports carry the accountant's name and the sign-off date. If the figures change, the old sign-off no longer applies.";
/**
 * VERIFY-9 confirmed. The bot prompt refuses invented figures, and `request_human`
 * stops the loop for a decision. No email claim (forecast_break can mail early).
 */
export const PROOF_BOT_BODY =
  "Each Milōn agent works only from what's on file. None invents figures, and each stops when a decision needs you.";

export const PROOF_CARDS = [
  {
    id: "ratio",
    title: "Workings on every ratio",
    body: PROOF_RATIO_BODY,
    alt: "Ratio detail showing days sales outstanding with the receivables and revenue figures used to calculate it",
    base: "ratio-dso",
    width: 1600,
    height: 1000,
  },
  {
    id: "signoff",
    title: "Sign-off on the deliverable",
    body: PROOF_SIGNOFF_BODY,
    alt: "Advisory report footer with the accountant's sign-off stamp showing name and date",
    base: "signoff-stamp",
    width: 1600,
    height: 1109,
  },
  {
    id: "plan",
    title: "Agents that know their limits",
    body: PROOF_BOT_BODY,
    alt: "Action plan ready for review with Request changes and Sign off action plan for Sample Co.",
    base: "action-plan-review",
    width: 1600,
    height: 694,
  },
] as const;

export function proofImageSrc(base: string, width: 480 | 800 | 1200 | 1600): string {
  return `/proof/${base}-${width}.webp`;
}

export function proofImageSrcSet(base: string): string {
  return ([480, 800, 1200, 1600] as const)
    .map((width) => `${proofImageSrc(base, width)} ${width}w`)
    .join(", ");
}

/**
 * VERIFY-6 is not confirmed as a blanket claim. `has_client_access` also admits
 * Milōn IT to every client, and firm staff need a named assignment rather than
 * seeing the whole firm. The RLS bullet and homepage FAQ item are omitted.
 * VERIFY-7 confirmed: Checkout collects the card (`payment_method_collection:
 * "always"`); no card number, expiry, or CVC column exists in the schema.
 * VERIFY-8 confirmed: Settings calls `deleteOwnAccount` → `delete_own_account()`,
 * which deletes the login and owned client/firm rows.
 * The sign-off log line was verified in #302 (SELECT + INSERT only).
 */
export const PROOF_SECURITY_FACTS = [
  "Card details are collected by Stripe Checkout. Milōn never stores them.",
  "You can delete your account and its data from Settings.",
  "Every sign-off is logged with the accountant's name and time, and log entries can't be edited afterwards.",
] as const;

export const PROOF_AI_LINK = "Read the AI notice →";
export const PROOF_PRIVACY_LINK = "Privacy →";

export const FAQ_MORE_LEAD = "More on cost, data and AI: ";
export const FAQ_MORE_LINK = "all questions";

/** Must match the homepage cost question in `HOMEPAGE_FAQ_ITEMS`. */
export const HOMEPAGE_COST_QUESTION = "What does it cost?";

export function withSaPricingLines(answer: string, _showSaPricing: boolean): string {
  return answer;
}

/** Visible homepage FAQ and its FAQPage JSON-LD. US by default. */
export function homepageFaqItems(showSaPricing: boolean): FaqItem[] {
  return HOMEPAGE_FAQ_ITEMS.map((item) =>
    item.question === HOMEPAGE_COST_QUESTION
      ? { ...item, answer: withSaPricingLines(item.answer, showSaPricing) }
      : item,
  );
}
