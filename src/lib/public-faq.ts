import { LIST_PRICES } from "./market/marketing";
import { OWNER_MONTHLY_USD_LABEL } from "./owner-plan";
import { FIRM_BAND_CATALOG, FIRM_TRIAL_CARD_NOTE, FIRM_TRIAL_SENTENCE } from "./stripe-plans";
import type { FaqItem } from "./seo";
import {
  ACCOUNTING_SOFTWARE_ANSWER,
  AI_IDENTIFIERS_LINE,
  AI_MODEL_DISCLOSURE,
  FAQ_NOT_A_BOOKKEEPER_ANSWER,
  FAQ_NOT_A_BOOKKEEPER_QUESTION,
  FAQ_OWNER_PLAN_US,
  LEDGER_CONNECT_ANSWER,
  LEDGER_CONNECT_QUESTION,
} from "./marketing-faq";

/** Lead sentence of the cost answer. USD. The ZA page swaps this from the server chunk. */
export const FAQ_OWNER_COST_US =
  `Business owners: ${OWNER_MONTHLY_USD_LABEL.replace("/mo", "")} a month, or free when your accountant is on Milōn.`;

export {
  FAQ_NOT_A_BOOKKEEPER_ANSWER,
  FAQ_NOT_A_BOOKKEEPER_QUESTION,
  FAQ_OWNER_PLAN_US,
} from "./marketing-faq";

/**
 * US answers for FAQPage JSON-LD. Must match the visible US copy on /faq.
 */
export function publicFaqUsItems(): FaqItem[] {
  return [
    {
      question: "What does it cost?",
      answer: `${FAQ_OWNER_COST_US} Accounting firms pay on USD client-count bands — Starter is ${LIST_PRICES.us.firmStarter} a month for up to ${FIRM_BAND_CATALOG.starter.clientLimit} clients, and Scale is ${LIST_PRICES.us.firmScale} a month. ${FIRM_TRIAL_SENTENCE} on Starter. ${FIRM_TRIAL_CARD_NOTE} Then ${LIST_PRICES.us.firmStarter}/mo. Annual billing is about 20% off. Enterprise is a custom quote.`,
    },
    {
      question: "What does the owner plan cost?",
      answer: FAQ_OWNER_PLAN_US,
    },
    {
      question: "What happens if I stop using it?",
      answer:
        "You can leave whenever you want. The workspace stays available through the end of the period you have already paid for, including the packs your accountant has approved.",
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
      answer: `We use AI. ${AI_MODEL_DISCLOSURE} ${AI_IDENTIFIERS_LINE} Where an AI drafts a report for an accountant, a human reads and signs off every advisory pack. The AI notice at https://www.milonfinance.com/ai is the public version of that sentence.`,
    },
    {
      question: "Do you track how I use the product?",
      answer:
        "We keep product-event keys — things like “report sent” or “task completed” — so we can tell whether the product is actually working. We do not store financial amounts, ID numbers, or employee emails in that log. Magic-link clicks are stored as a hash of the link, not a name. Those raw events are kept for 24 months; the weekly totals stay.",
    },
    {
      question: FAQ_NOT_A_BOOKKEEPER_QUESTION,
      answer: FAQ_NOT_A_BOOKKEEPER_ANSWER,
    },
    {
      question: "My accountant already does this.",
      answer:
        "Some of it, once a year, in a format built for compliance. The difference is frequency and direction: a score every month that points forward, instead of a set of statements that explains a year that has already happened. Most owners who try it end up inviting their accountant into the workspace, which is exactly what it is designed for.",
    },
    {
      question: "I already have accounting software.",
      answer: ACCOUNTING_SOFTWARE_ANSWER,
    },
    {
      question: LEDGER_CONNECT_QUESTION,
      answer: LEDGER_CONNECT_ANSWER,
    },
    {
      question: "How accurate is the score?",
      answer:
        "It is arithmetic on the figures you give it, so it is exactly as good as those figures. Every ratio shows the numbers behind it, so you can check any part of it yourself.",
    },
    {
      question: "How much work is this going to be?",
      answer:
        "The first score comes from one upload. Keeping it current is a monthly habit measured in minutes, not a new system to run alongside your existing one.",
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

/** Visible /faq answers that must match FAQPage JSON-LD. US by default. */
export function publicFaqItems(_showSaPricing: boolean): FaqItem[] {
  return publicFaqUsItems();
}
