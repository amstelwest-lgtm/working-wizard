/**
 * Unit checks for budget variance engine (no DB).
 */
import {
  actualsFromExtraction,
  computeMonthVariance,
  isMaterialVariance,
  monthFromPeriod,
  normalizeTaxonomyTotals,
} from "../src/lib/budget.variance";
import type { BudgetMonthResult } from "../src/lib/budget.types";
import type { MergedExtractionResult } from "../src/lib/extraction-types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const budget: BudgetMonthResult = {
  month: "2026-07",
  revenue: 100_000,
  cogs: 40_000,
  grossProfit: 60_000,
  gpPct: 60,
  overheads: 30_000,
  depreciation: 2_000,
  ebitda: 30_000,
  ebit: 28_000,
  capexCash: 0,
  inventoryBuild: 0,
  vatNet: 0,
  cashIn: 0,
  cashOut: 0,
  netCash: 0,
  closingCash: 0,
};

const report = computeMonthVariance(
  budget,
  normalizeTaxonomyTotals({
    revenue: 90_000,
    cogs: 40_000,
    grossProfit: 50_000,
    overheadsTotal: 30_000,
    depreciation: 2_000,
    ebit: 18_000,
  }),
);

assert(report.month === "2026-07", "month");
const rev = report.lines.find((l) => l.key === "revenue")!;
assert(rev.delta === -10_000, `revenue delta ${rev.delta}`);
assert(rev.signal === "adverse", "revenue adverse");
assert(isMaterialVariance(rev), "revenue material");
assert(report.hasMaterialVariance, "has material");
assert(monthFromPeriod("2026-07-01", "2026-07-31") === "2026-07", "month from period");

const fakeExtract = {
  document_metadata: {
    period_start_date: "2026-07-01",
    period_end_date: "2026-07-31",
    period_months: 1,
  },
  current_period: {
    income_statement: {
      revenue: 120000,
      cogs: 50000,
      gross_profit: 70000,
      fixed_costs: 25000,
      labor_cost: 15000,
      depreciation: 1000,
      amortisation: 0,
      depreciation_amortisation_total: 1000,
      ebit: 44000,
    },
  },
  data_quality: { overall_confidence: "high", extraction_notes: "" },
} as unknown as MergedExtractionResult;

const mapped = actualsFromExtraction(fakeExtract);
assert(mapped.month === "2026-07", "extract month");
assert(mapped.totals.revenue === 120000, "extract revenue");
assert(mapped.totals.overheadsPeople === 15000, "labor→people");
assert(mapped.totals.overheadsOther === 10000, "fixed−labor→other");

console.log("budget-variance-test: ok");
