/**
 * Flow fields that scale with the stored figures cover. Stock fields do not.
 * ratios.ts checks these names against RatioInputs. This file stays free of
 * that import so the /talk edge can load it.
 */
export const FLOW_FIELD_KEYS = [
  "revenue",
  "cogs",
  "ebit",
  "ebt",
  "netIncome",
  "ebitda",
  "operatingCashflow",
  "fixedCosts",
  "variableCosts",
  "top5Revenue",
  "laborCost",
] as const;
