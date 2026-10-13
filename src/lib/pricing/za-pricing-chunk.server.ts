import { FIRM_BAND_CATALOG } from "@/lib/stripe-plans";
import { perClientRands, ZA_CHECKOUT_BANDS, ZA_MONTHLY_RANDS } from "@/lib/pricing/za-ladder";
import { zaBandAmountCents } from "@/lib/pricing/za-ladder-amounts";

export type ZaBandPriceLabel = { month: string; year: string };

export type SaPricingCopy = {
  heading: string;
  heroNote: string;
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
  return `R${amount.toLocaleString("en-US")}`;
}

function priceLine(monthlyRands: number, annualCents: number, cap: number, interval: "month" | "year"): string {
  const per = perClientRands(monthlyRands, cap);
  const amount = interval === "year" ? rand(annualCents / 100) : rand(monthlyRands);
  const unit = interval === "year" ? "yr" : "mo";
  return `${amount}/${unit} · about ${rand(per)} per client`;
}

/** All visitor-facing rand sentences. Import only from server code. */
export function loadSaPricingCopy(): SaPricingCopy {
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
    heroNote: "Plans from R299/mo after day 14.",
    accountantsIntro:
      "Pricing in rand. One monthly price, set by how many clients you actively advise.",
    accountantsLead:
      "Management accounts, 13-week cash and advisory drafts from QuickBooks, Xero or Sage.",
    ownerHomepageCost:
      "Business owners pay R199/mo, or nothing when their accountant is on Milōn.",
    ownerBar: "R199/mo · free when your accountant is on Milōn",
    ownerHeroLink: "Business owner? R199/mo, or free when your accountant is on Milōn →",
    ownerRegisterNote:
      "Business owners pay R199/mo, or nothing when their accountant is on Milōn.",
    ownerEarly:
      "The owner plan is R199 a month, and free when your accountant is on Milōn. If something in the product is not finished, we tell you inside the product rather than hiding it.",
    ownerMonthly: "R199/mo",
    faqCostLead: "Business owners: R199 a month, or free when your accountant is on Milōn.",
    ownerPlanAnswer: "R199 a month, and free when your accountant is on Milōn.",
    footerTagline: "for accounting firms and the businesses they advise.",
    footerBuilt: "An AI finance team for accounting firms",
    footerLine:
      "Milōn — an AI finance team for accounting firms and the businesses they advise.",
    labels,
  };
}
