/**
 * Ratio names that feed each health pillar. Kept in its own file so marketing
 * pages can count them without pulling the scorer into the public bundle.
 */
const PILLAR_RATIO_NAMES = {
  profit: [
    "Gross Margin",
    "Operating Margin",
    "Net Margin",
    "Fixed Cost Ratio",
    "Degree of Operating Leverage",
    "Gross Profit / Labor",
    "Top-5 Customer Share",
  ],
  assets: ["Asset Turnover", "Return on Assets", "Inventory Days", "Sales-per-Employee Ratio"],
  financing: ["Equity Multiplier", "Debt-to-Equity", "Interest Burden", "Tax Burden", "Return on Equity"],
  cash: ["Debtor Days", "Creditor Days", "Working Capital Days", "OCF / EBITDA"],
} as const;

export type CataloguePillarId = keyof typeof PILLAR_RATIO_NAMES;

export { PILLAR_RATIO_NAMES };

/** Catalogue size. Marketing copy and the scorecard derive their ratio count from this. */
export const HEALTH_RATIO_COUNT = (Object.keys(PILLAR_RATIO_NAMES) as CataloguePillarId[]).reduce(
  (sum, id) => sum + PILLAR_RATIO_NAMES[id].length,
  0,
);
