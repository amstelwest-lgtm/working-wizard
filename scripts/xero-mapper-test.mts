/**
 * Xero report mapper — fixtures only, no live Xero calls.
 * Run: pnpm test:xero-mapper
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeRatios, type RatioInputs } from "../src/lib/ratios";
import {
  mapXeroToFinancialInputs,
  parseXeroBalanceSheet,
  parseXeroConnections,
  parseXeroFinancialYearEnd,
  parseXeroProfitAndLoss,
  periodMonthsBetween,
  pickXeroTenant,
  redactSecrets,
  xeroBalanceSheetPath,
  xeroProfitAndLossRangePath,
  xeroRowAmount,
  xeroScopes,
  ytdRange,
} from "../src/lib/xero";
import {
  calendarMonthBounds,
  financialYearToDate,
  formatStatementPeriodLabel,
  statementYearLine,
} from "../src/lib/statement-period";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function section(
  title: string,
  rows: Array<{ label: string; amount: string; type?: string }>,
) {
  return {
    RowType: "Section",
    Title: title,
    Rows: rows.map((r) => ({
      RowType: r.type ?? "Row",
      Cells: [{ Value: r.label }, { Value: r.amount }],
    })),
  };
}

const pnlFixture = {
  Reports: [
    {
      ReportID: "ProfitAndLoss",
      ReportName: "Profit and Loss",
      Rows: [
        { RowType: "Header", Cells: [{ Value: "" }, { Value: "21 Sep 2026" }] },
        section("Income", [
          { label: "Sales", amount: "480000.00" },
          { label: "Total Income", amount: "480000.00", type: "SummaryRow" },
        ]),
        section("Less Cost of Sales", [
          { label: "Purchases", amount: "180000.00" },
          { label: "Total Cost of Sales", amount: "180000.00", type: "SummaryRow" },
        ]),
        {
          RowType: "Section",
          Title: "",
          Rows: [
            {
              RowType: "Row",
              Cells: [{ Value: "Gross Profit" }, { Value: "300000.00" }],
            },
          ],
        },
        section("Less Operating Expenses", [
          { label: "Wages", amount: "90000.00" },
          { label: "Depreciation", amount: "12000.00" },
          { label: "Rent", amount: "48000.00" },
          { label: "Total Operating Expenses", amount: "150000.00", type: "SummaryRow" },
        ]),
        section("Less Other Expenses", [
          { label: "Interest Expense", amount: "6000.00" },
          { label: "Income Tax Expense", amount: "24000.00" },
        ]),
        {
          RowType: "Section",
          Title: "",
          Rows: [
            {
              RowType: "Row",
              Cells: [{ Value: "Net Profit" }, { Value: "120000.00" }],
            },
          ],
        },
      ],
    },
  ],
};

const bsFixture = {
  Reports: [
    {
      ReportID: "BalanceSheet",
      ReportName: "Balance Sheet",
      Rows: [
        section("Assets", [
          { label: "Bank", amount: "85000.00" },
          { label: "Accounts Receivable", amount: "42000.00" },
          { label: "Inventory", amount: "31000.00" },
          { label: "Total Assets", amount: "220000.00", type: "SummaryRow" },
        ]),
        section("Liabilities", [
          { label: "Accounts Payable", amount: "28000.00" },
          { label: "Total Liabilities", amount: "70000.00", type: "SummaryRow" },
        ]),
        section("Equity", [
          { label: "Current Year Earnings", amount: "120000.00" },
          { label: "Total Equity", amount: "150000.00", type: "SummaryRow" },
        ]),
      ],
    },
  ],
};

const pnl = parseXeroProfitAndLoss(pnlFixture, 9);
assert(pnl.revenue === 480000, `revenue ${pnl.revenue}`);
assert(pnl.cogs === 180000, `cogs ${pnl.cogs}`);
assert(pnl.grossProfit === 300000, `gp ${pnl.grossProfit}`);
assert(pnl.operatingExpenses === 150000, `opex ${pnl.operatingExpenses}`);
assert(pnl.depreciation === 12000, `da ${pnl.depreciation}`);
assert(pnl.netIncome === 120000, `ni ${pnl.netIncome}`);
assert(pnl.ebit === 150000, `ebit ${pnl.ebit}`);
assert(pnl.ebt === 144000, `ebt ${pnl.ebt}`);
assert(pnl.ebitda === 162000, `ebitda ${pnl.ebitda}`);
assert(pnl.periodMonths === 9, "period months passed through");

const bs = parseXeroBalanceSheet(bsFixture);
assert(bs.totalAssets === 220000, `assets ${bs.totalAssets}`);
assert(bs.totalLiabilities === 70000, `liab ${bs.totalLiabilities}`);
assert(bs.equity === 150000, `eq ${bs.equity}`);
assert(bs.receivables === 42000, `ar ${bs.receivables}`);
assert(bs.inventory === 31000, `inv ${bs.inventory}`);
assert(bs.payables === 28000, `ap ${bs.payables}`);
assert(bs.cash === 85000, `cash ${bs.cash}`);

const mapped = mapXeroToFinancialInputs(pnl, bs);
assert(mapped.revenue === 480000, "mapped revenue");
assert(mapped.cogs === 180000, "mapped cogs");
assert(mapped.netIncome === 120000, "mapped ni");
assert(mapped.totalAssets === 220000, "mapped assets");
assert(mapped.equity === 150000, "mapped equity");
assert(mapped.receivables === 42000, "mapped ar");
assert(mapped.cash === 85000, "mapped cash from balance sheet Bank line");
assert(mapped.fixedCosts === 150000, "mapped opex as fixedCosts");
assert(mapped.periodMonths === "9", "YTD periodMonths so computeRatios annualises");
assert(mapped.operatingCashflow == null, "OCF stays unset — day-1 is P&L + BS only");

const ratioInputs = {
  netIncome: String(mapped.netIncome),
  ebt: String(mapped.ebt),
  ebit: String(mapped.ebit),
  revenue: String(mapped.revenue),
  totalAssets: String(mapped.totalAssets),
  equity: String(mapped.equity),
  cogs: String(mapped.cogs),
  receivables: String(mapped.receivables),
  inventory: String(mapped.inventory),
  payables: String(mapped.payables),
  fixedCosts: String(mapped.fixedCosts),
  variableCosts: "",
  top5Revenue: "",
  laborCost: "",
  employees: "",
  operatingCashflow: "",
  ebitda: String(mapped.ebitda),
  founderHours: "",
  periodMonths: String(mapped.periodMonths),
} satisfies RatioInputs;

const ratios = computeRatios(ratioInputs);
assert(Number.isFinite(ratios["Operating Margin"]), "operating margin from Xero map");
assert(Number.isFinite(ratios["Net Margin"]), "net margin from Xero map");
assert(!Number.isFinite(ratios["OCF / EBITDA"]), "OCF ratio stays n/a without cash-flow statement");

assert(periodMonthsBetween("2026-01-01", "2026-09-21") === 9, "YTD Sep = 9 months");
assert(periodMonthsBetween("2026-01-01", "2026-01-15") === 1, "same month = 1");
assert(periodMonthsBetween("2026-01-01", "2026-12-31") === 12, "full year = 12");
assert(ytdRange(new Date("2026-09-21T12:00:00Z")).from === "2026-01-01", "ytd from");

const tenants = parseXeroConnections([
  {
    id: "conn-a",
    tenantId: "ten-old",
    tenantType: "ORGANISATION",
    tenantName: "Old Co",
    updatedDateUtc: "2026-01-01T00:00:00",
  },
  {
    id: "conn-b",
    tenantId: "ten-new",
    tenantType: "ORGANISATION",
    tenantName: "New Co",
    updatedDateUtc: "2026-09-01T00:00:00",
  },
  {
    id: "conn-prac",
    tenantId: "prac",
    tenantType: "PRACTICE",
    tenantName: "Practice",
    updatedDateUtc: "2026-10-01T00:00:00",
  },
]);
const picked = pickXeroTenant(tenants);
assert(picked?.tenantId === "ten-new", `picked latest org, got ${picked?.tenantId}`);
assert(parseXeroConnections(null).length === 0, "null connections");
assert(pickXeroTenant([]) === null, "empty tenants");

assert(
  xeroScopes() ===
    "offline_access accounting.settings.read accounting.reports.profitandloss.read accounting.reports.balancesheet.read",
  "day-1 scopes only",
);
assert(!xeroScopes().includes("invoice"), "no invoice scope");
assert(!xeroScopes().includes("banksummary"), "no bank-feed / bank-summary scope");

const leaked = redactSecrets(
  '{"access_token":"secret-token","refresh_token":"r1"} Bearer abc.def Authorization: Bearer xyz',
);
assert(!leaked.includes("secret-token"), "redact access_token");
assert(!leaked.includes("r1"), "redact refresh_token");
assert(leaked.includes("[redacted]"), "redaction marker");

assert(xeroRowAmount({ Cells: [{ Value: "Sales" }, { Value: "1,200.50" }] }) === 1200.5, "comma amount");
assert(xeroRowAmount({ Cells: [{ Value: "Loss" }, { Value: "(40)" }] }) === -40, "paren negative");
assert(
  xeroRowAmount({
    Cells: [{ Value: "Sales" }, { Value: "8633.60" }, { Value: "29539.18" }],
  }) === 8633.6,
  "current period is the first amount column, not the later total",
);
assert(
  xeroRowAmount({
    Cells: [{ Value: "Total Assets" }, { Value: "42000.00" }, { Value: "0.00" }],
  }) === 42000,
  "trailing comparison zero is not the balance-sheet total",
);

const trailingZeroBs = parseXeroBalanceSheet({
  Reports: [
    {
      Rows: [
        {
          RowType: "Header",
          Cells: [{ Value: "" }, { Value: "21 Sep 2026" }, { Value: "31 Aug 2026" }],
        },
        {
          RowType: "Section",
          Title: "Bank",
          Rows: [
            {
              RowType: "Row",
              Cells: [{ Value: "Business Bank Account" }, { Value: "1500.00" }, { Value: "0.00" }],
            },
          ],
        },
        {
          RowType: "Section",
          Title: "",
          Rows: [
            {
              RowType: "SummaryRow",
              Cells: [{ Value: "Total Assets" }, { Value: "42000.00" }, { Value: "0.00" }],
            },
          ],
        },
      ],
    },
  ],
});
assert(trailingZeroBs.cash === 1500, `bs cash ignores trailing 0, got ${trailingZeroBs.cash}`);
assert(trailingZeroBs.totalAssets === 42000, `bs assets ignore trailing 0, got ${trailingZeroBs.totalAssets}`);

function monthColumns(
  label: string,
  amounts: string[],
  type = "Row",
) {
  return {
    RowType: type,
    Cells: [{ Value: label }, ...amounts.map((amount) => ({ Value: amount }))],
  };
}

const multiMonthPnl = {
  Reports: [
    {
      Rows: [
        {
          RowType: "Header",
          Cells: [
            { Value: "" },
            { Value: "1–21 Sep 2026" },
            { Value: "Aug 2026" },
            { Value: "Total" },
          ],
        },
        {
          RowType: "Section",
          Title: "Income",
          Rows: [
            monthColumns("Sales", ["8633.60", "11210.89", "29539.18"]),
            monthColumns("Total Trading Income", ["8633.60", "11210.89", "29539.18"], "SummaryRow"),
          ],
        },
        {
          RowType: "Section",
          Title: "Less Cost of Sales",
          Rows: [
            monthColumns("Purchases", ["100.00", "200.00", "775.98"]),
            monthColumns("Total Cost of Sales", ["100.00", "200.00", "775.98"], "SummaryRow"),
          ],
        },
        monthColumns("Net Profit", ["2000.00", "3000.00", "8266.73"]),
      ],
    },
  ],
};

const monthParsed = parseXeroProfitAndLoss(multiMonthPnl, 1, 0);
assert(monthParsed.revenue === 8633.6, `first column revenue ${monthParsed.revenue}`);
assert(monthParsed.cogs === 100, `first column cogs ${monthParsed.cogs}`);
assert(monthParsed.revenue !== 29539.18, "a later total column is not this month");

const now = new Date("2026-09-21T15:00:00Z");
const sepBounds = calendarMonthBounds(now, 0);
assert(sepBounds.from === "2026-09-01" && sepBounds.to === "2026-09-21", "open month ends today");
const augBounds = calendarMonthBounds(now, 1);
assert(augBounds.from === "2026-08-01" && augBounds.to === "2026-08-31", "prior month is complete");
assert(
  formatStatementPeriodLabel("2026-09-01", "2026-09-30") === "1 Sep 2026 – 30 Sep 2026",
  "full month keeps start and end",
);
assert(
  formatStatementPeriodLabel("2026-09-01", "2026-09-21") === "1 Sep 2026 – 21 Sep 2026",
  "month-to-date keeps start and end",
);
assert(
  formatStatementPeriodLabel("2026-04-01", "2026-09-21") === "1 Apr 2026 – 21 Sep 2026",
  "year range keeps both dates",
);

const fyMar = financialYearToDate(now, 3, 31);
assert(fyMar.from === "2026-04-01" && fyMar.to === "2026-09-21", `FY end 31 Mar → ${fyMar.from}`);
const fyDec = financialYearToDate(now, 12, 31);
assert(fyDec.from === "2026-01-01" && fyDec.to === "2026-09-21", `FY end 31 Dec → ${fyDec.from}`);
const fyJun = financialYearToDate(now, 6, 30);
assert(fyJun.from === "2026-07-01" && fyJun.to === "2026-09-21", `FY end 30 Jun → ${fyJun.from}`);
const fyFeb = financialYearToDate(new Date("2026-02-15T00:00:00Z"), 3, 31);
assert(
  fyFeb.from === "2025-04-01" && fyFeb.to === "2026-02-15",
  `FY still open in February → ${fyFeb.from} ${fyFeb.to}`,
);
const clamped = financialYearToDate(new Date("2026-03-10T00:00:00Z"), 2, 31);
assert(clamped.from === "2026-03-01", `29 Feb clamp starts 1 Mar, got ${clamped.from}`);

assert(
  parseXeroFinancialYearEnd({
    Organisations: [{ FinancialYearEndMonth: 3, FinancialYearEndDay: 31, Name: "Demo Company (Global)" }],
  })?.month === 3,
  "org financial year end month",
);
assert(parseXeroFinancialYearEnd({ Organisations: [] }) === null, "missing org year end");

const ledgerPath = xeroProfitAndLossRangePath(sepBounds.from, sepBounds.to);
assert(ledgerPath.includes("fromDate=2026-09-01"), "month pull starts this month");
assert(ledgerPath.includes("toDate=2026-09-21"), "month pull ends today");
assert(ledgerPath.includes("standardLayout=true"), "month pull uses the standard layout");
assert(!ledgerPath.includes("periods="), "month pull has no comparison periods");
assert(!ledgerPath.includes("timeframe="), "month pull has no timeframe");
const yearPath = xeroProfitAndLossRangePath(fyMar.from, fyMar.to);
assert(yearPath.includes("fromDate=2026-04-01"), "FY pull starts the financial year");
assert(yearPath.includes("toDate=2026-09-21"), "FY pull ends today");
assert(!yearPath.includes("periods="), "FY pull has no comparison periods");
const bsPath = xeroBalanceSheetPath(sepBounds.to);
assert(bsPath.includes("date=2026-09-21"), "balance sheet is as at the month end");
assert(bsPath.includes("standardLayout=true"), "balance sheet uses the standard layout");
assert(!bsPath.includes("periods="), "balance sheet is a single date");

const monthLabel = formatStatementPeriodLabel(sepBounds.from, sepBounds.to);
const periodMapped = mapXeroToFinancialInputs(
  { ...monthParsed, periodMonths: 1 },
  bs,
  { from: sepBounds.from, to: sepBounds.to, label: monthLabel },
  {
    pnl: { revenue: 29539.18, netIncome: 8266.73, periodMonths: 6 },
    from: fyMar.from,
    to: fyMar.to,
    label: formatStatementPeriodLabel(fyMar.from, fyMar.to),
    basis: "financial",
  },
);
assert(periodMapped.statementSource === "xero", "statement source tagged");
assert(periodMapped.periodStart === "2026-09-01", "period start stored");
assert(periodMapped.periodEnd === "2026-09-21", "period end stored");
assert(periodMapped.periodLabel === "1 Sep 2026 – 21 Sep 2026", "period label stored");
assert(periodMapped.revenue === 8633.6, "mapped revenue is the month, not YTD");
assert(periodMapped.periodMonths === "1", "a month is not annualised as nine months");
assert(periodMapped.ytdRevenue === 29539.18, "year revenue is stored beside the month");
assert(periodMapped.ytdNetIncome === 8266.73, "year net income stored");
assert(periodMapped.ytdBasis === "financial", "year basis is the financial year");
assert(periodMapped.ytdPeriodStart === "2026-04-01", "year start stored");
assert(periodMapped.ytdPeriodEnd === "2026-09-21", "year end stored");
assert(periodMapped.ytdPeriodLabel === "1 Apr 2026 – 21 Sep 2026", "year label stored");
assert(periodMapped.ytdPeriodMonths === "6", "year month count stored");

const zeroMonth = mapXeroToFinancialInputs(
  { ...monthParsed, revenue: 0, periodMonths: 1 },
  bs,
  { from: sepBounds.from, to: sepBounds.to, label: monthLabel },
);
assert(zeroMonth.revenue === 0, "a dated month replaces a previous multi-month revenue");
assert(zeroMonth.ytdRevenue == null, "no year companion when the year report is omitted");

const sameRange = mapXeroToFinancialInputs(
  { ...monthParsed, periodMonths: 1 },
  bs,
  { from: "2026-01-01", to: "2026-01-21", label: "1 Jan 2026 – 21 Jan 2026" },
  {
    pnl: { revenue: 29539.18, netIncome: 8266.73, periodMonths: 1 },
    from: "2026-01-01",
    to: "2026-01-21",
    label: "1 Jan 2026 – 21 Jan 2026",
    basis: "financial",
  },
);
assert(sameRange.ytdRevenue == null, "identical month and year ranges are not duplicated");

const yearLine = statementYearLine(periodMapped);
assert(yearLine?.revenue === 29539.18, "waterfall year line reads the companion");
assert(yearLine?.periodLabel === "1 Apr 2026 – 21 Sep 2026", "waterfall year line has both dates");
assert(statementYearLine({ revenue: "29539.18" }) === null, "undated total is not shown as a year");

const empty = parseXeroProfitAndLoss({ Reports: [{ Rows: [] }] });
assert(empty.revenue === 0 && empty.netIncome === 0, "empty report is zeros, not throw");

const ownerSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(ownerSrc.includes("<XeroConnectCard"), "owner app mounts Xero connect");
assert(ownerSrc.includes('returnPath="/app"'), "owner OAuth returns to /app");
assert(!ownerSrc.includes("Xero coming later"), "placeholder copy removed from owner app");
assert(ownerSrc.includes('id="owner-connect-xero"'), "owner data sources show Connect Xero");
assert(ownerSrc.includes('id="owner-connect-qbo"'), "owner Connect Xero sits next to QuickBooks");
assert(ownerSrc.includes('id="owner-header-xero"'), "owner header shows Xero without opening a tab");
const ownerConnect = ownerSrc.indexOf('id="owner-accounting-connect"');
const ownerUploadGrid = ownerSrc.indexOf(': "Upload financial statements"}');
assert(
  ownerConnect !== -1 && ownerUploadGrid !== -1 && ownerConnect < ownerUploadGrid,
  "owner data sources lead with QuickBooks and Xero",
);

const studioSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(studioSrc.includes("<XeroConnectCard"), "accountant studio mounts Xero connect");
assert(studioSrc.includes("search.xero"), "accountant studio handles ?xero= return");
assert(studioSrc.includes('id="accounting-connect"'), "accountant Xero is outside the Financials collapse");
assert(studioSrc.includes("onConnectXero={() => setShowXeroDialog(true)}"), "accountant briefing opens Xero");
const accountingConnect = studioSrc.indexOf('id="accounting-connect"');
const finCollapse = studioSrc.indexOf('id="finCollapse"');
assert(
  accountingConnect !== -1 && finCollapse !== -1 && accountingConnect < finCollapse,
  "Xero renders before the collapsed Financials body",
);
const briefingSrc = readFileSync(resolve("src/components/client-briefing.tsx"), "utf8");
assert(briefingSrc.includes('id="client-connect-xero"'), "briefing labels Connect Xero");
assert(briefingSrc.includes('id="xero-link-proof"'), "briefing shows the Xero link proof");
assert(briefingSrc.includes('id="client-connect-qbo"'), "briefing labels Connect QuickBooks beside Xero");
assert(briefingSrc.includes('id="client-upload-cta"'), "briefing has the primary Upload CTA");

const snapSrc = readFileSync(resolve("src/lib/financial-snapshots.ts"), "utf8");
assert(snapSrc.includes('"xero"'), "snapshot source includes xero");

const fnSrc = readFileSync(resolve("src/lib/xero.functions.ts"), "utf8");
assert(fnSrc.includes('source: "xero"'), "sync writes snapshot source xero");
assert(fnSrc.includes("fetchXeroLedgerStatement"), "sync pulls explicit dated statements");
assert(!fnSrc.includes("ytdRange("), "sync does not stamp calendar YTD as this month");
assert(!fnSrc.includes("periods=11"), "sync does not request comparison columns");
assert(fnSrc.includes("statementSource"), "status exposes a linked Xero statement");
const xeroSrc = readFileSync(resolve("src/lib/xero.ts"), "utf8");
assert(xeroSrc.includes('xeroGet(tenantId, accessToken, "/Organisation")'), "sync reads the financial year end");
assert(xeroSrc.includes("xeroProfitAndLossRangePath"), "P&L uses fromDate and toDate");
assert(!xeroSrc.includes("periods=11"), "client does not request comparison columns");
assert(!xeroSrc.includes("timeframe=MONTH"), "client does not ask for month columns");
const waterfallSrc = readFileSync(resolve("src/components/profitability-waterfall.tsx"), "utf8");
assert(waterfallSrc.includes("Month to date"), "waterfall names the month range");
assert(waterfallSrc.includes("yearToDateTitle"), "waterfall names the year range");
const periodSrc = readFileSync(resolve("src/lib/statement-period.ts"), "utf8");
assert(periodSrc.includes("Financial year to date"), "financial year label");
assert(periodSrc.includes("Calendar year to date"), "calendar year label");
const cashSrc = readFileSync(resolve("src/components/cash-forecast.tsx"), "utf8");
assert(cashSrc.includes("horizonLabel"), "cash forecast shows the horizon dates");
assert(fnSrc.includes("assertClientScope"), "server fns check impersonation scope");
assert(!fnSrc.includes("fetchXeroInvoices"), "no invoice pull in day-1 sync");
assert(!/console\.(log|info|debug|error)\([^)]*access_token/.test(fnSrc), "functions never log tokens");

const envSrc = readFileSync(resolve(".env.example"), "utf8");
assert(envSrc.includes("XERO_CLIENT_ID="), "env: client id");
assert(envSrc.includes("XERO_CLIENT_SECRET="), "env: client secret");
assert(envSrc.includes("XERO_REDIRECT_URI="), "env: redirect");
assert(!envSrc.includes("XERO_SCOPES"), "env docs are the three vars only");
assert(!envSrc.includes("XERO_SYNC"), "no invoice flag in env");

console.log("xero-mapper-test: ok");
