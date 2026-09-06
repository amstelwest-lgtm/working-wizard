/**
 * Sample business for a first-time owner who wants to see a scored board
 * before uploading anything. Illustrative only — never persisted, and the
 * board is stamped "Sample" the whole time it is on screen.
 *
 * Both sets describe the same shape of business (a 9–12 person services
 * company with some stock, ~45-day debtors, modest asset finance) so ZA and
 * US owners see comparable stories in their own currency.
 */

import type { MarketId } from "@/lib/market";

export type SampleFinancials = Record<string, string>;

const ZA_SAMPLE: SampleFinancials = {
  revenue: "6400000",
  priorRevenue: "5700000",
  cogs: "2560000",
  variableCosts: "2560000",
  fixedCosts: "2900000",
  laborCost: "2100000",
  ebitda: "940000",
  ebit: "760000",
  ebt: "640000",
  netIncome: "460000",
  operatingCashflow: "610000",
  totalAssets: "3800000",
  equity: "1900000",
  currentAssets: "1450000",
  currentLiabilities: "900000",
  receivables: "790000",
  inventory: "210000",
  payables: "350000",
  top5Revenue: "2300000",
  employees: "12",
  founderHours: "2600",
  capex: "240000",
  ppeGross: "2600000",
  accumulatedDepreciation: "950000",
  priorPpeGross: "2360000",
  priorAccumDep: "770000",
};

const US_SAMPLE: SampleFinancials = {
  revenue: "1150000",
  priorRevenue: "1020000",
  cogs: "460000",
  variableCosts: "460000",
  fixedCosts: "520000",
  laborCost: "380000",
  ebitda: "170000",
  ebit: "135000",
  ebt: "115000",
  netIncome: "90000",
  operatingCashflow: "110000",
  totalAssets: "690000",
  equity: "340000",
  currentAssets: "262000",
  currentLiabilities: "160000",
  receivables: "142000",
  inventory: "38000",
  payables: "63000",
  top5Revenue: "410000",
  employees: "9",
  founderHours: "2500",
  capex: "42000",
  ppeGross: "470000",
  accumulatedDepreciation: "170000",
  priorPpeGross: "428000",
  priorAccumDep: "138000",
};

export function sampleFinancialsFor(country: MarketId): SampleFinancials {
  return country === "US" ? US_SAMPLE : ZA_SAMPLE;
}

export const SAMPLE_BUSINESS_BLURB =
  "A 12-person services business with some stock, customers paying in about 45 days and a little asset finance. Every number on the board is illustrative.";
