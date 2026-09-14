import { LIST_PRICES } from "./market/marketing";
import type { FaqItem } from "./seo";

/** Short homepage set. Visible copy and FAQPage JSON-LD must stay in lockstep. */
export const HOMEPAGE_FAQ_ITEMS: FaqItem[] = [
  {
    question: "Does MILŌN replace my accountant?",
    answer:
      "No, MILŌN works alongside your accountant to provide financial analysis, financial health insights, cash-flow forecasting, and practical recommendations. AI prepares the analysis using your financial information, while a qualified accountant reviews and signs off before advice is shown to a client. MILŌN is not an accounting ledger, audit, CPA opinion, or regulated financial advice service.",
  },
  {
    question: "Do I need QuickBooks or Xero to use MILŌN?",
    answer:
      "No, you do not need QuickBooks or Xero to use MILŌN. Today, you can upload your P&L and balance sheet as a PDF, Excel file, or CSV, or upload a bank statement. MILŌN analyzes the information you provide to assess financial health, calculate key financial ratios, and identify areas that may need attention.",
  },
  {
    question: "Is my financial data used to train AI models?",
    answer:
      "No, your client financial information is not used to train third-party AI models. Financial information sent to Claude is anonymised, with company names and raw amounts removed and tax IDs stripped. Client numbers are not used to train third-party models, while AI is used within MILŌN to prepare financial analysis for human accountant review.",
  },
  {
    question: "What does MILŌN do for my business?",
    answer:
      "MILŌN turns your financial information into a clear view of your business's financial health and what may need attention. It assesses profit, assets, financing, and cash using 19 carefully selected financial ratios, including DuPont analysis, and provides a 13-week cash-flow forecast. AI then helps prepare context-driven analysis and recommendations for accountant review.",
  },
  {
    question: "How do I get started, and what does MILŌN cost?",
    answer:
      "You can start free with Spark during early access, with no card required. Upload your financial figures and MILŌN will generate a financial health score and analysis. Orbit, Constellation, and accounting-firm plans are published but are not being billed yet. Stripe billing will be available soon, so check the MILŌN landing page for updates.",
  },
];

/**
 * US answers for FAQPage JSON-LD. Must match the visible US copy on /faq.
 */
export function publicFaqUsItems(): FaqItem[] {
  return [
    {
      question: "What does it cost?",
      answer: `Spark is free during early access and does not ask for a card. Two paid tiers are published — Orbit at ${LIST_PRICES.us.orbit} a month and Constellation at ${LIST_PRICES.us.constellation} a month — but neither is being billed yet. For practices, firm pricing is planned at ${LIST_PRICES.us.firm150} a month up to 150 clients and ${LIST_PRICES.us.firmUnlimited} a month for unlimited, also not yet billed.`,
    },
    {
      question: "So what is the catch with free?",
      answer:
        "You are early, and early users shape what gets built. We get real usage and honest feedback, you get the platform without paying while it is still being finished. When billing does start you will be told before it happens, not after.",
    },
    {
      question: "What happens if I stop using it?",
      answer:
        "Nothing is held hostage. You can delete your account and its data from Settings, and deleting is immediate rather than a support ticket.",
    },
    {
      question: "Where does my data live?",
      answer:
        "In a managed PostgreSQL database behind row-level security, which means access rules are enforced by the database itself rather than by application code remembering to check. Every table that holds client data has those rules on it.",
    },
    {
      question: "Who can see my figures?",
      answer:
        "You, and anyone you explicitly invite. An accountant sees a client's workspace only when that client is linked to their firm. There is no browse-all view for other users, and sharing is something you do deliberately rather than something that happens by default.",
    },
    {
      question: "What does the AI see?",
      answer:
        "We use AI. It is powered by Claude. Financial information sent to the model is anonymised — no company names and no raw amounts — with EIN / tax IDs and account numbers stripped before anything leaves the platform. Where an AI drafts a report for an accountant, a human reads and signs it before a client ever sees it. The AI notice at https://milonfinance.com/ai is the public version of that sentence.",
    },
    {
      question: "Do you store card details?",
      answer: "No. Nothing is being billed yet, so there is nothing to store.",
    },
    {
      question: "Do you track how I use the product?",
      answer:
        "We keep product-event keys — things like “report sent” or “task completed” — so we can tell whether the product is actually working. We do not store financial amounts, ID numbers, or employee emails in that log. Magic-link clicks are stored as a hash of the link, not a name. Those raw events are kept for 24 months; the weekly totals stay.",
    },
    {
      question: "My accountant already does this.",
      answer:
        "Some of it, once a year, in a format built for compliance. The difference is frequency and direction: a score every month that points forward, instead of a set of statements that explains a year that has already happened. Most owners who try it end up inviting their accountant into the workspace, which is exactly what it is designed for.",
    },
    {
      question: "I already have accounting software.",
      answer:
        "Keep it. MILŌN is not a ledger. Upload a P&L and balance sheet as PDF, Excel, or CSV, or a bank statement — it turns the output your books already produce into a score, a forecast, and a ranked list of what to do.",
    },
    {
      question: "How accurate is the score?",
      answer:
        "It is arithmetic on the figures you give it, so it is exactly as good as those figures. Every ratio shows the numbers behind it, so you can check any part of it yourself. Where the platform is guessing or a number is missing, it says so rather than quietly filling in a plausible value.",
    },
    {
      question: "How much work is this going to be?",
      answer:
        "The first score comes from one upload. Keeping it current is a monthly habit measured in minutes, not a new system to run alongside your existing one.",
    },
    {
      question: "Is this a South African product with a dollar sign glued on?",
      answer:
        "No. Choosing the United States switches currency, dates, sales tax (not VAT), and the advice pack. It is not a rand product with the symbol swapped. US industry medians are still being built, so we show days and percentages rather than pretending SA bands are Texas ones.",
    },
    {
      question: "Why did you email me?",
      answer:
        "Because we found something specific about your business worth writing to you about, and the email should have said what it was. Every message we send is written and approved by a person, not blasted to a list.",
    },
    {
      question: "How do I make it stop?",
      answer:
        "Use the unsubscribe link at the bottom of any email, or your mail client's own unsubscribe button — both work immediately and stop the whole sequence, including anything already drafted. Replying “no thanks” works too, and we will not argue with you.",
    },
  ];
}
