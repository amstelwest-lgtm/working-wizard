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
assert(
  !accountantSrc.includes("<WeeklyInputTable"),
  "accountant Profit tab keeps period profitability inputs only — weekly stays on the owner board",
);
assert(accountantSrc.includes("Profitability inputs"), "accountant Profit tab keeps profitability-input style");
{
  const profitStart = accountantSrc.indexOf('id="pane-profit"');
  const profitEnd = accountantSrc.indexOf('id="pane-cash"');
  const profitPane = accountantSrc.slice(profitStart, profitEnd);
  assert(profitStart !== -1 && profitEnd > profitStart, "profit pane exists");
  assert(
    profitPane.indexOf("Product lines") < profitPane.indexOf("Profitability Waterfall"),
    "product-line questions sit above the waterfall",
  );
  assert(
    profitPane.indexOf('id="wizard-profit-walk"') < profitPane.indexOf('id="profitFinCollapse"'),
    "profitability inputs sit below the waterfall",
  );
  assert(
    /build revenue and net profit per product line/i.test(profitPane),
    "product-line incentive copy is on the Profit tab",
  );
}
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
assert((period.depreciation ?? 0) === 0, "no depreciation when EBITDA is absent");
assert(period.interest === 30000, "interest = EBIT − EBT");
assert(period.tax === 30000, "tax = EBT − net");

// QA US: operating expenses $351k, EBITDA $69k, EBIT $60k. The $9k is D&A,
// not extra operating expenses. Waterfall opex stays $351k so it matches
// the configure-inputs field; operating profit stays $60k.
const us = derivePeriodWaterfallFallback({
  revenue: "700000",
  cogs: "280000",
  fixedCosts: "351000",
  ebit: "60000",
  ebitda: "69000",
  ebt: "60000",
  netIncome: "60000",
});
assert(us.fixedCosts === 351_000, `US opex stays the entered 351k, got ${us.fixedCosts}`);
assert(us.depreciation === 9_000, `US depreciation is EBITDA − EBIT, got ${us.depreciation}`);
assert(
  us.revenue - us.cogs - us.fixedCosts - (us.depreciation ?? 0) === 60_000,
  "US operating profit equals EBIT",
);
const usResolved = resolveWaterfallFigures(emptyWeeklyInputs(), us);
assert(usResolved.fixedCosts === 351_000 && usResolved.depreciation === 9_000, "period path keeps D&A");
assert(usResolved.source === "period", "US figures are the period bridge");
const usWeeklyHidesDa = resolveWaterfallFigures(
  parseWeeklyInputs({ weeks: { "2026-W40": { revenue: 1, costOfSales: 0, fixedCosts: 0 } } }),
  us,
);
assert(usWeeklyHidesDa.depreciation === 0, "a week grid does not invent statement depreciation");

const unexplained = derivePeriodWaterfallFallback({
  revenue: "200",
  cogs: "0",
  fixedCosts: "40",
  ebit: "50",
});
assert(unexplained.fixedCosts === 150, "a gap that is not D&A still plugs opex so profit equals EBIT");
assert((unexplained.depreciation ?? 0) === 0, "an unexplained gap is not booked as depreciation");

const ownerFigures = resolveWaterfallFigures(weeks, period);
const accountantFigures = resolveWaterfallFigures(weeks, period);
assert(ownerFigures.revenue === accountantFigures.revenue, "same weeks → same revenue");
assert(ownerFigures.costOfSales === accountantFigures.costOfSales, "same weeks → same cogs");
assert(ownerFigures.source === "weekly", "weekly revenue wins over larger period statement");
assert(ownerFigures.revenue === 180_000, "weekly revenue not period 500000");

const periodOnly = resolveWaterfallFigures(emptyWeeklyInputs(), period);
assert(periodOnly.source === "period", "empty weeks fall back to period");
assert(periodOnly.revenue === 500000, "period fallback revenue");

const xeroOverWeekly = resolveWaterfallFigures(weeks, period, { preferPeriod: true });
assert(xeroOverWeekly.source === "period", "a Xero statement wins over weekly totals");
assert(xeroOverWeekly.revenue === 500000, "Xero period revenue is not the week grid");

const overlaid = overlayWeeklyInputs(
  { revenue: "500000", cogs: "200000", debt_schedule: { lines: [{ amount: 1 }] } },
  weeks,
);
assert(overlaid.revenue === "500000", "overlay keeps period scalars");
assert((overlaid.debt_schedule as { lines: unknown[] }).lines.length === 1, "overlay keeps debt");
assert(hasWeeklyActivity(weeks) === true, "weeks with figures count as activity");
assert(hasWeeklyActivity(emptyWeeklyInputs()) === false, "empty weeks are not activity");

console.log("weekly-inputs-test: ok");
