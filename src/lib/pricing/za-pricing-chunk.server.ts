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
    heading: "South African pricing, in rand",
    heroNote: "Plans from R799/mo for SA firms after day 14.",
    accountantsIntro:
      "South African pricing, in rand. One monthly price, set by how many clients you actively advise.",
    accountantsLead:
      "Management accounts, 13-week cash and advisory drafts for South African firms on Xero and QuickBooks.",
    ownerHomepageCost:
      "Business owners pay R299/mo, or nothing when their accountant is on Milōn.",
    ownerBar: "R299/mo · free when your accountant is on Milōn",
    ownerHeroLink: "Business owner? R299/mo, or free when your accountant is on Milōn →",
    ownerRegisterNote:
      "Business owners pay R299/mo, or nothing when their accountant is on Milōn.",
    ownerEarly:
      "The owner plan is R299 a month, and free when your accountant is on Milōn. If something in the product is not finished, we tell you inside the product rather than hiding it.",
    ownerMonthly: "R299/mo",
    faqCostLead: "Business owners: R299 a month, or free when your accountant is on Milōn.",
    ownerPlanAnswer: "R299 a month in South Africa, and free when your accountant is on Milōn.",
    footerTagline:
      "for accounting firms and small businesses in South Africa and the United States.",
    footerBuilt: "Built for South Africa and the United States",
    footerLine:
      "Milōn — the AI finance function for accounting firms and the businesses they serve in South Africa and the United States.",
    labels,
  };
}
