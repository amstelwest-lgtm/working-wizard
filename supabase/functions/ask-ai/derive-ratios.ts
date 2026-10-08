/**
 * Ask AI ratio derivation. Ratios come from `computeRatios` / `flatToRatioInputs`
 * so Overview copy uses the same days, margins, and period as the Ratios page.
 */

import {
  scoreCreditorDays,
  scoreLowerIsBetterDays,
  scoreWorkingCapitalDays,
} from "../../../src/lib/client-metrics.ts";
import { flatToRatioInputs, type FlatFinancials } from "../../../src/lib/health-score.ts";
import { computeRatios } from "../../../src/lib/ratios.ts";

export const DISPLAY_TO_CAMEL: Record<string, string> = {
  "Net Margin": "netMargin",
  "Operating Margin": "operatingMargin",
  "Gross Margin": "grossMargin",
  "Return on Equity": "roe",
  "Return on Assets": "roa",
  "Asset Turnover": "assetTurnover",
  "Equity Multiplier": "equityMultiplier",
  "Interest Burden": "interestBurden",
  "Tax Burden": "taxBurden",
  "Debtor Days": "debtorDays",
  "Inventory Days": "inventoryDays",
  "Creditor Days": "creditorDays",
  "Working Capital Days": "workingCapitalDays",
  "Fixed Cost Ratio": "fixedCostRatio",
  "Degree of Operating Leverage": "dol",
  "Top-5 Customer Share": "customerConcentration",
  "Gross Profit / Labor": "gpToLabor",
  "Sales-per-Employee Ratio": "salesPerEmployee",
  "OCF / EBITDA": "ocfToEbitda",
  "Debt-to-Equity": "debtToEquity",
};

const PILLAR_NAMES: Record<string, readonly string[]> = {
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
  financing: ["Equity Multiplier", "Interest Burden", "Tax Burden", "Return on Equity"],
  cash: ["Debtor Days", "Creditor Days", "Working Capital Days", "OCF / EBITDA"],
};

export const PILLAR_LABELS: Record<string, string> = {
  profit: "Profitability",
  assets: "Asset efficiency",
  financing: "Financing / debt",
  cash: "Cash & working capital",
};

function num(raw: unknown): number {
  if (raw == null || raw === "") return NaN;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Same display-name keys as `computeRatios()` in src/lib/ratios.ts, including
 * `effectivePeriodMonths` when a financial-year start is passed.
 */
export function computeRatiosFromFinancials(
  financials: Record<string, unknown> | null | undefined,
  opts?: { fyStartMonth?: number | null },
): Record<string, number> {
  if (!financials || typeof financials !== "object" || Array.isArray(financials)) return {};
  // Blob values are unknown here; flatToRatioInputs stringifies each field.
  return computeRatios(
    flatToRatioInputs(financials as FlatFinancials, { fyStartMonth: opts?.fyStartMonth }),
  );
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/** Slim 0–100 score — enough for pillar drag, not a second health engine. */
export function scoreDisplayRatio(name: string, val: number): number {
  if (!Number.isFinite(val)) return NaN;
  if (name === "Net Margin") return clamp((val / 0.15) * 100);
  if (name === "Operating Margin") return clamp((val / 0.2) * 100);
  if (name === "Gross Margin") return clamp((val / 0.4) * 100);
  if (name === "Return on Assets") return clamp((val / 0.12) * 100);
  if (name === "Return on Equity") return clamp((val / 0.2) * 100);
  if (name === "Asset Turnover") return clamp((val / 1.5) * 100);
  if (name === "Gross Profit / Labor") return clamp((val / 0.6) * 100);
  if (name === "Sales-per-Employee Ratio") return clamp((val / 800_000) * 100);
  if (name === "OCF / EBITDA" || name === "Interest Burden" || name === "Tax Burden") {
    return clamp(val * 100);
  }
  if (name === "Fixed Cost Ratio") return clamp(((0.5 - val) / 0.5) * 100);
  if (name === "Top-5 Customer Share") return clamp(((0.8 - val) / 0.8) * 100);
  if (name === "Debtor Days" || name === "Inventory Days") return scoreLowerIsBetterDays(val);
  if (name === "Working Capital Days") return scoreWorkingCapitalDays(val);
  if (name === "Creditor Days") return scoreCreditorDays(val);
  if (name === "Equity Multiplier") return clamp(((4 - val) / 3) * 100);
  if (name === "Degree of Operating Leverage") {
    if (val <= 0) return 30;
    if (val <= 2) return clamp(50 + (val / 2) * 40);
    if (val <= 4) return clamp(90 - ((val - 2) / 2) * 40);
    return clamp(50 - (val - 4) * 10);
  }
  return 50;
}

export type PillarBreakdownRow = {
  id: string;
  label: string;
  score: number | null;
};

export function pillarBreakdownFromRatios(
  ratios: Record<string, number>,
): PillarBreakdownRow[] {
  return Object.entries(PILLAR_NAMES).map(([id, names]) => {
    const scores = names
      .map((name) => scoreDisplayRatio(name, ratios[name]))
      .filter((n) => Number.isFinite(n));
    const score =
      scores.length === 0 ? null : Math.round(scores.reduce((s, n) => s + n, 0) / scores.length);
    return { id, label: PILLAR_LABELS[id] ?? id, score };
  });
}

/** Prefer snapshot ratios; fall back to live `clients.financials`. */
export function resolveRatioRecord(
  snapshotRatios: Record<string, unknown> | null | undefined,
  financials: Record<string, unknown> | null | undefined,
): Record<string, number> {
  const fromSnap: Record<string, number> = {};
  if (snapshotRatios && typeof snapshotRatios === "object" && !Array.isArray(snapshotRatios)) {
    for (const [k, v] of Object.entries(snapshotRatios)) {
      const n = num(v);
      if (Number.isFinite(n)) fromSnap[k] = n;
    }
  }
  if (Object.keys(fromSnap).length > 0) return fromSnap;
  const derived = computeRatiosFromFinancials(financials);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(derived)) {
    if (Number.isFinite(v)) out[k] = v;
  }
  return out;
}
