/**
 * A Q3 P&L must not replace a Jan–Sep year-to-date, move cash, or
 * show mixed figures on the owner Budget tab.
 * Run: pnpm test:pl-only-period
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BudgetVerdictStrip } from "../src/components/budget/budget-verdict";
import { BudgetYearStrip } from "../src/components/budget/budget-year-strip";
import { fmtBudgetMoney } from "../src/lib/budget.compute";
import {
  budgetVersusStatement,
  seedBudgetFromFinancials,
} from "../src/lib/budget.bridges";
import { budgetRangeTotals, budgetMonthViews } from "../src/lib/budget-chart-table";
import {
  hasPriorYearFigures,
  ownerBudgetHowBuilt,
  ownerYearFromStatement,
} from "../src/lib/budget-year-compare";
import { createBudgetDocument } from "../src/lib/budget.months";
import type { BudgetQualification } from "../src/lib/budget.types";
import { liveHealthFromBooks } from "../src/lib/health-score";
import { ZA_MARKET, resolveMarket } from "../src/lib/market";
import { presentScorecardRatio } from "../src/lib/report-coherence";
import { computeRatios } from "../src/lib/ratios";
import { signoffStatusLine } from "../src/lib/signoff-status";
import { statementNoteSections } from "../src/lib/statement-notes";
import { overlayParsedStatement, periodFinancialsFromExtraction } from "../src/lib/statement-financials";
import {
  earlierStatementNote,
  liveCoverageForImport,
  planStatementImport,
  statementSpan,
} from "../src/lib/statement-import-plan";
import { mergeStatementFinancials, parseStatementText } from "../src/lib/statement-parse";
import type { ExtractionResult } from "../src/lib/financialSchema";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const US = resolveMarket({ country: "US", regionCode: "NY" });

const Q3 = `Profit and Loss,Jul 1 - Sep 30 2026
Account,Amount
Sales revenue,182000
Cost of sales,76000
Gross profit,106000
Salaries and wages,48000
Rent,9000
Software subscriptions,3200
Marketing,5400
Depreciation,2100
Interest expense,1300
Net profit before tax,37000
`;

const pl = readFileSync(new URL("./fixtures/demo-pl-sep-2026.csv", import.meta.url), "utf8");
const bs = readFileSync(new URL("./fixtures/demo-bs-30sep-2026.csv", import.meta.url), "utf8");
const income = parseStatementText(pl);
const balance = parseStatementText(bs);
const existing = mergeStatementFinancials(
  mergeStatementFinancials(
    {
      periodStart: income.periodStart,
      periodEnd: income.periodEnd,
      periodMonths: String(income.periodMonths),
    },
    income.fields,
    "income_statement",
  ),
  { ...balance.fields, periodEnd: "2026-09-30" },
  "balance_sheet",
);

const quarter = parseStatementText(Q3);
assert(quarter.kind === "income_statement", quarter.kind);
assert(quarter.companyName == null, `date was read as the company (${quarter.companyName})`);
assert(quarter.periodStart === "2026-07-01", quarter.periodStart ?? "no start");
assert(quarter.periodEnd === "2026-09-30", quarter.periodEnd ?? "no end");
assert(quarter.periodMonths === 3, `months ${quarter.periodMonths}`);
assert(quarter.fields.revenue === "182000", quarter.fields.revenue ?? "no revenue");
assert(quarter.fields.cogs === "76000", quarter.fields.cogs ?? "no cogs");
assert(quarter.fields.ebt === "37000", quarter.fields.ebt ?? "no ebt");
assert(quarter.fields.netIncome == null, "net profit before tax is not net income");
assert(quarter.fields.cash == null, "a P&L does not invent cash");
assert(quarter.fields.fixedCosts == null, "the quarter has no fixed-cost total");

function periodHeader(label: string, market: typeof US | typeof ZA_MARKET) {
  return parseStatementText(`Profit and Loss,${label}\nAccount,Amount\nSales revenue,100000\n`, market);
}
function assertQuarter(
  parsed: ReturnType<typeof parseStatementText>,
  label: string,
) {
  assert(parsed.periodStart === "2026-07-01", `${label} start ${parsed.periodStart}`);
  assert(parsed.periodEnd === "2026-09-30", `${label} end ${parsed.periodEnd}`);
  assert(parsed.periodMonths === 3, `${label} months ${parsed.periodMonths}`);
  assert(parsed.periodLabel != null, `${label} has a label`);
}
assertQuarter(periodHeader("1 Jul 2026 – 30 Sep 2026", ZA_MARKET), "ZA month names");
assertQuarter(periodHeader("Jul 1, 2026 - Sep 30, 2026", US), "US month names");
assertQuarter(periodHeader("01/07/2026-30/09/2026", ZA_MARKET), "ZA numeric");
assertQuarter(periodHeader("01/07/2026 – 30/09/2026", ZA_MARKET), "ZA numeric en-dash");
assertQuarter(periodHeader("01.07.2026-30.09.2026", ZA_MARKET), "ZA dots");
assertQuarter(periodHeader("01-07-2026 - 30-09-2026", ZA_MARKET), "ZA dashes");
assertQuarter(periodHeader("07/01/2026-09/30/2026", US), "US numeric");
assertQuarter(periodHeader("07/01/2026 - 09/30/2026", US), "US numeric spaces");
assertQuarter(periodHeader("Q3 2026", US), "Q3");
assertQuarter(periodHeader("Q3 FY2026", ZA_MARKET), "Q3 FY");

const fileSpan = statementSpan(quarter.periodStart, quarter.periodEnd, quarter.periodMonths);
assert(fileSpan?.months === 3, "file span is the quarter");

const before = liveHealthFromBooks({ financials: existing, fyStartMonth: 1, market: US });
const asked = planStatementImport({
  existing,
  incoming: quarter.fields,
  kind: "income_statement",
  span: fileSpan,
  market: US,
  pillarsBefore: before.pillars,
});
assert(asked.action === "choose", asked.action);
assert(asked.message.includes("add this as Q3"), asked.message);
assert(asked.message.includes("Jul 1 – Sep 30, 2026"), asked.message);
assert(asked.message.includes("Jan 1 – Sep 30, 2026"), asked.message);
assert(asked.live == null && asked.history == null, "a mismatch writes nothing until someone chooses");

const zaAsk = planStatementImport({
  existing,
  incoming: quarter.fields,
  kind: "income_statement",
  span: fileSpan,
  market: ZA_MARKET,
  pillarsBefore: before.pillars,
});
assert(zaAsk.message.includes("1 Jul – 30 Sep 2026"), zaAsk.message);
assert(zaAsk.message.includes("1 Jan – 30 Sep 2026"), zaAsk.message);

const garbage = periodHeader("garbage", US);
assert(garbage.periodStart == null && garbage.periodEnd == null && garbage.periodMonths == null, "garbage has no span");
const garbageIncoming = { ...garbage.fields, revenue: "100000", periodStart: "2026-01-01", periodEnd: "2026-09-30", periodMonths: "9" };
const accountantCover = liveCoverageForImport({
  existing,
  periodStart: garbage.periodStart,
  periodEnd: garbage.periodEnd,
  periodMonths: garbage.periodMonths,
  fyStartMonth: 1,
});
assert(accountantCover.span == null && accountantCover.periodStart == null, "accountant does not expand garbage over Jan–Sep");
const accountantPlan = planStatementImport({
  existing,
  incoming: garbageIncoming,
  kind: "income_statement",
  span: accountantCover.span,
  choice: "replace_ytd",
  market: US,
  pillarsBefore: before.pillars,
});
assert(accountantPlan.action === "choose" || accountantPlan.action === "block", accountantPlan.action);
assert(accountantPlan.live == null, "accountant garbage does not write live");
assert(accountantPlan.live?.periodStart !== "2026-01-01" && accountantPlan.live?.revenue !== "100000", "quarter revenue stays off the year-to-date");
const ownerSpan = statementSpan(garbage.periodStart, garbage.periodEnd, garbage.periodMonths);
const ownerPlan = planStatementImport({
  existing,
  incoming: garbageIncoming,
  kind: "income_statement",
  span: ownerSpan,
  market: US,
  pillarsBefore: before.pillars,
});
assert(ownerPlan.action === "choose" || ownerPlan.action === "block", ownerPlan.action);
assert(ownerPlan.live == null, "owner garbage does not write live");
const firstImport = liveCoverageForImport({
  existing: {},
  periodEnd: "2026-09-30",
  fyStartMonth: 1,
});
assert(firstImport.periodStart === "2026-01-01" && firstImport.months === 9, "a first import still counts from the financial year");

const replaced = planStatementImport({
  existing,
  incoming: quarter.fields,
  kind: "income_statement",
  span: fileSpan,
  choice: "replace_ytd",
  market: US,
  pillarsBefore: before.pillars,
});
assert(replaced.action === "live", replaced.action);
assert(replaced.live?.cash === "46300", `cash stayed ${replaced.live?.cash}`);
assert(replaced.live?.revenue === "182000", `revenue ${replaced.live?.revenue}`);
assert(replaced.live?.periodStart === "2026-07-01", String(replaced.live?.periodStart));
assert(replaced.live?.periodEnd === "2026-09-30", String(replaced.live?.periodEnd));
assert(replaced.live?.periodMonths === "3", String(replaced.live?.periodMonths));
assert(replaced.live?.fixedCosts === "", "previous operating expenses do not stay");
assert(replaced.live?.ebit === "", "previous operating income does not stay");
assert(replaced.live?.tax === "", "tax the file does not contain is not kept");
assert(replaced.live?.netIncome === "", "net profit is not copied from profit before tax");
assert(String(replaced.live?.receivables) === "38900", "the balance sheet stays");
assert(replaced.message.includes("Balance sheet was not in the file"), replaced.message);
assert(replaced.message.includes("Upload a balance sheet to keep cash current."), replaced.message);
assert(
  earlierStatementNote(replaced.live, US) === "as at Sep 30, 2026, from earlier statement",
  earlierStatementNote(replaced.live, US) ?? "no note",
);
assert(
  earlierStatementNote(replaced.live, ZA_MARKET) === "as at 30 Sep 2026, from earlier statement",
  earlierStatementNote(replaced.live, ZA_MARKET) ?? "no ZA note",
);

const heldHealth = liveHealthFromBooks({
  financials: { ...replaced.live, revenue: "1" },
  fyStartMonth: 1,
  market: US,
});
const cashBefore = before.pillars.find((pillar) => pillar.id === "cash");
const cashAfter = heldHealth.pillars.find((pillar) => pillar.id === "cash");
assert(cashBefore?.score != null && cashAfter?.score === cashBefore.score, "cash pillar stays on the earlier statement");
const stripped = { ...replaced.live };
delete stripped.sheetPillarsHeld;
const moved = liveHealthFromBooks({ financials: { ...stripped, revenue: "1" }, fyStartMonth: 1, market: US });
const cashMoved = moved.pillars.find((pillar) => pillar.id === "cash");
assert(cashMoved?.score !== cashBefore?.score, "without the hold, the poisoned revenue moves cash");

const ratios = computeRatios(replaced.live as never);
assert(!Number.isFinite(ratios["Fixed Cost Ratio"]), `fixed cost ratio ${ratios["Fixed Cost Ratio"]}`);
assert(!Number.isFinite(ratios["Tax Burden"]), `tax burden ${ratios["Tax Burden"]}`);
assert(!Number.isFinite(ratios["Debtor Days"]), `debtor days ${ratios["Debtor Days"]}`);
assert(Number.isFinite(ratios["Gross Margin"]), "gross margin still uses this statement");
for (const name of ["Fixed Cost Ratio", "Tax Burden", "Debtor Days"] as const) {
  const shown = presentScorecardRatio({ name, value: ratios[name], periodMonths: 3 });
  assert(shown.text === "Not enough data", `${name} shows ${shown.text}`);
}

const added = planStatementImport({
  existing,
  incoming: quarter.fields,
  kind: "income_statement",
  span: fileSpan,
  choice: "add_period",
  market: US,
  pillarsBefore: before.pillars,
});
assert(added.action === "history" && added.live == null, "adding Q3 does not touch the live books");
assert(added.history?.revenue === "182000", "the quarter is stored on its own");
assert(added.history?.cash == null, "the history row does not copy cash");
assert(added.message.includes("Year-to-date books are unchanged"), added.message);

assert(
  signoffStatusLine({ kind: "stale", variant: "short", scopeLabel: "Financials" }) ===
    "Financials: signed off · figures changed",
  "the owner chip keeps the figures-changed sentence",
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
  replaced.live as Record<string, string>,
).doc;
const versus = budgetVersusStatement(seeded, replaced.live, US);
assert(versus != null, "the quarter compares with the plan");
assert(versus!.periodMonths === 3, `budget window is ${versus!.periodMonths} months`);
assert(Math.abs(versus!.revenue - 182000) < 1, `verdict revenue ${versus!.revenue}`);
assert(Math.abs(versus!.budgetRevenue - 182000) < 50, `plan revenue for the quarter ${versus!.budgetRevenue}`);
const views = budgetMonthViews(seeded, []);
const chart = budgetRangeTotals(views.filter((row) => (versus!.windowMonths ?? []).includes(row.month)));
assert(Math.abs(chart.revenue - versus!.budgetRevenue) < 1, `chart revenue ${chart.revenue} vs ${versus!.budgetRevenue}`);
assert(Math.abs(chart.net - versus!.budgetEbit) < 1, `chart net ${chart.net} vs ${versus!.budgetEbit}`);
assert(Math.abs(chart.revenue - 242667) > 1000, "the chart is not the quarter annualised as nine months");
const year = ownerYearFromStatement(versus);
const tableNet =
  year && versus!.chip === "Estimated from statement pace" ? versus!.budgetEbit : year?.netProfit;
assert(tableNet != null && Math.abs(tableNet - versus!.budgetEbit) < 1, `year net ${tableNet} vs ${versus!.budgetEbit}`);
assert(!hasPriorYearFigures(null), "no prior year");
assert(!ownerBudgetHowBuilt(false).includes("last year"), ownerBudgetHowBuilt(false));
assert(ownerBudgetHowBuilt(true).includes("last year's actuals"), "a real prior year still says so");

const money = (n: number) => fmtBudgetMoney(n, US);
const verdict = renderToStaticMarkup(
  createElement(BudgetVerdictStrip, {
    periodLabel: versus!.label,
    revenueBudget: versus!.budgetRevenue,
    revenueActual: versus!.revenue,
    profitBudget: versus!.budgetEbit,
    profitActual: versus!.ebit,
    chip: versus!.chip,
    market: US,
    presentation: "owner",
  }),
);
const yearStrip = renderToStaticMarkup(
  createElement(BudgetYearStrip, {
    thisYear: year ? { ...year, netProfit: tableNet ?? year.netProfit } : null,
    thisMonths: versus!.periodMonths,
    lastYear: null,
    market: US,
    signed: true,
  }),
);
assert(verdict.includes("Revenue vs budget"), "owner verdict names revenue");
assert(verdict.includes(money(versus!.budgetRevenue)), "verdict revenue is the quarter's plan");
assert(yearStrip.includes("No prior year on file."), yearStrip);
assert(yearStrip.includes(money(versus!.budgetEbit)), "the table net profit is the verdict profit");
assert(!yearStrip.includes("52,000"), "the previous operating income is not the table");
assert(!verdict.includes("242,667"), "the verdict is not the nine-month annualisation");

const simple = readFileSync(new URL("../src/components/budget/budget-simple-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/components/budget/budget-workspace.tsx", import.meta.url), "utf8");
assert(simple.includes("windowMonths={compared?.windowMonths}"), "owner chart uses the verdict window");
assert(simple.includes("ownerBudgetHowBuilt"), "owner how-built follows the prior year");
assert(workspace.includes("windowMonths={actuals?.windowMonths}"), "accountant chart uses the same window");

const overlay = overlayParsedStatement(
  {
    entity_name: null,
    registration_number: null,
    currency: "USD",
    units: "actual",
    statement_basis: "unknown",
    current_period: {
      period_end: "2026-09-30",
      figures: {
        income_statement: {
          revenue: 1,
          cost_of_sales: null,
          gross_profit: null,
          other_income: null,
          operating_expenses: null,
          depreciation_amortisation: null,
          operating_profit: null,
          finance_income: null,
          finance_costs: null,
          profit_before_tax: null,
          income_tax: null,
          profit_after_tax: null,
        },
        balance_sheet: {
          non_current_assets: {
            property_plant_equipment: null,
            intangible_assets: null,
            investments: null,
            deferred_tax_asset: null,
            other: null,
            total: null,
          },
          current_assets: {
            inventories: null,
            trade_and_other_receivables: null,
            cash_and_cash_equivalents: 1,
            other: null,
            total: null,
          },
          total_assets: 1,
          equity: { share_capital: null, retained_earnings: null, other_reserves: null, total: 1 },
          non_current_liabilities: { borrowings: null, deferred_tax_liability: null, other: null, total: null },
          current_liabilities: {
            trade_and_other_payables: null,
            borrowings: null,
            current_tax: null,
            bank_overdraft: null,
            other: null,
            total: null,
          },
          total_liabilities: null,
          total_equity_and_liabilities: null,
        },
        cash_flow: { cash_from_operating: 5, cash_from_investing: null, cash_from_financing: null, net_change_in_cash: null, cash_at_end: 9 },
      },
    },
    comparative_period: null,
    extraction_notes: null,
  } satisfies ExtractionResult,
  Q3,
);
assert(overlay.current_period.period_start === "2026-07-01", "parser span wins");
assert(overlay.current_period.figures.balance_sheet.current_assets.cash_and_cash_equivalents == null, "model cash is dropped");
const flat = periodFinancialsFromExtraction(overlay);
assert(flat.ebt === "37000", flat.ebt);
assert(flat.netIncome === "", `missing tax does not become net income (${flat.netIncome})`);
assert(flat.revenue === "182000", flat.revenue);
const gaps = statementNoteSections(overlay, (n) => String(n)).find((section) => section.title === "Gaps");
assert(
  gaps?.items.length === 1 && gaps.items[0] === "Balance sheet not in the file. Upload a balance sheet to keep cash current.",
  gaps?.items.join(" | ") ?? "no gaps",
);

console.log("pl-only period ok");
