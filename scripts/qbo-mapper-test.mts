/**
 * QuickBooks report mapper — fixtures only, no live Intuit calls.
 * Run: pnpm test:qbo-mapper
 */
import { calendarMonthBounds, formatStatementPeriodLabel, resolveSnapshotPeriodLabel, statementYearLine } from "../src/lib/statement-period";
import {
  mapQboToFinancialInputs,
  parseQboBalanceSheet,
  parseQboFiscalYearStartMonth,
  parseQboProfitAndLoss,
  qboBalanceSheetPath,
  qboMoneyColumnIndex,
  qboProfitAndLossPath,
  qboYearRangeFromFiscalStart,
  redactSecrets,
} from "../src/lib/qbo";
import { periodMonthsBetween } from "../src/lib/xero";
import {
  qboOauthStateIsFresh,
  sanitizeQboOauthReason,
  sanitizeQboReturnPath,
} from "../src/lib/qbo-state";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function moneyRow(group: string, label: string, amount: string, trailing = "0.00") {
  return {
    group,
    Summary: {
      ColData: [{ value: label }, { value: amount }, { value: trailing }],
    },
  };
}

const columns = {
  Column: [
    { ColType: "Account", ColTitle: "" },
    { ColType: "Money", ColTitle: "Total" },
    { ColType: "Money", ColTitle: "" },
  ],
};

const pnlFixture = {
  Header: { StartPeriod: "2026-09-01", EndPeriod: "2026-09-21" },
  Columns: columns,
  Rows: {
    Row: [
      moneyRow("Income", "Total Income", "8633.60"),
      moneyRow("COGS", "Total Cost of Goods Sold", "2100.00"),
      moneyRow("GrossProfit", "Gross Profit", "6533.60"),
      {
        group: "Expenses",
        Summary: { ColData: [{ value: "Total Expenses" }, { value: "3200.00" }, { value: "0.00" }] },
        Rows: {
          Row: [{ ColData: [{ value: "Depreciation" }, { value: "400.00" }, { value: "0.00" }] }],
        },
      },
      moneyRow("NetOperatingIncome", "Net Operating Income", "3333.60"),
      moneyRow("NetIncome", "Net Income", "2800.00"),
    ],
  },
};

assert(qboMoneyColumnIndex(pnlFixture) === 1, "first Total money column, not the trailing zero");
const monthPnl = parseQboProfitAndLoss(pnlFixture, 1);
assert(monthPnl.revenue === 8633.6, "revenue is the Total column");
assert(monthPnl.revenue !== 0, "trailing 0.00 is not revenue");
assert(monthPnl.cogs === 2100, "cogs");
assert(monthPnl.netIncome === 2800, "net income");
assert(monthPnl.periodMonths === 1, "month report is one month");
assert(monthPnl.depreciation === 400, "depreciation row");

const yearFixture = {
  Columns: columns,
  Rows: {
    Row: [
      moneyRow("Income", "Total Income", "480000.00"),
      moneyRow("COGS", "Total COGS", "180000.00"),
      moneyRow("GrossProfit", "Gross Profit", "300000.00"),
      moneyRow("Expenses", "Total Expenses", "150000.00"),
      moneyRow("NetIncome", "Net Income", "120000.00"),
    ],
  },
};
const yearPnl = parseQboProfitAndLoss(yearFixture, periodMonthsBetween("2026-01-01", "2026-09-21"));
assert(yearPnl.periodMonths === 9, "Jan 1 through Sep 21 is 9 months, not 1");
assert(yearPnl.revenue === 480000, "year revenue");

const bsFixture = {
  Columns: columns,
  Rows: {
    Row: [
      moneyRow("Assets", "Total Assets", "900000.00"),
      {
        group: "BankAccounts",
        Summary: { ColData: [{ value: "Total Bank Accounts" }, { value: "42000.00" }, { value: "0.00" }] },
      },
      moneyRow("AR", "Accounts Receivable", "30000.00"),
      moneyRow("Liabilities", "Total Liabilities", "400000.00"),
      moneyRow("AP", "Accounts Payable", "18000.00"),
      moneyRow("Equity", "Total Equity", "500000.00"),
    ],
  },
};
const bs = parseQboBalanceSheet(bsFixture);
assert(bs.totalAssets === 900000, "assets");
assert(bs.cash === 42000, "bank accounts, not the trailing zero");
assert(bs.equity === 500000, "equity");

const now = new Date("2026-09-21T15:00:00Z");
const month = calendarMonthBounds(now, 0);
assert(month.from === "2026-09-01" && month.to === "2026-09-21", "September month-to-date bounds");
const monthLabel = formatStatementPeriodLabel(month.from, month.to);
assert(monthLabel === "1 Sep 2026 – 21 Sep 2026", "label has both dates");
assert(monthLabel !== "Sep 2026", "label is not a bare month");

const fy = qboYearRangeFromFiscalStart(now, 4);
assert(fy.from === "2026-04-01" && fy.to === "2026-09-21", "April fiscal start is 1 Apr through today");
assert(fy.basis === "financial", "known fiscal start is a financial year");
assert(parseQboFiscalYearStartMonth({ CompanyInfo: { FiscalYearStartMonth: "April" } }) === 4, "April");
assert(parseQboFiscalYearStartMonth({ CompanyInfo: { FiscalYearStartMonth: "January" } }) === 1, "January");
assert(parseQboFiscalYearStartMonth({}) === null, "missing fiscal month");

const mapped = mapQboToFinancialInputs(
  monthPnl,
  bs,
  { from: month.from, to: month.to, label: monthLabel },
  {
    pnl: { revenue: yearPnl.revenue, netIncome: yearPnl.netIncome, periodMonths: yearPnl.periodMonths },
    from: "2026-01-01",
    to: "2026-09-21",
    label: formatStatementPeriodLabel("2026-01-01", "2026-09-21"),
    basis: "calendar",
  },
  1500,
);
assert(mapped.statementSource === "qbo", "source tagged qbo");
assert(mapped.periodLabel === "1 Sep 2026 – 21 Sep 2026", "month label stored");
assert(mapped.periodStart === "2026-09-01" && mapped.periodEnd === "2026-09-21", "month dates stored");
assert(mapped.periodMonths === "1", "waterfall month is not the 9-month total");
assert(mapped.revenue === 8633.6, "primary revenue is the month");
assert(mapped.ytdRevenue === 480000, "year revenue is the companion");
assert(mapped.ytdPeriodLabel === "1 Jan 2026 – 21 Sep 2026", "year label has both dates");
assert(mapped.ytdPeriodMonths === "9", "year count is 9");
assert(mapped.ytdBasis === "calendar", "calendar when that is the basis passed in");
assert(mapped.operatingCashflow === 1500, "month cash flow stored");
assert(!String(mapped.periodLabel).includes("Sep 2026 –") || String(mapped.periodLabel).startsWith("1 Sep"), "not a bare month stamp");

const yearLine = statementYearLine(mapped);
assert(yearLine?.revenue === 480000, "waterfall reads the QuickBooks year companion");
assert(yearLine?.periodLabel === "1 Jan 2026 – 21 Sep 2026", "waterfall shows both year dates");

const same = mapQboToFinancialInputs(
  monthPnl,
  bs,
  { from: month.from, to: month.to, label: monthLabel },
  {
    pnl: { revenue: monthPnl.revenue, netIncome: monthPnl.netIncome, periodMonths: 1 },
    from: month.from,
    to: month.to,
    label: monthLabel,
    basis: "financial",
  },
);
assert(same.ytdRevenue == null, "identical ranges are not stored twice");

assert(
  resolveSnapshotPeriodLabel("1 Sep 2026 – 21 Sep 2026", "Sep 2026") === "1 Sep 2026 – 21 Sep 2026",
  "autosave must not retitle a dated QuickBooks snapshot as the month",
);
assert(resolveSnapshotPeriodLabel("Sep 2026", "Oct 2026") === "Oct 2026", "a real month stamp can move");

const pnlPath = qboProfitAndLossPath("2026-09-01", "2026-09-21");
assert(pnlPath.includes("start_date=2026-09-01"), "P&L start");
assert(pnlPath.includes("end_date=2026-09-21"), "P&L end");
assert(!pnlPath.includes("summarize_column_by"), "no extra month columns");
assert(qboBalanceSheetPath("2026-09-21").includes("date=2026-09-21"), "balance sheet date");

assert(redactSecrets('{"access_token":"secret-value"}').includes("[redacted]"), "token redacted");
assert(!redactSecrets('{"access_token":"secret-value"}').includes("secret-value"), "token value gone");

const clientId = "11111111-1111-1111-1111-111111111111";
assert(sanitizeQboReturnPath("/app", clientId) === "/app", "owner board");
assert(sanitizeQboReturnPath(`/clients/${clientId}`, clientId) === `/clients/${clientId}`, "studio");
assert(sanitizeQboReturnPath("https://evil.example", clientId) === `/clients/${clientId}`, "rejects open redirect");
assert(sanitizeQboOauthReason("access_denied") === "access_denied", "known reason kept");
assert(sanitizeQboOauthReason("token secret") === "denied", "free text dropped");
assert(qboOauthStateIsFresh(new Date(Date.now() - 60_000).toISOString()), "fresh state");
assert(!qboOauthStateIsFresh(new Date(Date.now() - 11 * 60_000).toISOString()), "expired state");

console.log("qbo-mapper-test: ok");
