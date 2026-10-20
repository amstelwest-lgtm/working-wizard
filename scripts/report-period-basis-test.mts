/**
 * A stored 12-month cover stays 12 months on reports, even when the statement
 * is dated in September and the financial year starts in January.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/report-period-basis-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BudgetVerdictStrip } from "../src/components/budget/budget-verdict";
import {
  budgetActualFromFinancials,
  buildBudgetPdfModel,
  illustrativeBudgetPack,
} from "../src/lib/budget-pdf";
import {
  budgetComparisonNote,
  budgetVersusStatement,
  SEEDED_VARIANCE_NOTE,
  seedBudgetFromFinancials,
  STATEMENT_PERIOD_OUTSIDE_NOTE,
  STATEMENT_PERIOD_UNKNOWN_NOTE,
  statementCoverMonthCount,
} from "../src/lib/budget.bridges";
import { computeBudgetMonths } from "../src/lib/budget.compute";
import { fyMonths } from "../src/lib/budget.months";
import { periodMonthsOf } from "../src/lib/ratios";
import { presentReturn } from "../src/lib/report-coherence";
import { buildScorecardRatioResults, scorecardRatiosFromFinancials } from "../src/lib/scorecard-rows";
import {
  BENCHMARK_REVIEW_BUSINESS_TYPE_CTA,
  BENCHMARK_SET_BUSINESS_TYPE_CTA,
  benchmarkEmptyCopy,
} from "../src/lib/benchmark-empty";
import { benchmarkBusinessType } from "../src/lib/benchmark-sector";
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

const statement = budgetActualFromFinancials(
  {
    ...qaUs,
    revenue: 700000,
    cogs: 280000,
    ebit: 60000,
    fixedCosts: 351000,
  },
  ZA_MARKET,
);
assert(statement?.statementCoverMonths === 12, "statement actual records the stored cover");
const model = buildBudgetPdfModel(doc, statement ? [statement] : [], ZA_MARKET);
const revenue = model.summary.find((row) => row.label === "Revenue");
assert(Math.abs((revenue?.budget ?? 0) - fullYear) < 1, `budget ${revenue?.budget} is not the full year ${fullYear}`);
assert(Math.abs((revenue?.actual ?? 0) - 700000) < 1, `actual stays the statement total, got ${revenue?.actual}`);
assert(model.fullYearNote.includes("full budget year"), model.fullYearNote);

const oneMonth = budgetActualFromFinancials({ ...qaUs, periodMonths: "1" }, ZA_MARKET);
const oneModel = buildBudgetPdfModel(doc, oneMonth ? [oneMonth] : [], ZA_MARKET);
const september = computeBudgetMonths(doc, doc.activeScenario).find((row) => row.month === "2026-09");
const oneRevenue = oneModel.summary.find((row) => row.label === "Revenue");
assert(
  Math.abs((oneRevenue?.budget ?? 0) - (september?.revenue ?? -1)) < 1,
  `a 1-month cover stays on September, budget ${oneRevenue?.budget} vs ${september?.revenue}`,
);

const studio = readFileSync(resolve("src/routes/_authenticated/reports-studio.tsx"), "utf8");
assert(studio.includes("benchmarkEmptyCopy"), "the benchmark empty state names the sector");
assert(studio.includes("benchmarkSectorForClient"), "the report builder uses the shared sector helper");
assert(studio.includes("text-slate-800"), "the empty-state sentence is dark on the light preview sheet");
assert(studio.includes("emptyMessage"), "preview renders that sentence instead of failing quietly");
assert(
  studio.includes("search={{ tab: \"overview\", profile: 1 }}") &&
    studio.includes('state.emptyCta || "Set the client\'s business type"') &&
    !studio.includes("clientId && state.offerSetBusinessType"),
  "the empty state always links to the profile, including when a sector is already set",
);
assert(studio.includes('.eq("business_type", sector)'), "benchmarks are filtered by business type");
assert(!studio.includes('.eq("market"'), "the benchmark query does not filter on market");
const wholesale = benchmarkEmptyCopy({
  studioSectorName: "Wholesale Trade — Non-Specialised",
});
assert(
  wholesale.message === "No benchmarks yet for Wholesale Trade — Non-Specialised.",
  wholesale.message,
);
assert(wholesale.offerSetBusinessType === false, "a selected industry is not a missing profile");
assert(
  wholesale.cta === BENCHMARK_REVIEW_BUSINESS_TYPE_CTA,
  "a set sector still links so the accountant can review the type",
);
const profileSector = benchmarkEmptyCopy({
  profileSectorName: "Wholesale & distribution",
  studioSectorName: "Wholesale Trade — Non-Specialised",
});
assert(
  profileSector.message === "No benchmarks yet for Wholesale & distribution.",
  "a stored profile wins over the studio default",
);
assert(profileSector.cta === BENCHMARK_REVIEW_BUSINESS_TYPE_CTA, profileSector.cta);
const unset = benchmarkEmptyCopy({});
assert(unset.offerSetBusinessType === true, "a blank profile still asks for a business type");
assert(unset.cta === BENCHMARK_SET_BUSINESS_TYPE_CTA, unset.cta);
assert(benchmarkBusinessType("Retail") === "retail", "Retail resolves to the retail benchmark key");
assert(benchmarkBusinessType("  RETAIL ") === "retail", "the lookup trims and ignores case");
assert(
  benchmarkBusinessType("Wholesale Trade — Non-Specialised") === "other",
  "wholesale follows the existing distribution → other map",
);
assert(benchmarkBusinessType("distribution") === "other", "distribution still maps to other");
assert(benchmarkBusinessType("Agriculture") === null, "an unknown label does not invent a sector");
const benchmarkSql = readFileSync(
  resolve("supabase/migrations/20260512133447_1a33e14b-1a88-4322-9434-d790a25c784e.sql"),
  "utf8",
);
const benchmarkTable = benchmarkSql.slice(0, benchmarkSql.indexOf("INSERT INTO"));
assert(!/market|region/i.test(benchmarkTable), "industry_benchmarks has no market or region column");
for (const metric of [
  "grossMargin",
  "operatingMargin",
  "netMargin",
  "debtorDays",
  "inventoryDays",
  "creditorDays",
  "assetTurnover",
  "roa",
  "roe",
  "fixedCostRatio",
]) {
  assert(benchmarkSql.includes(`('retail','${metric}'`), `retail seed is missing ${metric}`);
}
const profileHref = defaultStringifySearch({ tab: "overview", profile: 1 });
assert(profileHref.includes("profile=1"), `profile search is profile=1, got ${profileHref}`);
assert(!profileHref.includes("%22"), `profile search is not JSON-quoted, got ${profileHref}`);
const clientRoute = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const clientSearch = readFileSync(resolve("src/lib/client-route-search.ts"), "utf8");
assert(
  clientSearch.includes('search.profile === 1 || search.profile === "1"'),
  "profile=1 opens the editor",
);
assert(clientRoute.includes("if (search.profile === 1) setProfileOpen(true)"), "the overview reads profile=1");

const withDa = budgetActualFromFinancials(
  {
    ...qaUs,
    ebitda: "69000",
    revenue: 700000,
    cogs: 280000,
    ebit: 60000,
    fixedCosts: 351000,
  },
  ZA_MARKET,
);
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
const drivers = reconciled.sections.find((section) => section.title === "Revenue drivers");
assert(drivers?.rows.length === 1, `expected one priced driver, got ${drivers?.rows.length}`);
assert(
  drivers?.rows[0]?.actual === 700000,
  `single driver actual is the P&L revenue, got ${drivers?.rows[0]?.actual}`,
);
const primary = buildBudgetPdfModel(
  {
    ...doc,
    revenueLines: [{ ...doc.revenueLines[0], name: "Primary revenue" }],
  },
  withDa ? [withDa] : [],
  ZA_MARKET,
);
const primaryRow = primary.sections.find((section) => section.title === "Revenue drivers")?.rows[0];
assert(primaryRow?.label === "Primary revenue", primaryRow?.label ?? "missing driver");
assert(primaryRow?.budget != null && Math.abs(primaryRow.budget - 700000) < 1, `driver budget ${primaryRow?.budget}`);
assert(primaryRow?.actual === 700000, `Primary revenue actual is the P&L total, got ${primaryRow?.actual}`);
const split = buildBudgetPdfModel(
  {
    ...doc,
    revenueLines: [
      doc.revenueLines[0],
      { ...doc.revenueLines[0], id: "second_stream", name: "Secondary stream" },
    ],
  },
  withDa ? [withDa] : [],
  ZA_MARKET,
);
const splitDrivers = split.sections.find((section) => section.title === "Revenue drivers");
assert((splitDrivers?.rows.length ?? 0) >= 2, "two priced drivers stay separate");
assert(
  splitDrivers?.rows.every((item) => item.actual == null) === true,
  "several drivers do not copy the P&L total",
);
const budgetPdf = readFileSync(resolve("src/reports/budget-variance.tsx"), "utf8");
assert(budgetPdf.includes("Budget ${fmtRand(row.budget, market)}"), "exec tiles lead with the total");
assert(!budgetPdf.includes("value: signedMoney(row.delta, market)"), "exec tiles do not lead with the variance");
assert(budgetPdf.includes("hideVariance"), "the PDF can leave variance columns off");
const ownerRoute = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(
  ownerRoute.includes("statementCoverMonthCount"),
  "the owner budget page does not treat a missing prior period as 12 months",
);
assert(
  ownerRoute.includes("periodStart: v.periodStart"),
  "the owner budget page passes the statement dates into the comparison",
);

const partialFin = {
  revenue: "700000",
  cogs: "280000",
  ebit: "60000",
  fixedCosts: "351000",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
};
const partialActual = budgetActualFromFinancials(partialFin, ZA_MARKET);
assert(partialActual?.statementMonthKeys?.length === 9, "a dated YTD with no stored cover is 9 months");
assert(partialActual?.statementCoverMonths === 9, "the cover follows the dates when periodMonths is absent");
assert(partialActual?.periodUnknown !== true, "dated months are a known period");
const partialModel = buildBudgetPdfModel(doc, partialActual ? [partialActual] : [], ZA_MARKET);
const partialRevenue = partialModel.summary.find((row) => row.label === "Revenue");
const nineMonths = (fullYear * 9) / 12;
assert(
  Math.abs((partialRevenue?.budget ?? 0) - nineMonths) < 2,
  `YTD budget is 9 months (${partialRevenue?.budget}), not the full year and not one month`,
);
assert(Math.abs((partialRevenue?.actual ?? 0) - 700000) < 1, `YTD actual stays 700000, got ${partialRevenue?.actual}`);
assert(Math.abs((partialRevenue?.budget ?? 0) - 58333) > 1000, "the old one-month budget must not return");
assert(partialModel.suppressVariance === false, "a real YTD gap is still a variance");
assert(partialRevenue?.delta != null, "the partial-period variance is calculated");
const versusPartial = budgetVersusStatement(doc, partialFin, ZA_MARKET);
assert(versusPartial?.periodKnown === true && versusPartial.periodMonths === 9, "on-screen cover is the same 9 months");
assert(
  Math.abs((versusPartial?.budgetRevenue ?? 0) - nineMonths) < 2,
  `on-screen YTD budget ${versusPartial?.budgetRevenue}`,
);
assert(Math.abs((versusPartial?.revenue ?? 0) - 700000) < 1, "on-screen actual stays the statement total");
assert(budgetComparisonNote(versusPartial) == null, "a real gap does not get the seeded note");
assert(statementCoverMonthCount(partialFin) === 9, "owner prior-year cover follows the dated YTD");
assert(statementCoverMonthCount(qaUs) === 12, "a stored 12-month cover stays 12 for the owner year strip");

const unknownFin = {
  revenue: "700000",
  cogs: "280000",
  ebit: "60000",
  fixedCosts: "351000",
};
const unknownActual = budgetActualFromFinancials(unknownFin, ZA_MARKET);
assert(unknownActual?.periodUnknown === true, "no dates and no periodMonths is unknown");
assert(unknownActual?.statementCoverMonths == null, "an unknown period is not stored as 12");
const unknownModel = buildBudgetPdfModel(doc, unknownActual ? [unknownActual] : [], ZA_MARKET);
assert(unknownModel.headline === STATEMENT_PERIOD_UNKNOWN_NOTE, unknownModel.headline);
assert(unknownModel.comparedLabel === "Statement period unknown", unknownModel.comparedLabel);
assert(unknownModel.suppressVariance === true, "an unknown period is not scored");
assert(unknownModel.fullYearNote.includes("not on file"), unknownModel.fullYearNote);
const unknownRevenue = unknownModel.summary.find((row) => row.label === "Revenue");
assert(unknownRevenue?.actual == null, "unknown-period actuals are not paired with a year of budget");
const versusUnknown = budgetVersusStatement(doc, unknownFin, ZA_MARKET);
assert(versusUnknown?.periodKnown === false, "on-screen period is unknown");
assert(versusUnknown?.budgetRevenue == null, "on-screen does not invent a 12-month budget");
assert(budgetComparisonNote(versusUnknown) === STATEMENT_PERIOD_UNKNOWN_NOTE, budgetComparisonNote(versusUnknown) ?? "");
assert(statementCoverMonthCount(unknownFin) == null, "an unknown prior year is not counted as 12");
assert(periodMonthsOf(unknownFin) === 12, "ratios still default a missing cover to 12");

const outsideFin = {
  revenue: "700000",
  cogs: "280000",
  ebit: "60000",
  fixedCosts: "351000",
  periodStart: "2024-01-01",
  periodEnd: "2024-12-31",
};
const outsideActual = budgetActualFromFinancials(outsideFin, ZA_MARKET);
const outsideModel = buildBudgetPdfModel(doc, outsideActual ? [outsideActual] : [], ZA_MARKET);
assert(outsideModel.headline === STATEMENT_PERIOD_OUTSIDE_NOTE, outsideModel.headline);
assert(
  outsideModel.summary.find((row) => row.label === "Revenue")?.actual == null,
  "a statement from another year is not scored on this plan",
);
const versusOutside = budgetVersusStatement(doc, outsideFin, ZA_MARKET);
assert(versusOutside?.outsidePlan === true, "on-screen names a statement outside the budget year");
assert(versusOutside?.budgetRevenue == null, "an outside statement does not borrow this year's budget");
assert(
  budgetComparisonNote(versusOutside) === STATEMENT_PERIOD_OUTSIDE_NOTE,
  budgetComparisonNote(versusOutside) ?? "",
);

const seedFin = {
  revenue: "700000",
  cogs: "280000",
  fixedCosts: "351000",
  ebit: "60000",
  ebitda: "69000",
  periodMonths: "12",
};
const seededDoc = seedBudgetFromFinancials(illustrativeBudgetPack("2026-01").doc, seedFin).doc;
const seededActual = budgetActualFromFinancials(seedFin, ZA_MARKET);
const seededModel = buildBudgetPdfModel(seededDoc, seededActual ? [seededActual] : [], ZA_MARKET);
const seededRevenue = seededModel.summary.find((row) => row.label === "Revenue");
assert(seededModel.suppressVariance === true, "a seed is not shown as a variance result");
assert(seededModel.headline === SEEDED_VARIANCE_NOTE, seededModel.headline);
assert(Math.abs((seededRevenue?.budget ?? 0) - 700000) < 50, `seeded budget ${seededRevenue?.budget}`);
assert(Math.abs((seededRevenue?.actual ?? 0) - 700000) < 1, `seeded actual ${seededRevenue?.actual}`);
assert(seededRevenue?.delta == null && seededRevenue?.deltaPct == null, "seeded variance columns are cleared");
assert(
  seededModel.sections.every((section) => section.rows.every((row) => row.delta == null && row.deltaPct == null)),
  "every seeded line drops the variance",
);
const versusSeed = budgetVersusStatement(seededDoc, seedFin, ZA_MARKET);
assert(versusSeed?.seededFromActuals === true, "on-screen names the seed");
assert(budgetComparisonNote(versusSeed) === SEEDED_VARIANCE_NOTE, "on-screen uses the seeded sentence");
assert(Math.abs((versusSeed?.revenue ?? 0) - (versusSeed?.budgetRevenue ?? -1)) < 50, "the seed matches on screen");
for (const presentation of ["owner", "strip"] as const) {
  const html = renderToStaticMarkup(
    createElement(BudgetVerdictStrip, {
      periodLabel: versusSeed?.label ?? "Statement",
      revenueBudget: versusSeed?.budgetRevenue ?? 0,
      revenueActual: versusSeed?.revenue ?? 0,
      profitBudget: versusSeed?.budgetEbit ?? 0,
      profitActual: versusSeed?.ebit ?? 0,
      chip: "Estimated from statement pace",
      market: ZA_MARKET,
      presentation,
      comparisonNote: budgetComparisonNote(versusSeed),
    }),
  );
  assert(html.includes(SEEDED_VARIANCE_NOTE), `${presentation} shows the seeded note`);
  assert(!html.includes("0.0%"), `${presentation} does not print 0.0%`);
}

console.log("report-period-basis-test ok");
