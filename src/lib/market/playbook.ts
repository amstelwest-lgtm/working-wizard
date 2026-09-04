import { localizeCopy } from "./copy";
import type { ResolvedMarket } from "./types";

/** Steps that only make sense in South Africa (SARS, SETA, local banks, etc.). */
const ZA_ONLY =
  /South African|South Africa|\bSARS\b|\bSETA\b|Section 189|Section 11\(a\)|Companies Act|\bSEDA\b|\bIDC\b|\bABSA\b|\bNedbank\b|\bFNB\b|Standard Bank|32-day notice|Income Tax Act|business rescue|skills development lev|\bSARB\b|CPI \(approximately 5|dti\b|SETA grants/i;

const SALES_TAX_ONLY = /collect sales tax|sales-tax remittance|sales tax collected/i;

export type PlaybookMarketTag = "ZA" | "US";

export type PlaybookMarketFields = {
  step_title: string;
  step_description: string;
  markets?: PlaybookMarketTag[];
};

export function isZaOnlyPlaybookStep(step: PlaybookMarketFields): boolean {
  if (step.markets?.length) {
    return step.markets.includes("ZA") && !step.markets.includes("US");
  }
  return ZA_ONLY.test(`${step.step_title} ${step.step_description}`);
}

export function playbookStepFitsMarket(
  step: PlaybookMarketFields,
  market: Pick<ResolvedMarket, "country" | "copyPack" | "tax">,
): boolean {
  if (isZaOnlyPlaybookStep(step) && market.country !== "ZA") return false;
  if (market.tax.regime !== "sales_tax" && SALES_TAX_ONLY.test(step.step_description)) {
    return false;
  }
  return true;
}

export function localizePlaybookStep<T extends PlaybookMarketFields>(
  step: T,
  market: Pick<ResolvedMarket, "copyPack" | "currency">,
): T {
  if (market.copyPack !== "us") return step;
  return {
    ...step,
    step_title: localizeCopy(step.step_title, market),
    step_description: localizeCopy(step.step_description, market),
  };
}
