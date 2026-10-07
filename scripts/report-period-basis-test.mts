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
import { benchmarkEmptyCopy } from "../src/lib/benchmark-empty";
import { defaultStringifySearch } from "@tanstack/router-core";
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
assert(studio.includes("benchmarkEmptyCopy"), "the benchmark empty state names the sector");
assert(studio.includes("text-slate-800"), "the empty-state sentence is dark on the light preview sheet");
assert(studio.includes("emptyMessage"), "preview renders that sentence instead of failing quietly");
assert(
  studio.includes("search={{ tab: \"overview\", profile: 1 }}") &&
    studio.includes("Set the client&apos;s business type"),
  "the empty state links to the client business profile",
);
const wholesale = benchmarkEmptyCopy({
  studioSectorName: "Wholesale Trade — Non-Specialised",
});
assert(
  wholesale.message === "No benchmarks yet for Wholesale Trade — Non-Specialised.",
  wholesale.message,
);
assert(wholesale.offerSetBusinessType === false, "a selected industry is not a missing profile");
const profileSector = benchmarkEmptyCopy({
  profileSectorName: "Wholesale & distribution",
  studioSectorName: "Wholesale Trade — Non-Specialised",
});
assert(
  profileSector.message === "No benchmarks yet for Wholesale & distribution.",
  "a stored profile wins over the studio default",
);
const unset = benchmarkEmptyCopy({});
assert(unset.offerSetBusinessType === true, "a blank profile still asks for a business type");
const profileHref = defaultStringifySearch({ tab: "overview", profile: 1 });
assert(profileHref.includes("profile=1"), `profile search is profile=1, got ${profileHref}`);
assert(!profileHref.includes("%22"), `profile search is not JSON-quoted, got ${profileHref}`);
const clientRoute = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(clientRoute.includes('search.profile === 1 || search.profile === "1"'), "profile=1 opens the editor");
assert(clientRoute.includes("if (search.profile === 1) setProfileOpen(true)"), "the overview reads profile=1");

const withDa = budgetActualFromFinancials({
  ...qaUs,
  ebitda: "69000",
  revenue: 700000,
  cogs: 280000,
  ebit: 60000,
  fixedCosts: 351000,
});
assert(withDa?.totals.depreciation === 9000, `statement depreciation is 9k, got ${withDa?.totals.depreciation}`);
assert(withDa?.totals.ebit === 60000, `statement profit stays EBIT, got ${withDa?.totals.ebit}`);
assert(
  withDa?.totals.overheadsTotal === 351000,
  `operating expenses stay 351k, got ${withDa?.totals.overheadsTotal}`,
);
assert(withDa?.totals.overheadsOther === 0, "an unsplit operating-expense total is not booked as Other");
assert(withDa?.overheadsUnsplit === true, "the statement actual is marked unsplit");
const reconciled = buildBudgetPdfModel(doc, withDa ? [withDa] : [], ZA_MARKET);
const pnl = reconciled.sections.find((section) => section.title === "Profit and loss");
const row = (label: string) => pnl?.rows.find((item) => item.label === label);
const revenueRow = row("Revenue");
const cogsRow = row("COGS");
const opexRow = row("Operating expenses");
const dep = row("Depreciation");
const profit = row("Profit");
assert(dep?.actual === 9000, `depreciation actual is 9k, got ${dep?.actual}`);
assert(profit?.actual === 60000, `profit actual is EBIT 60k, got ${profit?.actual}`);
assert(opexRow?.actual === 351000, `operating expenses actual stays 351k, got ${opexRow?.actual}`);
const actualBridge =
  (revenueRow?.actual ?? 0) -
  (cogsRow?.actual ?? 0) -
  (opexRow?.actual ?? 0) -
  (dep?.actual ?? 0) -
  (profit?.actual ?? 0);
assert(Math.abs(actualBridge) < 1, `actual lines reconcile to profit, gap ${actualBridge}`);
const overheads = reconciled.sections.find((section) => section.title === "Overheads");
assert(
  overheads?.note?.includes("does not split operating expenses") === true,
  overheads?.note ?? "missing overhead note",
);
const budgetPdf = readFileSync(resolve("src/reports/budget-variance.tsx"), "utf8");
assert(budgetPdf.includes("Budget ${fmtRand(row.budget, market)}"), "exec tiles lead with the total");
assert(!budgetPdf.includes("value: signedMoney(row.delta, market)"), "exec tiles do not lead with the variance");

console.log("report-period-basis-test ok");
