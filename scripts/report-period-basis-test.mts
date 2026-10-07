/**
 * A stored 12-month cover stays 12 months on reports, even when the statement
 * is dated in September and the financial year starts in January.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/report-period-basis-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  budgetActualFromFinancials,
  buildBudgetPdfModel,
  illustrativeBudgetPack,
} from "../src/lib/budget-pdf";
import { computeBudgetMonths } from "../src/lib/budget.compute";
import { fyMonths } from "../src/lib/budget.months";
import { periodMonthsOf } from "../src/lib/ratios";
import { presentReturn } from "../src/lib/report-coherence";
import { buildScorecardRatioResults, scorecardRatiosFromFinancials } from "../src/lib/scorecard-rows";
import { ZA_MARKET } from "../src/lib/market/resolve";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const qaUs = {
  revenue: "700000",
  cogs: "280000",
  ebit: "60000",
  ebt: "60000",
  netIncome: "60000",
  totalAssets: "307500",
  equity: "150000",
  fixedCosts: "351000",
  periodMonths: "12",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
};

assert(periodMonthsOf(qaUs) === 12, "the stored cover is 12 months");

const ratios = scorecardRatiosFromFinancials(qaUs, { fyStartMonth: 1 });
const roe = ratios["Return on Equity"];
assert(Math.abs(roe - 0.4) < 0.001, `12-month ROE is 40%, got ${roe}`);

const rows = buildScorecardRatioResults(ratios, ZA_MARKET, {
  equity: 150000,
  periodMonths: periodMonthsOf(qaUs),
});
const roeRow = rows.find((row) => row.ratio_name === "Return on Equity");
assert(roeRow?.formatted_value === "40.0%", `ROE label is 40.0%, got ${roeRow?.formatted_value}`);
assert(!roeRow?.formatted_value.includes("annualised"), "a full year is not labelled annualised");
const presented = presentReturn({
  ratioName: "Return on Equity",
  value: roe,
  equity: 150000,
  periodMonths: periodMonthsOf(qaUs),
});
assert(presented.text === "40.0%" && presented.note == null, presented.text);

const nine = scorecardRatiosFromFinancials({ ...qaUs, periodMonths: "9" }, { fyStartMonth: 1 });
assert(
  Math.abs(nine["Return on Equity"] - 0.4 * (12 / 9)) < 0.002,
  `an explicit 9-month cover still annualises, got ${nine["Return on Equity"]}`,
);

const { doc } = illustrativeBudgetPack("2026-01");
const months = fyMonths("2026-01");
const monthly = 700000 / 12;
doc.revenueLines = doc.revenueLines.map((line, index) => ({
  ...line,
  months: Object.fromEntries(
    months.map((month) => [month, index === 0 ? { volume: 1, price: monthly } : { volume: 0, price: 0 }]),
  ),
}));
const fullYear = computeBudgetMonths(doc, doc.activeScenario).reduce((sum, row) => sum + row.revenue, 0);
assert(Math.abs(fullYear - 700000) < 1, `fixture full-year budget is 700000, got ${fullYear}`);

const statement = budgetActualFromFinancials({
  ...qaUs,
  revenue: 700000,
  cogs: 280000,
  ebit: 60000,
  fixedCosts: 351000,
});
assert(statement?.statementCoverMonths === 12, "statement actual records the stored cover");
const model = buildBudgetPdfModel(doc, statement ? [statement] : [], ZA_MARKET);
const revenue = model.summary.find((row) => row.label === "Revenue");
assert(Math.abs((revenue?.budget ?? 0) - fullYear) < 1, `budget ${revenue?.budget} is not the full year ${fullYear}`);
assert(Math.abs((revenue?.actual ?? 0) - 700000) < 1, `actual stays the statement total, got ${revenue?.actual}`);
assert(model.fullYearNote.includes("full budget year"), model.fullYearNote);

const oneMonth = budgetActualFromFinancials({ ...qaUs, periodMonths: "1" });
const oneModel = buildBudgetPdfModel(doc, oneMonth ? [oneMonth] : [], ZA_MARKET);
const september = computeBudgetMonths(doc, doc.activeScenario).find((row) => row.month === "2026-09");
const oneRevenue = oneModel.summary.find((row) => row.label === "Revenue");
assert(
  Math.abs((oneRevenue?.budget ?? 0) - (september?.revenue ?? -1)) < 1,
  `a 1-month cover stays on September, budget ${oneRevenue?.budget} vs ${september?.revenue}`,
);

const studio = readFileSync(resolve("src/routes/_authenticated/reports.index.tsx"), "utf8");
assert(
  studio.includes("No sector benchmarks available — set the client business type / profile, then regenerate."),
  "the benchmark empty state keeps the existing sentence",
);
assert(studio.includes("emptyMessage"), "preview renders that sentence instead of failing quietly");
assert(
  studio.includes('search={{ tab: "overview", profile: "1" }}') &&
    studio.includes("Set the client&apos;s business type"),
  "the empty state links to the client business profile",
);

console.log("report-period-basis-test ok");
