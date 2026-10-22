import { formatMoney } from "../market/format.ts";
import { ZA_MARKET } from "../market/resolve.ts";
import { perClientRands, ZA_CHECKOUT_BANDS, ZA_MONTHLY_RANDS } from "./za-ladder.ts";
import { zaBandAmountCents } from "./za-ladder-amounts.ts";
import { FIRM_BAND_CATALOG, FIRM_TRIAL_CARD_NOTE, FIRM_TRIAL_SENTENCE } from "../stripe-plans.ts";

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

function rand(amount: number): string {
  return formatMoney(amount, ZA_MARKET);
}

function priceLine(
  monthlyRands: number,
  annualCents: number,
  cap: number,
  interval: "month" | "year",
): string {
  const per = perClientRands(monthlyRands, cap);
  const amount = interval === "year" ? rand(annualCents / 100) : rand(monthlyRands);
  const unit = interval === "year" ? "yr" : "mo";
  return `${amount}/${unit} · about ${rand(per)} per client`;
}

let saPricingCopyOverride: (() => SaPricingCopy) | null = null;

/** Tests only. Pass a throw to simulate a failed rand quote. */
export function setSaPricingCopyForTests(loader: (() => SaPricingCopy) | null): void {
  saPricingCopyOverride = loader;
}

/** All visitor-facing rand sentences. Import only from server code. */
export function loadSaPricingCopy(): SaPricingCopy {
  if (saPricingCopyOverride) return saPricingCopyOverride();
  const labels = {} as SaPricingCopy["labels"];
  for (const band of ZA_CHECKOUT_BANDS) {
    const monthly = ZA_MONTHLY_RANDS[band];
    const cap = FIRM_BAND_CATALOG[band].clientLimit ?? 1;
    const annualCents = zaBandAmountCents(band, "year");
    labels[band] = {
      month: priceLine(monthly, annualCents, cap, "month"),
      year: priceLine(monthly, annualCents, cap, "year"),
    };
  }
  return {
    heading: "Pricing in rand",
    heroNote: `${FIRM_TRIAL_SENTENCE} on Starter. ${FIRM_TRIAL_CARD_NOTE} Then ${rand(299)}/mo.`,
    trialAfter: `On Starter. ${FIRM_TRIAL_CARD_NOTE} Then ${rand(299)}/mo.`,
    accountantsIntro:
      "Pricing in rand. One monthly price, set by how many clients you actively advise.",
    accountantsLead:
      "Management accounts, 13-week cash and advisory drafts from QuickBooks or Xero. Sage is coming soon.",
    ownerHomepageCost: `Business owners pay ${rand(299)}/mo, or nothing when their accountant is on Milōn.`,
    ownerBar: `${rand(299)}/mo · free when your accountant is on Milōn`,
    ownerHeroLink: `Business owner? ${rand(299)}/mo, or free when your accountant is on Milōn →`,
    ownerRegisterNote: `Business owners pay ${rand(299)}/mo, or nothing when their accountant is on Milōn.`,
    ownerEarly: `The owner plan is ${rand(299)} a month, and free when your accountant is on Milōn. If something in the product is not finished, we tell you inside the product rather than hiding it.`,
    ownerMonthly: `${rand(299)}/mo`,
    faqCostLead: `Business owners: ${rand(299)} a month, or free when your accountant is on Milōn.`,
    ownerPlanAnswer: `${rand(299)} a month, and free when your accountant is on Milōn.`,
    footerTagline: "for accounting firms and the businesses they advise.",
    footerBuilt: "An AI finance team for accounting firms",
    footerLine: "Milōn — an AI finance team for accounting firms and the businesses they advise.",
    labels,
  };
}
