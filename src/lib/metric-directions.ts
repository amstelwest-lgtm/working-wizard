/**
 * Scored-metric registry. Overview, Health, the scorecard, and /talk import
 * this list. Do not keep a second copy of the names.
 */
export type MetricDirection = "higher_is_better" | "lower_is_better" | "sweet_spot";

export type MetricDirectionSpec = {
  key: string;
  /** `computeRatios` name, when the metric has one. */
  name: string;
  direction: MetricDirection;
  /** Inclusive native-unit healthy band. A null side is open. */
  healthyMin: number | null;
  healthyMax: number | null;
  /** Lower-is-better linear score hits 0 at this value (debtor days: 90). */
  zeroAt?: number;
  /**
   * Peer median in the metric's own units. Overview asks, ratio money
   * sentences, and the Bot context read this — not a private 45.
   * Distinct from the healthy band (debtor days still score healthy only to 18).
   */
  peerMedian?: number;
};

export const METRIC_DIRECTIONS: readonly MetricDirectionSpec[] = [
  { key: "grossMargin", name: "Gross Margin", direction: "higher_is_better", healthyMin: 0.32, healthyMax: null },
  { key: "operatingMargin", name: "Operating Margin", direction: "higher_is_better", healthyMin: 0.16, healthyMax: null },
  { key: "netMargin", name: "Net Margin", direction: "higher_is_better", healthyMin: 0.12, healthyMax: null },
  { key: "roa", name: "Return on Assets", direction: "higher_is_better", healthyMin: 0.096, healthyMax: null },
  { key: "roe", name: "Return on Equity", direction: "higher_is_better", healthyMin: 0.16, healthyMax: null },
  { key: "assetTurnover", name: "Asset Turnover", direction: "higher_is_better", healthyMin: 1.2, healthyMax: null },
  { key: "gpToLabor", name: "Gross Profit / Labor", direction: "higher_is_better", healthyMin: 0.48, healthyMax: null },
  { key: "salesPerEmployee", name: "Sales-per-Employee Ratio", direction: "higher_is_better", healthyMin: null, healthyMax: null },
  { key: "ocfToEbitda", name: "OCF / EBITDA", direction: "higher_is_better", healthyMin: 0.8, healthyMax: null },
  { key: "interestBurden", name: "Interest Burden", direction: "higher_is_better", healthyMin: 0.8, healthyMax: null },
  { key: "taxBurden", name: "Tax Burden", direction: "higher_is_better", healthyMin: 0.8, healthyMax: null },
  { key: "currentRatio", name: "Current Ratio", direction: "higher_is_better", healthyMin: 1.6, healthyMax: null },
  { key: "revenueGrowth", name: "Revenue Growth", direction: "higher_is_better", healthyMin: 0.16, healthyMax: null },
  { key: "fixedCostRatio", name: "Fixed Cost Ratio", direction: "lower_is_better", healthyMin: null, healthyMax: 0.1, zeroAt: 0.5 },
  { key: "customerConcentration", name: "Top-5 Customer Share", direction: "lower_is_better", healthyMin: null, healthyMax: 0.16, zeroAt: 0.8 },
  { key: "debtorDays", name: "Debtor Days", direction: "lower_is_better", healthyMin: null, healthyMax: 18, zeroAt: 90, peerMedian: 40 },
  { key: "inventoryDays", name: "Inventory Days", direction: "lower_is_better", healthyMin: null, healthyMax: 18, zeroAt: 90 },
  { key: "wipDays", name: "WIP Days", direction: "lower_is_better", healthyMin: null, healthyMax: 18, zeroAt: 90 },
  { key: "workingCapitalDays", name: "Working Capital Days", direction: "lower_is_better", healthyMin: null, healthyMax: 18, zeroAt: 90 },
  { key: "equityMultiplier", name: "Equity Multiplier", direction: "lower_is_better", healthyMin: null, healthyMax: 1.6 },
  { key: "debtToEquity", name: "Debt-to-Equity", direction: "lower_is_better", healthyMin: null, healthyMax: 0.4 },
  { key: "debtToAssets", name: "Debt-to-Assets", direction: "lower_is_better", healthyMin: null, healthyMax: 0.14 },
  { key: "creditorDays", name: "Creditor Days", direction: "sweet_spot", healthyMin: 30, healthyMax: 60 },
];
