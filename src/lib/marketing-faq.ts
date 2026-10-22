import { LIST_PRICES } from "./market/marketing";
import { OWNER_MONTHLY_USD_LABEL } from "./owner-plan";
import { FIRM_BAND_CATALOG, FIRM_TRIAL_CARD_NOTE, FIRM_TRIAL_SENTENCE } from "./stripe-plans";
import type { FaqItem } from "./seo";

/** Visible /faq answer and FAQPage schema for this question must stay identical. */
export const ACCOUNTING_SOFTWARE_ANSWER =
  "Milōn is not a ledger, so you keep your existing accounting system and books. Connect QuickBooks Online or Xero. Sage is coming soon. Or upload the financial statements you already have — PDF, Excel, CSV, or a bank statement — and Milōn turns them into a financial health score, a 13-week cash forecast, and ranked next moves you can review and act on.";

/** Visible /faq answer and FAQPage schema for this question must stay identical. */
export const LEDGER_CONNECT_QUESTION = "Does Milōn work with QuickBooks or Xero?";

export const LEDGER_CONNECT_ANSWER =
  "Yes. Connect QuickBooks Online or Xero. Sage is coming soon. Milōn reads the profit and loss and balance sheet. You do not need either system — a PDF, Excel file, CSV, or bank statement still works. Milōn is not a ledger and does not replace QuickBooks Online or Xero.";

/**
 * Ask-AI sanitizer strips identifiers (tax IDs, account numbers, company-name
 * heuristics) — not monetary amounts. Marketing must not claim amounts are removed.
 */
export const AI_IDENTIFIERS_LINE =
  "Identifiers (company names, tax IDs, account numbers) are stripped before model calls; amounts stay so workings and accountant sign-off use real figures.";

/** Approved disclosure. Visible /faq answer and FAQPage JSON-LD share this sentence. Not used on the homepage FAQ. */
export const AI_MODEL_DISCLOSURE =
  "Milōn Bot prepares draft recommendations for accountant review. Identifiers are stripped from the text we send; uploaded PDF statements are read as-is to extract the figures. Not used to train models.";

/** Live promo FOUNDING / FOUNDING50. Monthly paid Solo+ after the trial; does not stack with annual. */
export const FOUNDING_CALLOUT =
  "FOUNDING is 50% off monthly paid Solo+ after the trial and does not stack with annual billing.";

/** Visible US answer and FAQPage JSON-LD. The ZA page shows the server rand sentence instead. */
const ownerAMonth = OWNER_MONTHLY_USD_LABEL.replace("/mo", "");

export const FAQ_OWNER_PLAN_US =
  `${ownerAMonth} a month for a business owner's own workspace, and free when your accountant is on Milōn. Your three AI agents, Milōn Financial Manager, Milōn Analyst and Milōn Advisor, are included.`;

export const FAQ_NOT_A_BOOKKEEPER_QUESTION = "Is Milōn an AI accountant or an AI bookkeeper?";

export const FAQ_NOT_A_BOOKKEEPER_ANSWER =
  "No. Milōn is an AI finance team that works alongside your accountant. The books stay in QuickBooks or Xero. Sage is coming soon. Milōn Financial Manager keeps the books data clean, the 13-week cash view and the budget, and hands the pack to the accountant. Milōn Analyst explains why margins moved and where cash is leaking. Milōn Advisor drafts the next moves for sign-off. It does not keep the ledger, file returns or make payments. A qualified accountant reviews and approves every advisory pack.";

/** Last sentence of the homepage cost answer. USD only. ZA replaces this from the server chunk. */
export const HOMEPAGE_OWNER_COST_US =
  `Business owners pay ${OWNER_MONTHLY_USD_LABEL}, or nothing when their accountant is on Milōn.`;

const HOMEPAGE_COST_ANSWER = `Flat USD bands by active client count, from Starter at ${LIST_PRICES.us.firmStarter}/mo for up to ${FIRM_BAND_CATALOG.starter.clientLimit} clients to Scale at ${LIST_PRICES.us.firmScale}/mo for up to ${FIRM_BAND_CATALOG.scale.clientLimit}. ${FIRM_TRIAL_SENTENCE} on Starter. ${FIRM_TRIAL_CARD_NOTE} Then ${LIST_PRICES.us.firmStarter}/mo. Annual billing is about 20% off, and Enterprise is a custom quote. ${HOMEPAGE_OWNER_COST_US}`;

/**
 * Short homepage set. Visible copy and FAQPage JSON-LD must stay in lockstep.
 * Accountant objections first. The "who can see a client's figures" item is
 * omitted: VERIFY-6's "the whole firm, no browse-all" sentence is not accurate
 * (`has_client_access` includes Milōn IT, and staff need a named assignment).
 * The cost question string must stay equal to `HOMEPAGE_COST_QUESTION`.
 */
export const HOMEPAGE_FAQ_ITEMS: FaqItem[] = [
  {
    question: "Does Milōn replace the accountant?",
    answer:
      "No. Milōn works alongside your accountant. The AI team prepares the analysis, the cash view and the recommendations, and a qualified accountant reviews and approves every advisory pack. The client gets advice they can trust, and the firm keeps control. Milōn is not an accounting ledger, audit, CPA opinion, or regulated financial advice service.",
  },
  {
    question: "Do I need QuickBooks or Xero to use Milōn?",
    answer:
      "No, you do not need QuickBooks or Xero to use Milōn. When the books are already there, connect QuickBooks or Xero. Sage is coming soon. Milōn reads the profit and loss and balance sheet. You can also upload a P&L and balance sheet as a PDF, Excel file, or CSV, or upload a bank statement.",
  },
  {
    question: "What does it cost?",
    answer: HOMEPAGE_COST_ANSWER,
  },
  {
    question: "What does the AI finance team do, and what's left to me?",
    answer:
      "Milōn Financial Manager runs the team: clean books data from QuickBooks or Xero. Sage is coming soon. The 13-week cash view, the budget, the action points, and the hand-off to you stay with the firm. Milōn Analyst turns the health score, ratios and variances into a diagnosis of why margins moved and where cash is leaking. Milōn Advisor writes the next moves and the advisory deliverables, ready for sign-off. That prep comes off your plate. You review, edit and approve every pack, so the client gets advice they can trust.",
  },
  {
    question: "What happens when the trial ends?",
    answer:
      `The trial is Starter: ${FIRM_TRIAL_SENTENCE}. ${FIRM_TRIAL_CARD_NOTE} Then ${LIST_PRICES.us.firmStarter}/mo. You keep the same workspace, the same clients, and the packs your accountant has already approved.`,
  },
];
