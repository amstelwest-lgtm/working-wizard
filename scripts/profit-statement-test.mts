/**
 * Profit P&L and the year chart read the statement and snapshots already on file.
 * Run: pnpm test:profit-statement
 */
import { buildProfitPnl, presentProfitSeries, profitChartPoints, profitFlows, profitSeriesPoints } from "../src/lib/profit-statement.ts";
import { profitMenuViews, profitPagedSearch, profitPagedSentence, profitPagedViewFromSearch, PROFIT_PAGED_VIEWS } from "../src/lib/profit-paged-view.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const october = {
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  revenue: 51376,
  cogs: 267,
  grossProfit: 51109,
  fixedCosts: 18000,
  ebit: 33109,
  interest: 0,
  tax: 0,
  netIncome: 33109,
};
const september = {
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  revenue: 62895,
  cogs: 650,
  grossProfit: 62245,
  fixedCosts: 12000,
  ebit: 50245,
  netIncome: 50245,
};

const pnl = buildProfitPnl({ current: october, prior: september, fyStartMonth: 1 });
const sales = pnl.rows.find((row) => row.id === "sales");
assert(sales != null && sales.current === 51376 && sales.prior === 62895, "sales compare the two periods");
assert(sales?.variance === 51376 - 62895, "variance is current minus prior");
assert(sales?.favourable === false, "income down is adverse");
const cogs = pnl.rows.find((row) => row.id === "cogs");
assert(cogs?.favourable === true, "cost of sales down is favourable");
assert(pnl.rows.some((row) => row.id === "ytd") === false, "ytd is a column, not a row");
assert(sales?.ytd == null, "a single month with no year companion leaves YTD blank");

const year = {
  ...october,
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
  revenue: 400000,
  cogs: 80000,
  fixedCosts: 150000,
  ebit: 170000,
  netIncome: 170000,
};
const ytd = buildProfitPnl({ current: year, fyStartMonth: 1 });
assert(ytd.rows.find((row) => row.id === "sales")?.ytd === 400000, "a multi-month statement is the year to date");

const flows = profitFlows(october);
assert(flows?.income === 51376 && flows?.expenses === 18000, "income and expenses come from the statement");
assert(flows?.breakEven != null && flows.breakEven > 0, "break-even is derived from the margin");

const points = profitSeriesPoints({
  snapshots: [
    { period_date: "2026-09-30", period_label: "Sep 2026", financials: september },
    { period_date: "2026-10-31", period_label: "Oct 2026", financials: october },
  ],
});
assert(points.length === 2 && points.every((point) => point.span === "month"), "one-month statements stay months");
assert(points[1]?.expenses === 18000, "October expenses are the October statement");

const span = profitSeriesPoints({
  current: year,
  currentPeriodEnd: "2026-09-30",
  currentLabel: "Jan–Sep 2026",
});
assert(span.length === 1 && span[0]?.span === "period", "a nine-month statement is not split into invented months");
const shown = presentProfitSeries(span, { interval: "month" });
assert(shown.note?.includes("one span"), "the chart says the span is not monthly");
const weekly = presentProfitSeries(points, { interval: "week" });
assert(weekly.points.length === 2, "week view does not invent weeks");
assert(weekly.note?.includes("Weekly profit is not on the statement"), "week view says so");
const yearly = presentProfitSeries(points, { interval: "year" });
assert(yearly.points.length === 1 && yearly.points[0]?.income === 51376 + 62895, "a year adds the months on file");
const fromJune = presentProfitSeries(points, { interval: "month", startDate: "2026-10-01" });
assert(fromJune.points.length === 1 && fromJune.points[0]?.id === "2026-10", "start date drops earlier months");

const cumulative = profitSeriesPoints({
  snapshots: [
    {
      period_date: "2026-09-30",
      period_label: "Jan–Sep 2026",
      financials: { ...year, periodStart: "2026-01-01", periodEnd: "2026-09-30" },
    },
    {
      period_date: "2026-10-31",
      period_label: "Jan–Oct 2026",
      financials: {
        ...year,
        periodStart: "2026-01-01",
        periodEnd: "2026-10-31",
        revenue: 451376,
        fixedCosts: 168000,
        ebit: 203376,
        netIncome: 203376,
      },
    },
  ],
});
const octoberPoint = cumulative.find((point) => point.id === "2026-10");
assert(octoberPoint?.span === "month" && octoberPoint.income === 51376, "one new cumulative month is the difference");
const undated = profitChartPoints({
  current: { revenue: 40000, cogs: 10000, grossProfit: 30000 },
  currentLabel: "This period",
});
assert(undated.length === 1 && undated[0]?.grossProfit === 30000, "a P&L with no period end still charts");
assert((undated[0]?.netProfit ?? undated[0]?.operatingProfit ?? undated[0]?.grossProfit) === 30000, "gross profit is the chart value");

assert(PROFIT_PAGED_VIEWS.join(",") === "chart,pnl,waterfall,lines,setup,audit", "pnl stays a profit view id");
assert(profitMenuViews(true).join(",") === "chart,waterfall,lines,setup,audit", "P&L is not a tab inside Profit");
assert(profitPagedViewFromSearch({}) === "chart", "chart is the landing pane");
assert(profitPagedViewFromSearch({ section: "waterfall" }) === "waterfall", "the waterfall link stays");
assert(profitPagedViewFromSearch({ section: "lines" }) === "lines", "product lines stay");
assert(profitPagedViewFromSearch({ section: "pnl" }) === "pnl", "the P&L page is its own section");
assert(profitPagedViewFromSearch({ view: "pnl" }) === "pnl", "an old view=pnl link still names the table");
assert(profitPagedViewFromSearch({ view: "audit" }) === "audit", "view=audit is audit inputs");
const searched = profitPagedSearch({ tab: "profit", section: "waterfall" }, "pnl");
assert(searched.section === "pnl" && searched.view == null, "P&L is the section page and clears the waterfall");
for (const view of PROFIT_PAGED_VIEWS) {
  const sentence = profitPagedSentence(view);
  const stops = sentence.split(/[.!?]/).filter((part) => part.trim());
  assert(stops.length === 1, `${view} has one sentence`);
}

console.log("profit-statement-test: all assertions passed");
