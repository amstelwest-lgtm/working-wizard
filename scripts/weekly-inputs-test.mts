/**
 * Weekly P&L inputs must round-trip through the accountant financials blob
 * so owner and accountant Profit waterfalls show the same figures.
 * Run: pnpm test:weekly-inputs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  emptyDebtSchedule,
  mergeFinancialsBlob,
  parseDebtSchedule,
  splitFinancialsBlob,
} from "../src/lib/debt-schedule";
import {
  aggregateWeeklyInputs,
  derivePeriodWaterfallFallback,
  emptyWeeklyInputs,
  hasWeeklyActivity,
  hasWeeklyProfitFigures,
  overlayWeeklyInputs,
  parseWeeklyInputs,
  resolveWaterfallFigures,
} from "../src/lib/weekly-inputs";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const weeks = parseWeeklyInputs({
  weeks: {
    "2026-W35": { revenue: 100_000, costOfSales: 40_000, fixedCosts: 20_000, interest: 1_000, tax: 5_000 },
    "2026-W36": { revenue: 80_000, costOfSales: 30_000 },
  },
});

assert(weeks.weeks["2026-W35"].revenue === 100_000, "parse week revenue");
assert(weeks.weeks["2026-W36"].costOfSales === 30_000, "parse week cogs");
assert(weeks.weeks["2026-W36"].fixedCosts === 0, "missing fields default to 0");
assert(parseWeeklyInputs(null).weeks["x"] == null, "null blob is empty");
assert(Object.keys(parseWeeklyInputs({ weeks: [] }).weeks).length === 0, "array weeks rejected");

const agg = aggregateWeeklyInputs(weeks);
assert(agg.revenue === 180_000, "aggregate revenue across weeks");
assert(agg.costOfSales === 70_000, "aggregate cogs across weeks");
assert(hasWeeklyProfitFigures(weeks) === true, "weekly figures present");
assert(hasWeeklyProfitFigures(emptyWeeklyInputs()) === false, "empty weeks fall back to period");

const debt = parseDebtSchedule({
  lines: [{ id: "d1", label: "Term loan", amount: 50_000, annual_rate_pct: 11, maturity_year: 2028 }],
  drawings_ytd: 12_000,
});

const blob = mergeFinancialsBlob(
  { revenue: "500000", cogs: "200000", fixedCosts: "90000" },
  debt,
  weeks,
);

assert((blob.weeklyInputs as { weeks: Record<string, unknown> }).weeks["2026-W35"] != null, "merge keeps weeks");
assert((blob.debt_schedule as { lines: unknown[] }).lines.length === 1, "merge keeps debt");
assert(blob.revenue === "500000", "merge keeps scalars");

const split = splitFinancialsBlob(blob);
assert(split.scalars.revenue === "500000", "split scalars");
assert(split.scalars.weeklyInputs == null, "weeks are not stringified into scalars");
assert(split.weeklyInputs.weeks["2026-W36"].revenue === 80_000, "split restores weeks");
assert(split.debtSchedule.lines[0]?.amount === 50_000, "split restores debt");

const accountantAutosave = mergeFinancialsBlob(split.scalars, split.debtSchedule, split.weeklyInputs);
const again = splitFinancialsBlob(accountantAutosave);
assert(again.weeklyInputs.weeks["2026-W35"].revenue === 100_000, "accountant autosave must not wipe owner weeks");
assert(again.debtSchedule.drawings_ytd === 12_000, "accountant autosave keeps debt extras");

const ownerSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(ownerSrc.includes("<WeeklyInputTable"), "owner Profit tab has weekly inputs");
assert(
  ownerSrc.includes("setWeeklyInputs(parseWeeklyInputs(fin.weeklyInputs))"),
  "owner hydrates weeks even without period P&L keys",
);
assert(ownerSrc.includes("overlayWeeklyInputs"), "owner persists weeks without wiping period P&L");
assert(ownerSrc.includes("derivePeriodWaterfallFallback(v)"), "owner waterfall uses shared period fallback");

const accountantSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(accountantSrc.includes("<WeeklyInputTable role=\"accountant\""), "accountant Profit tab has weekly inputs");
assert(accountantSrc.includes("FinancialInputsContext.Provider"), "accountant portal provides weekly context for waterfall");
assert(accountantSrc.includes("weeklyInputs: weeks"), "accountant load splits weeklyInputs from the blob");
assert(
  accountantSrc.includes("derivePeriodWaterfallFallback(financials)"),
  "accountant waterfall uses shared period fallback",
);

const period = derivePeriodWaterfallFallback({
  revenue: "500000",
  cogs: "200000",
  ebit: "180000",
  ebt: "150000",
  netIncome: "120000",
});
assert(period.fixedCosts === 120000, "opex residual = GP − EBIT when fixedCosts blank");
assert(period.interest === 30000, "interest = EBIT − EBT");
assert(period.tax === 30000, "tax = EBT − net");

const ownerFigures = resolveWaterfallFigures(weeks, period);
const accountantFigures = resolveWaterfallFigures(weeks, period);
assert(ownerFigures.revenue === accountantFigures.revenue, "same weeks → same revenue");
assert(ownerFigures.costOfSales === accountantFigures.costOfSales, "same weeks → same cogs");
assert(ownerFigures.source === "weekly", "weekly revenue wins over larger period statement");
assert(ownerFigures.revenue === 180_000, "weekly revenue not period 500000");

const periodOnly = resolveWaterfallFigures(emptyWeeklyInputs(), period);
assert(periodOnly.source === "period", "empty weeks fall back to period");
assert(periodOnly.revenue === 500000, "period fallback revenue");

const overlaid = overlayWeeklyInputs(
  { revenue: "500000", cogs: "200000", debt_schedule: { lines: [{ amount: 1 }] } },
  weeks,
);
assert(overlaid.revenue === "500000", "overlay keeps period scalars");
assert((overlaid.debt_schedule as { lines: unknown[] }).lines.length === 1, "overlay keeps debt");
assert(hasWeeklyActivity(weeks) === true, "weeks with figures count as activity");
assert(hasWeeklyActivity(emptyWeeklyInputs()) === false, "empty weeks are not activity");

console.log("weekly-inputs-test: ok");
