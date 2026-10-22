import { FIRM_TRIAL_CARD_NOTE, FIRM_TRIAL_SENTENCE } from "../stripe-plans.ts";
import { quotePrice } from "./price-quote.server.ts";
import { ZA_CHECKOUT_BANDS } from "./za-lookup.ts";

export type ZaBandPriceLabel = { month: string; year: string };

export type SaPricingCopy = {
  heading: string;
  heroNote: string;
  /** Pricing-bar line under the shared trial sentence. Rand only. */
  trialAfter: string;
  accountantsIntro: string;
  accountantsLead: string;
  footerTagline: string;
  footerBuilt: string;
  footerLine: string;
  /** Owner-plan sentences. Rand only. Never import this module from client code. */
  ownerHomepageCost: string;
  ownerBar: string;
  ownerHeroLink: string;
  ownerRegisterNote: string;
  ownerEarly: string;
  ownerMonthly: string;
  faqCostLead: string;
  ownerPlanAnswer: string;
  labels: Record<(typeof ZA_CHECKOUT_BANDS)[number], ZaBandPriceLabel>;
};

function bandLabel(band: (typeof ZA_CHECKOUT_BANDS)[number], interval: "month" | "year"): string {
  return quotePrice({ market: "za", plan: band, interval, surface: "visitor" })?.label ?? "";
}

function ownerMonthly(): string {
  return quotePrice({ market: "za", plan: "owner", interval: "month", surface: "owner" })?.label ?? "";
}

function starterMonthly(): string {
  return quotePrice({ market: "za", plan: "starter", interval: "month", surface: "signup" })?.label ?? "";
}

let saPricingCopyOverride: (() => SaPricingCopy) | null = null;

/** Tests only. Pass a throw to simulate a failed rand quote. */
export function setSaPricingCopyForTests(loader: (() => SaPricingCopy) | null): void {
  saPricingCopyOverride = loader;
}

/** All visitor-facing rand sentences. Import only from server code. */
export function loadSaPricingCopy(): SaPricingCopy {
  if (saPricingCopyOverride) return saPricingCopyOverride();
  const owner = ownerMonthly();
  const starter = starterMonthly();
  const labels = {} as SaPricingCopy["labels"];
  for (const band of ZA_CHECKOUT_BANDS) {
    labels[band] = {
      month: bandLabel(band, "month"),
      year: bandLabel(band, "year"),
    };
  }
  return {
    heading: "Pricing in rand",
    heroNote: `${FIRM_TRIAL_SENTENCE} on Starter. ${FIRM_TRIAL_CARD_NOTE} Then ${starter}.`,
    trialAfter: `On Starter. ${FIRM_TRIAL_CARD_NOTE} Then ${starter}.`,
    accountantsIntro:
      "Pricing in rand. One monthly price, set by how many clients you actively advise.",
    accountantsLead:
      "Management accounts, 13-week cash and advisory drafts from QuickBooks or Xero. Sage is coming soon.",
    ownerHomepageCost: `Business owners pay ${owner}, or nothing when their accountant is on Milōn.`,
    ownerBar: `${owner} · free when your accountant is on Milōn`,
    ownerHeroLink: `Business owner? ${owner}, or free when your accountant is on Milōn →`,
    ownerRegisterNote: `Business owners pay ${owner}, or nothing when their accountant is on Milōn.`,
    ownerEarly: `The owner plan is ${owner.replace("/mo", "")} a month, and free when your accountant is on Milōn. If something in the product is not finished, we tell you inside the product rather than hiding it.`,
    ownerMonthly: owner,
    faqCostLead: `Business owners: ${owner.replace("/mo", "")} a month, or free when your accountant is on Milōn.`,
    ownerPlanAnswer: `${owner.replace("/mo", "")} a month, and free when your accountant is on Milōn.`,
    footerTagline: "for accounting firms and the businesses they advise.",
    footerBuilt: "An AI finance team for accounting firms",
    footerLine: "Milōn — an AI finance team for accounting firms and the businesses they advise.",
    labels,
  };
}
