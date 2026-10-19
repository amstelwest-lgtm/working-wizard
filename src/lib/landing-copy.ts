import { FIRM_TRIAL_CTA_LABEL } from "@/lib/firm-signup-copy";
import { HOMEPAGE_FAQ_ITEMS, HOMEPAGE_OWNER_COST_US } from "@/lib/marketing-faq";
import type { FaqItem } from "@/lib/seo";
import { FIRM_TRIAL_SENTENCE, firmUsdListPrice } from "@/lib/stripe-plans";

/** Empty unless VITE_WALKTHROUGH_URL is set. The hero slot stays unrendered. */
export const WALKTHROUGH_URL = String(import.meta.env.VITE_WALKTHROUGH_URL ?? "").trim();

export const HERO_BADGE = "For accounting firms and the businesses they advise";
export const HERO_H1_LEAD = "Your AI finance team.";
export const HERO_H1_GOLD = "You sign off.";
export const HERO_LEDE =
  "Plug in QuickBooks or Xero. Sage is coming soon. Milōn Financial Manager, Milōn Analyst and Milōn Advisor read the numbers, diagnose the business and draft the advisory. You review and sign off.";
export const HERO_CTA_LABEL = "Start my 14-day free trial";
export const HERO_WALKTHROUGH_LABEL = "Book a 30-min walkthrough";
/** Hero note. The pricing bar leads with FIRM_TRIAL_SENTENCE and uses the shorter line under it. */
const FIRM_TRIAL_THEN_US = `Then ${firmUsdListPrice("starter", "month")}/mo.`;
export const PRICING_TRIAL_AFTER = `On Starter. A card is required at signup. ${FIRM_TRIAL_THEN_US}`;
export const FIRM_TRIAL_EXPLORE = `${FIRM_TRIAL_SENTENCE}. ${PRICING_TRIAL_AFTER}`;
export const HERO_CTA_NOTE = FIRM_TRIAL_EXPLORE;
export const HERO_CONTACT_EMAIL = "hello@milonfinance.com";
export const HERO_CONTACT_HREF =
  "mailto:hello@milonfinance.com?subject=Question%20about%20Mil%C5%8Dn";
export const HERO_OWNER_PREFIX = "Business owner?";
export const HERO_OWNER_LINK = "Business owner? $39/mo, or free when your accountant is on Milōn →";
export const OWNER_SIGNUP_LINK = "Get your own AI finance team →";
/** /for-owners and /about. USD. The rand twin lives in the SA pricing server chunk. */
export const OWNER_PLAN_EARLY_US =
  "The owner plan is $39 a month, and free when your accountant is on Milōn. If something in the product is not finished, we tell you inside the product rather than hiding it.";
export const OWNER_REGISTER_NOTE_US =
  "Business owners pay $39/mo, or nothing when their accountant is on Milōn.";

/**
 * VERIFY-1. Unsigned packs, recommendations, and a cash-forecast email can
 * reach the owner before an accountant signs off, so the line does not claim
 * that sign-off gates what the client sees.
 */
export const HERO_SIGNOFF_POINT = "You review and sign off every advisory pack.";

export const HERO_POINTS = [
  "Connect a client's QuickBooks Online or Xero file. Sage is coming soon. Or upload a P&L and balance sheet.",
  "Milōn Financial Manager, Milōn Analyst and Milōn Advisor build the health score, 13-week cash forecast and action plan.",
  HERO_SIGNOFF_POINT,
] as const;

export const TRUST_PREP =
  "Less time on each client. The finance team prepares the file before you sit down.";
export const TRUST_HANDOFF =
  "The AI team prepares the work and your accountant reviews and approves it, so the client gets advice they can trust and the firm keeps control.";
export const TRUST_FEE =
  "A Financial Manager, an Analyst and an Advisor, for a small monthly fee.";
export const TRUST_BOOKS =
  "QuickBooks and Xero stay the books. Sage is coming soon. Invoices, bills and receipts post only after a named person approves.";

export const TRUST_ITEMS = [TRUST_PREP, TRUST_HANDOFF, TRUST_FEE, TRUST_BOOKS] as const;

export const HOW_STEP_03 =
  "Your Milōn finance team turns the analysis and business context into clear recommendations, a 13-week cash forecast, and an action plan.";

export const BRIDGE_DRAFT_LABEL = "Your AI finance team drafts";
export const BRIDGE_DRAFT_BODY =
  "It prepares the first version of the analysis and the advisory deliverables.";

/**
 * One sentence under the firm-page team heading. Does not claim sign-off
 * blocks every figure from the owner: unsigned packs can still be seen.
 */
export const FIRM_NOT_A_BOOKKEEPER =
  "Not an AI bookkeeper or AI accountant that replaces your firm: the books stay in QuickBooks Online or Xero. Sage is coming soon, and you review and sign off every advisory pack.";

/** Three people on /for-accountants. What they do, what leaves the accountant's plate, and what the client gets. */
export const FIRM_TEAM_BULLETS = [
  {
    title: "Milōn Financial Manager runs the team.",
    body: "Keeps the books data clean from QuickBooks or Xero (Sage is coming soon), holds the 13-week cash view and the budget, lines up the action points, and hands the pack to you. The month-end pull and the first draft come off your plate, so the time you used to spend assembling the file goes back to the client. They get a cash picture they can act on while there is still time.",
  },
  {
    title: "Milōn Analyst diagnoses the numbers.",
    body: "Reads the health score, the ratios and the variances as a diagnosis: why margins moved, and where cash is leaking. You stop rebuilding that story by hand for every client. The workings become a review, and the client finally hears the reason behind the number.",
  },
  {
    title: "Milōn Advisor prepares the next move.",
    body: "Turns the diagnosis into the next moves and the advisory deliverables, ready for your sign-off. You edit and approve instead of starting from a blank page. The client leaves with advice they can trust, because someone at the firm approved it.",
  },
] as const;

/** Role strip on the homepage. Same three people, told as benefits. */
export const FINANCE_TEAM = [
  {
    name: "Milōn Financial Manager",
    body: "Runs the team. Keeps the books data clean from QuickBooks or Xero (Sage is coming soon), holds the 13-week cash view and the budget, and lines up the action points. The month-end pull and the hand-off pack come off the accountant's plate, so the review starts from a prepared file. Clients see the cash picture while they can still use it.",
    bold: "You review and approve the hand-off.",
  },
  {
    name: "Milōn Analyst",
    body: "Explains the health score, the ratios and the variances as a diagnosis: why margins moved, and where cash is leaking. The accountant no longer rebuilds that story for every client. The time in the workings becomes a review the client can follow.",
    bold: "The client hears why the numbers moved.",
  },
  {
    name: "Milōn Advisor",
    body: "Writes the next moves and the advisory deliverables so they are ready for sign-off. The accountant edits and approves instead of drafting from scratch, and the client gets advice they can trust because the firm stayed in control.",
    bold: "Ready for your sign-off.",
  },
] as const;

export const WATCH_EYEBROW = "See it in 30 seconds";
export const WATCH_TITLE = "Two seats. One workspace.";
export const WATCH_SUB =
  "The accountant runs the analysis and signs off every advisory pack. The owner sees exactly what to do next to grow the business, protect cash and improve margins.";

export const ACCOUNTANT_TEASER = {
  label: "For accounting firms",
  title: "The accountant's view",
  meta: "0:30",
  videoId: "oILDudRd7Qk",
  accessibleName:
    "Milōn for accountants: 30-second walkthrough of the AI finance team drafting a client advisory pack",
  imageAlt:
    "Milōn for accountants: 30-second walkthrough of the AI finance team drafting a client advisory pack",
} as const;

export const OWNER_TEASER = {
  label: "For business owners",
  title: "The owner's view",
  meta: "0:30",
  videoId: "EhIFIdez-1M",
  accessibleName:
    "Milōn for owners: 30-second walkthrough of the health score, 13-week cash forecast and next moves",
  imageAlt:
    "Milōn for owners: 30-second walkthrough of the health score, 13-week cash forecast and next moves",
} as const;

export const OWNER_TEASER_LINK = OWNER_SIGNUP_LINK;

/** Kept for older imports. The register form no longer prints it. */
export const AI_USE_LEAD = "";

export const DASH_ARIA_LABEL =
  "Sample client dashboard: health score 78 with four pillar scores and a 13-week cash forecast showing a dip in week 6";

export const PRICING_H2_USD = "Flat USD pricing by active clients, Starter to Scale.";
export const PRICING_INTRO =
  "One monthly price, set by how many clients you actively advise. Start on Starter and move up a band as your client list grows.";
/**
 * VERIFY-2 confirmed. Checkout creates a subscription on the chosen band price
 * (`firmCheckoutSessionParams`: `trial_period_days` 14, `payment_method_collection: "always"`).
 * The paid band bills that price when the trial ends and a card is on file.
 */
export const PRICING_OWNER_BAR_US = "$39/mo · free when your accountant is on Milōn";
export const OWNER_OFFER_LABEL = "For business owners";
export const PRICING_OWNER_CTA = OWNER_SIGNUP_LINK;
export const SOLO_TRIAL_BUTTON = "Start my 14-day free trial";
export const SOLO_CARD_NOTE = "";

/** Same label as /for-accountants. Do not fork a second trial string. */
export const NAV_TRIAL_LABEL = FIRM_TRIAL_CTA_LABEL;
export const NAV_TRIAL_ARIA = "Start my 14-day free trial";

export const PROOF_EYEBROW = "Proof, not promises";
export const PROOF_H2 = "Every number shows its workings. Every sign-off leaves a trail.";

export const PROOF_RATIO_BODY =
  "Gross profit to labour, sales per employee and revenue growth each show the figures behind them, so you can see how the number was built.";
export const PROOF_SIGNOFF_BODY =
  "The AI team prepares the pack. Your accountant reviews and approves it, so the client gets advice they can trust and the firm keeps control.";
export const PROOF_BOT_BODY =
  "The Advisor's next moves sit ready for review. You request changes or sign off, then send the pack the firm has approved.";

export const PROOF_CARDS = [
  {
    id: "ratio",
    title: "Workings on every ratio",
    body: PROOF_RATIO_BODY,
    alt: "Sample client ratios filled in: days sales outstanding 45 days, gross profit to labour 1.82 times, sales per employee $128k per head, and revenue growth 12.7 percent, each with the figures used",
    base: "ratio-dso",
    width: 1600,
    height: 956,
  },
  {
    id: "signoff",
    title: "Your accountant approves it",
    body: PROOF_SIGNOFF_BODY,
    alt: "Advisory pack for Harbour Glass signed off by Ada Mbeki of Harbour & Co on Oct 2, 2026",
    base: "signoff-stamp",
    width: 1600,
    height: 444,
  },
  {
    id: "plan",
    title: "Ready for the client",
    body: PROOF_BOT_BODY,
    alt: "Action plan for Harbour Glass ready for review, with Request changes and Sign off action plan",
    base: "action-plan-review",
    width: 1600,
    height: 410,
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

export const PROOF_SECURITY_FACTS = [
  "Less time per client: the team pulls the figures and writes the first draft, and you keep the judgement.",
  "Better accuracy: the health score, the ratios and the cash view all come from the same QuickBooks or Xero file. Sage is coming soon.",
  "A Financial Manager, an Analyst and an Advisor, for a small monthly fee.",
  "Clients' figures come alive as a diagnosis: why margins moved, and where cash is leaking.",
  "Advisory deliverables are ready to send once you sign off.",
  "QuickBooks and Xero connect into the same workspace. Sage is coming soon.",
  "Invoices, bills and receipts can come in from the client. A named person approves before anything is posted to the books. Nothing posts on its own.",
  "Firms lead the move to AI, and help their clients adopt it in the finance work they already trust you to do.",
] as const;

export const FAQ_MORE_LEAD = "More questions: ";
export const FAQ_MORE_LINK = "all questions";

/** Must match the homepage cost question in `HOMEPAGE_FAQ_ITEMS`. */
export const HOMEPAGE_COST_QUESTION = "What does it cost?";

/**
 * Visible homepage FAQ. Pass the server rand sentence only for a ZA visitor.
 * JSON-LD must call this with `false` so the graph stays USD on every geo.
 */
export function homepageFaqItems(showSaPricing: boolean, zaOwnerCost?: string | null): FaqItem[] {
  const replacement = showSaPricing && zaOwnerCost ? zaOwnerCost : null;
  return HOMEPAGE_FAQ_ITEMS.map((item) =>
    item.question === HOMEPAGE_COST_QUESTION && replacement
      ? { ...item, answer: item.answer.replace(HOMEPAGE_OWNER_COST_US, replacement) }
      : item,
  );
}
