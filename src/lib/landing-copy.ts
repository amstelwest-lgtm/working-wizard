import { LIST_PRICES } from "@/lib/market/marketing";
import {
  HOMEPAGE_FAQ_ITEMS,
  SA_PRODUCT_ANSWER,
  SA_PRODUCT_QUESTION,
  publicFaqUsItems,
} from "@/lib/marketing-faq";
import type { FaqItem } from "@/lib/seo";
import { FIRM_TRIAL_SENTENCE } from "@/lib/stripe-plans";

/** Empty unless VITE_WALKTHROUGH_URL is set. The hero slot stays unrendered. */
export const WALKTHROUGH_URL = String(import.meta.env.VITE_WALKTHROUGH_URL ?? "").trim();

export const HERO_BADGE = "For accounting firms and the businesses they advise";
export const HERO_H1_LEAD = "QuickBooks Online and Xero,";
export const HERO_H1_GOLD = "plug-and-play.";
export const HERO_LEDE =
  "Milōn Bot reads the numbers, diagnoses the business, and drafts the advisory deliverables. The accountant reviews and signs off.";
export const HERO_CTA_LABEL = "Start my 14-day free trial";
export const HERO_WALKTHROUGH_LABEL = "Book a 30-min walkthrough";
export const HERO_CTA_NOTE = `${FIRM_TRIAL_SENTENCE}. Card on file. Plans from ${LIST_PRICES.us.firmSolo}/mo after day 14.`;
export const HERO_CONTACT_EMAIL = "hello@milonfinance.com";
export const HERO_CONTACT_HREF =
  "mailto:hello@milonfinance.com?subject=Question%20about%20Mil%C5%8Dn";
export const HERO_OWNER_PREFIX = "Business owner?";
export const HERO_OWNER_LINK = "Spark is free during early access, no card needed →";

/**
 * VERIFY-1. Unsigned packs, recommendations, and a cash-forecast email can
 * reach the owner before an accountant signs off, so the line does not claim
 * that sign-off gates what the client sees.
 */
export const HERO_SIGNOFF_POINT = "You review and sign off every advisory pack.";

export const HERO_POINTS = [
  "Connect a client's QuickBooks Online or Xero file, or upload a P&L and balance sheet.",
  "Milōn Bot builds the health score, 13-week cash forecast and action plan.",
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
  "Milōn Bot turns the analysis and business context into clear recommendations, a 13-week cash forecast, and an action plan.";

export const BRIDGE_DRAFT_LABEL = "Milōn Bot drafts";
export const BRIDGE_DRAFT_BODY =
  "It prepares the first version of the analysis and the advisory deliverables.";

export const ACCOUNTANTS_DRAFT_BULLET =
  "Milōn Bot writes the first draft from the client's actual numbers. You correct, sign off, and send — the judgement stays yours.";

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

/** ZA-only. Never render unless the server saw x-vercel-ip-country === "ZA". */
export const SA_ZAR_LINE = "South African firms can pay in ZAR at Checkout.";
export const SA_FOUNDING_LINE =
  "FOUNDING: 50% off monthly paid plans after the trial. Doesn't combine with annual billing.";

export const AI_USE_LEAD = "How we use AI is set out in our";

export const DASH_ARIA_LABEL =
  "Sample client dashboard: health score 78 with four pillar scores and a 13-week cash forecast showing a dip in week 6";

export const PRICING_H2_USD = "USD bands by client count.";
export const PRICING_H2_ZAR = "ZAR at Checkout.";

const HOMEPAGE_COST_QUESTION = "How do I get started, and what does MILŌN cost?";
const PUBLIC_COST_QUESTION = "What does it cost?";

export function withSaPricingLines(answer: string, showSaPricing: boolean): string {
  if (!showSaPricing) return answer;
  return `${answer} ${SA_ZAR_LINE} ${SA_FOUNDING_LINE}`;
}

/** Visible homepage FAQ and its FAQPage JSON-LD. US by default. */
export function homepageFaqItems(showSaPricing: boolean): FaqItem[] {
  return HOMEPAGE_FAQ_ITEMS.map((item) =>
    item.question === HOMEPAGE_COST_QUESTION
      ? { ...item, answer: withSaPricingLines(item.answer, showSaPricing) }
      : item,
  );
}

/** Visible /faq answers that must match FAQPage JSON-LD. US by default. */
export function publicFaqItems(showSaPricing: boolean): FaqItem[] {
  const items = publicFaqUsItems().map((item) =>
    item.question === PUBLIC_COST_QUESTION
      ? { ...item, answer: withSaPricingLines(item.answer, showSaPricing) }
      : item,
  );
  if (!showSaPricing) return items;
  return [...items, { question: SA_PRODUCT_QUESTION, answer: SA_PRODUCT_ANSWER }];
}
