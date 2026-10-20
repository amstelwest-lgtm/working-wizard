/**
 * Operating profit and net profit stay different numbers when interest, tax,
 * and other income sit between them. Budget, year-over-year, Profit, and the
 * Analyst quote the same net profit.
 * Run: pnpm test:budget-net-profit
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BudgetVerdictStrip } from "../src/components/budget/budget-verdict";
import { BudgetYearStrip } from "../src/components/budget/budget-year-strip";
import { fmtBudgetMoney } from "../src/lib/budget.compute";
import { budgetRangeTotals, budgetMonthViews, budgetTableRows } from "../src/lib/budget-chart-table";
import { ownerYearFromStatement, yearMoneyFromFinancials } from "../src/lib/budget-year-compare";
import {
  budgetProfitFields,
  budgetVersusStatement,
  seedBudgetFromFinancials,
} from "../src/lib/budget.bridges";
import { buildBudgetPdfModel, budgetActualFromFinancials } from "../src/lib/budget-pdf";
import { createBudgetDocument } from "../src/lib/budget.months";
import type { BudgetQualification } from "../src/lib/budget.types";
import { ownerAmount, ownerAnswerTiles, type OwnerBooks } from "../src/lib/owner-answers";
import { periodProfitBridge, statementNetProfit, statementNetProfitFromSteps } from "../src/lib/period-profit";
import { derivePeriodWaterfallFallback } from "../src/lib/weekly-inputs";
import { resolveMarket } from "../src/lib/market";
import { buildOverviewBrief, formatOverviewForPrompt } from "../supabase/functions/ask-ai/overview-brief";
import { extractWaterfallFigures, summarizeWaterfall } from "../supabase/functions/ask-ai/deliverable-summaries";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const US = resolveMarket({ country: "US", regionCode: "NY" });

const OPERATING = 52_020;
const NET = 38_200;

/** Interest, tax, and other income. Operating profit is not the bottom line. */
const fin = {
  revenue: "412000",
  cogs: "171000",
  grossProfit: "241000",
  fixedCosts: "188980",
  ebit: "52020",
  ebitda: "52020",
  otherIncome: "4000",
  interestExpense: "8600",
  ebt: "47420",
  tax: "9220",
  netIncome: "38200",
  periodMonths: "12",
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
};

const bridge = periodProfitBridge(fin);
assert(Math.abs(bridge.ebit - OPERATING) < 1, `operating profit ${bridge.ebit}`);
const walked = bridge.ebit - bridge.interest - bridge.tax;
assert(Math.abs(walked - NET) > 1, `interest and tax alone are not net profit (${walked})`);

const canonical = statementNetProfit(fin);
assert(canonical === NET, `canonical net profit ${canonical}`);

const fallback = derivePeriodWaterfallFallback(fin);
const profitTab = statementNetProfitFromSteps({
  operatingProfit:
    fallback.revenue - fallback.cogs - fallback.fixedCosts - (fallback.depreciation ?? 0),
  interest: fallback.interest,
  tax: fallback.tax,
  statedNetIncome: fallback.statedNetIncome,
});
assert(profitTab === NET, `Profit tab net profit ${profitTab}`);

const books: OwnerBooks = {
  hasBooks: true,
  ledger: null,
  revenue: 412_000,
  priorRevenue: null,
  cogs: 171_000,
  priorCogs: null,
  grossProfit: 241_000,
  operatingProfit: OPERATING,
  netIncome: NET,
  receivables: null,
  cashflow: null,
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: US,
};
const analyst = ownerAnswerTiles(books).find((tile) => tile.id === "profit")?.sentence ?? "";
assert(analyst.includes("Net profit"), analyst);
assert(analyst.includes(ownerAmount(NET, US)), analyst);
assert(!analyst.includes(ownerAmount(OPERATING, US)), `analyst must not quote operating profit as net: ${analyst}`);

const brief = buildOverviewBrief({ financials: fin, copyPack: "us", clientName: "1020D" });
assert(brief.netProfit === NET, `ask-ai net profit ${brief.netProfit}`);
assert(brief.operatingProfit === OPERATING, `ask-ai operating profit ${brief.operatingProfit}`);
const prompt = formatOverviewForPrompt(brief, "owner");
assert(prompt.includes("Net profit: $38,200"), prompt);
assert(prompt.includes("Operating profit: $52,020"), prompt);
const waterfall = summarizeWaterfall(extractWaterfallFigures(fin));
const netStep = waterfall?.steps.find((step) => step.label === "Net income");
assert(
  netStep != null && Math.abs((((netStep.pctOfRevenue ?? 0) / 100) * 412_000) - NET) < 2,
  `ask-ai waterfall net ${netStep?.pctOfRevenue}`,
);

const qualification: BudgetQualification = {
  payMotion: "time_delivery",
  volumeUnit: "billable_hours",
  driverKind: "hours_rate",
  costShape: "payroll_heavy",
  debtorDaysDefault: 30,
  capexMode: "none",
  confirmedAt: "2026-01-15T00:00:00.000Z",
};
const seeded = seedBudgetFromFinancials(
  createBudgetDocument({
    templateId: "services_hours",
    qualification,
    fyStart: "2026-01",
    fyStartMonth: 1,
    ref: new Date("2026-10-05T12:00:00Z"),
    market: US,
  }),
  fin,
).doc;
const versus = budgetVersusStatement(seeded, fin, US);
assert(versus != null, "the statement compares with the plan");
assert(Math.abs(versus!.ebit - OPERATING) < 1, `budget actual operating profit ${versus!.ebit}`);
assert(versus!.netProfit === NET, `budget net profit ${versus!.netProfit}`);
assert(Math.abs((versus!.budgetEbit ?? 0) - OPERATING) < 50, `plan operating profit ${versus!.budgetEbit}`);

const year = ownerYearFromStatement(versus);
assert(year?.netProfit === NET, `this year net profit ${year?.netProfit}`);
const prior = yearMoneyFromFinancials({ ...fin, netIncome: "30000", ebit: "40000" });
assert(prior?.netProfit === 30_000, `prior year net profit ${prior?.netProfit}`);
const unusablePrior = yearMoneyFromFinancials({ revenue: "100", ebit: "10", netIncome: "80" });
assert(unusablePrior?.netProfit == null, "a net above operating profit is not quoted");

const money = (n: number) => fmtBudgetMoney(n, US);
const verdict = renderToStaticMarkup(
  createElement(BudgetVerdictStrip, {
    periodLabel: versus!.label,
    revenueBudget: versus!.budgetRevenue ?? 0,
    revenueActual: versus!.revenue,
    profitBudget: versus!.budgetEbit ?? 0,
    profitActual: versus!.ebit,
    chip: versus!.chip,
    market: US,
    presentation: "owner",
  }),
);
assert(verdict.includes("Operating profit vs budget"), verdict);
assert(verdict.includes(money(Math.round(versus!.budgetEbit ?? 0))), "the verdict shows the plan's operating profit");
assert(!verdict.includes("Net profit"), "the operating comparison is not labelled net profit");
assert(!verdict.includes(money(NET)), "the verdict does not present net profit as operating profit");

const yearStrip = renderToStaticMarkup(
  createElement(BudgetYearStrip, {
    thisYear: year,
    thisMonths: versus!.periodMonths,
    lastYear: prior,
    lastMonths: 12,
    market: US,
    signed: true,
  }),
);
assert(yearStrip.includes("Net profit"), yearStrip);
assert(yearStrip.includes(money(NET)), "year-over-year shows net profit");
assert(!yearStrip.includes(money(OPERATING)), "year-over-year does not show operating profit as net profit");

const rows = budgetTableRows(seeded, budgetMonthViews(seeded, []));
assert(rows.some((row) => row.label === "Operating profit"), "the plan total is operating profit");
assert(!rows.some((row) => row.label === "Net" || row.label === "Net profit"), "the plan does not label operating profit as net");
const totals = budgetRangeTotals(budgetMonthViews(seeded, []).filter((row) => (versus!.windowMonths ?? []).includes(row.month)));
assert(Math.abs(totals.net - (versus!.budgetEbit ?? 0)) < 50, "the chart total stays the plan's operating profit");

const pdfActual = budgetActualFromFinancials(fin, US);
const pdf = buildBudgetPdfModel(seeded, pdfActual ? [pdfActual] : [], US);
const pdfNet = pdf.sections.flatMap((section) => section.rows).find((row) => row.label === "Net profit");
const pdfOperating = pdf.summary.find((row) => row.label === "Operating profit");
assert(pdfOperating != null, "the PDF names operating profit");
assert(pdfNet != null && pdfNet.actual === NET && pdfNet.hideBudget === true, `PDF net profit ${pdfNet?.actual}`);

const passed = budgetProfitFields({
  revenue: "1",
  ebit: "52020",
  netIncome: "38200",
  otherIncome: "4000",
  interestExpense: "",
  tax: "9220",
});
assert(passed.netIncome === "38200" && passed.otherIncome === "4000" && passed.ebit === "52020", "profit lines reach the budget");
assert(passed.interestExpense == null && passed.tax === "9220", "a blank interest line is not sent as zero");

const ownerApp = readFileSync(new URL("../src/routes/app.tsx", import.meta.url), "utf8");
const accountant = readFileSync(new URL("../src/routes/_authenticated/clients.$clientId.tsx", import.meta.url), "utf8");
const simple = readFileSync(new URL("../src/components/budget/budget-simple-view.tsx", import.meta.url), "utf8");
const bot = readFileSync(new URL("../supabase/functions/milon-bot/tools.ts", import.meta.url), "utf8");
assert(ownerApp.split("budgetProfitFields(").length >= 3, "both owner budget panels pass profit lines");
assert(accountant.includes("yearMoneyFromFinancials"), "the accountant year-over-year uses the same prior-year money");
assert(accountant.includes("priorYear="), "the accountant budget receives last year");
assert(!simple.includes("netProfit: compared.budgetEbit"), "the year table does not copy operating profit into net profit");
assert(simple.includes("<BudgetYearStrip"), "owner and accountant share the year strip");
assert(bot.includes("buildOverviewBrief"), "milon-bot quotes the same overview net profit");

console.log("budget-net-profit-test: all assertions passed");
