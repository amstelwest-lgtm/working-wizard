import { FIRM_CARD_TIMING } from "./firm-signup-copy";
import { LIST_PRICES } from "./market/marketing";
import type { FaqItem } from "./seo";
import {
  ACCOUNTING_SOFTWARE_ANSWER,
  AI_IDENTIFIERS_LINE,
  AI_MODEL_DISCLOSURE,
  LEDGER_CONNECT_ANSWER,
  LEDGER_CONNECT_QUESTION,
  WATCHLIST_DEFINITION,
} from "./marketing-faq";

/**
 * US answers for FAQPage JSON-LD. Must match the visible US copy on /faq.
 */
export function publicFaqUsItems(): FaqItem[] {
  return [
    {
      question: "What does it cost?",
      answer: `Spark is free during early access and does not ask for a card. Accounting firms: ${FIRM_CARD_TIMING} Then they subscribe on USD client-count bands billed through Stripe Checkout — Solo starts at ${LIST_PRICES.us.firmSolo} a month, and Scale is ${LIST_PRICES.us.firmScale} a month. Annual billing is about 20% off. ${WATCHLIST_DEFINITION} Enterprise is a custom quote.`,
    },
    {
      question: "So what is the catch with free?",
      answer:
        "You are early, and early users shape what gets built. Spark stays free during early access. Accounting firms see their first client's figures with no card, then add a card to start a 14-day free trial (up to 3 clients). After day 14 they pay a flat USD band by active client count through Stripe Checkout.",
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
      answer: `We use AI. ${AI_MODEL_DISCLOSURE} ${AI_IDENTIFIERS_LINE} Where an AI drafts a report for an accountant, a human reads and signs off every advisory pack. The AI notice at https://www.milonfinance.com/ai is the public version of that sentence.`,
    },
    {
      question: "Do you store card details?",
      answer:
        "No. Card numbers are collected by Stripe Checkout. Milōn does not store card details.",
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
      answer: ACCOUNTING_SOFTWARE_ANSWER,
    },
    {
      question: LEDGER_CONNECT_QUESTION,
      answer: LEDGER_CONNECT_ANSWER,
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

/** Visible /faq answers that must match FAQPage JSON-LD. US by default. */
export function publicFaqItems(_showSaPricing: boolean): FaqItem[] {
  return publicFaqUsItems();
}
