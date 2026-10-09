import { FIRM_CARD_TIMING } from "./firm-signup-copy";
import { LIST_PRICES } from "./market/marketing";
import { FIRM_BAND_CATALOG } from "./stripe-plans";
import type { FaqItem } from "./seo";

/** Visible /faq answer and FAQPage schema for this question must stay identical. */
export const ACCOUNTING_SOFTWARE_ANSWER =
  "MILŌN is not a ledger, so you keep your existing accounting system and books. Connect QuickBooks Online or Xero, or upload the financial statements you already have — PDF, Excel, CSV, or a bank statement — and MILŌN turns them into a financial health score, a 13-week cash forecast, and ranked next moves you can review and act on.";

/** Visible /faq answer and FAQPage schema for this question must stay identical. */
export const LEDGER_CONNECT_QUESTION = "Does MILŌN work with QuickBooks or Xero?";

export const LEDGER_CONNECT_ANSWER =
  "Yes. Connect QuickBooks Online or Xero and MILŌN reads the profit and loss and balance sheet. You do not need either system — a PDF, Excel file, CSV, or bank statement still works. MILŌN is not a ledger and does not replace QuickBooks Online or Xero.";

/**
 * Ask-AI sanitizer strips identifiers (VAT/tax IDs, account numbers, company-name
 * heuristics) — not monetary amounts. Marketing must not claim amounts are removed.
 */
export const AI_IDENTIFIERS_LINE =
  "Identifiers (company names, tax IDs, account numbers) are stripped before model calls; amounts stay so workings and accountant sign-off use real figures.";

/** Approved disclosure. Visible /faq answer and FAQPage JSON-LD share this sentence. Not used on the homepage FAQ. */
export const AI_MODEL_DISCLOSURE =
  "Milōn Bot prepares draft recommendations for accountant review. Identifiers are stripped from the text we send; uploaded PDF statements are read as-is to extract the figures. Not used to train models.";

/** Monitoring seat, not a billed advisory client. Stripe does not line-item these. */
export const WATCHLIST_DEFINITION =
  "Watchlist clients stay on your radar at no charge — they don't count toward billed seats until you activate a full workspace.";

/** Live Stripe promo FOUNDING / FOUNDING50. Monthly paid Solo+ after the trial; does not stack with annual. */
export const FOUNDING_CALLOUT =
  "FOUNDING is 50% off monthly paid Solo+ after the trial and does not stack with annual billing.";

const HOMEPAGE_COST_ANSWER = `Flat USD bands by active client count, from Solo at ${LIST_PRICES.us.firmSolo}/mo for up to ${FIRM_BAND_CATALOG.solo.clientLimit} clients to Scale at ${LIST_PRICES.us.firmScale}/mo for up to ${FIRM_BAND_CATALOG.scale.clientLimit}. Annual billing is about 20% off, and Enterprise is a custom quote. ${FIRM_CARD_TIMING} Business owners can start free on Spark during early access, no card needed.`;

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
      "No, MILŌN works alongside your accountant to provide financial analysis, financial health insights, cash-flow forecasting, and practical recommendations. AI prepares the analysis using your financial information, while a qualified accountant reviews and signs off every advisory pack. MILŌN is not an accounting ledger, audit, CPA opinion, or regulated financial advice service.",
  },
  {
    question: "Is client data used to train AI models?",
    answer:
      "No. Client financial information isn't used to train third-party AI models. Amounts stay as they are, so the workings and your sign-off use real figures. The AI notice explains how AI is used in Milōn.",
  },
  {
    question: "Do I need QuickBooks or Xero to use Milōn?",
    answer:
      "No, you do not need QuickBooks or Xero to use MILŌN. When the books are already there, connect QuickBooks Online or Xero and MILŌN reads the profit and loss and balance sheet. You can also upload a P&L and balance sheet as a PDF, Excel file, or CSV, or upload a bank statement.",
  },
  {
    question: "What does it cost?",
    answer: HOMEPAGE_COST_ANSWER,
  },
  {
    question: "What does the AI finance team do, and what's left to me?",
    answer:
      "Three AI agents work in Milōn Bot from the client's QuickBooks Online, Xero or uploaded figures. Milōn Bookkeeper checks the books are up to date and flags what's missing. Milōn Analyst calculates the health score and 19 ratios, compares budget vs actual and builds the 13-week cash forecast. Milōn Advisor watches the cash floor and debtors and drafts next moves and the advisory deliverables. Each works only from what's on file and stops when a decision needs you. You review, edit and sign off every advisory pack.",
  },
  {
    question: "What happens when the trial ends?",
    answer: `${FIRM_CARD_TIMING} After day 14 your chosen band bills automatically through Stripe Checkout. Milōn never stores card details, and you can delete your account and its data from Settings.`,
  },
];
