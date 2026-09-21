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
  parseXeroProfitAndLoss,
  periodMonthsBetween,
  pickXeroTenant,
  redactSecrets,
  selectFreshestXeroProfitAndLoss,
  xeroLedgerProfitAndLossPath,
  xeroRowAmount,
  xeroScopes,
  ytdRange,
} from "../src/lib/xero";
import { calendarMonthBounds, formatStatementPeriodLabel } from "../src/lib/statement-period";

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

const freshest = selectFreshestXeroProfitAndLoss(multiMonthPnl, {
  from: "2026-09-01",
  to: "2026-09-21",
});
assert(freshest.column === 0, `freshest column ${freshest.column}`);
assert(freshest.pnl.revenue === 8633.6, `freshest revenue ${freshest.pnl.revenue}`);
assert(freshest.pnl.cogs === 100, `freshest cogs stay on that column, got ${freshest.pnl.cogs}`);
assert(freshest.from === "2026-09-01" && freshest.to === "2026-09-21", "mtd bounds");
assert(freshest.periodLabel === "1–21 Sep 2026", `label ${freshest.periodLabel}`);
assert(freshest.pnl.revenue !== 29539.18, "year-to-date total column is not revenue");

const priorMonthPnl = {
  Reports: [
    {
      Rows: [
        {
          RowType: "Header",
          Cells: [{ Value: "" }, { Value: "Sep 2026" }, { Value: "Aug 2026" }],
        },
        {
          RowType: "Section",
          Title: "Trading Income",
          Rows: [
            monthColumns("Sales", ["0.00", "8633.60"]),
            monthColumns("Total Trading Income", ["0.00", "8633.60"], "SummaryRow"),
          ],
        },
        monthColumns("Net Profit", ["0.00", "1200.00"]),
      ],
    },
  ],
};
const prior = selectFreshestXeroProfitAndLoss(priorMonthPnl, {
  from: "2026-09-01",
  to: "2026-09-21",
});
assert(prior.column === 1, `falls back to prior month, got ${prior.column}`);
assert(prior.pnl.revenue === 8633.6, `prior month revenue ${prior.pnl.revenue}`);
assert(prior.from === "2026-08-01" && prior.to === "2026-08-31", `prior bounds ${prior.from} ${prior.to}`);
assert(prior.periodLabel === "Aug 2026", `prior label ${prior.periodLabel}`);

const sepBounds = calendarMonthBounds(new Date("2026-09-21T15:00:00Z"), 0);
assert(sepBounds.from === "2026-09-01" && sepBounds.to === "2026-09-21", "open month ends today");
const augBounds = calendarMonthBounds(new Date("2026-09-21T15:00:00Z"), 1);
assert(augBounds.from === "2026-08-01" && augBounds.to === "2026-08-31", "prior month is complete");
assert(
  formatStatementPeriodLabel("2026-09-01", "2026-09-30") === "Sep 2026",
  "full month label",
);
assert(
  formatStatementPeriodLabel("2026-09-01", "2026-09-21") === "1–21 Sep 2026",
  "month-to-date label",
);
const ledgerPath = xeroLedgerProfitAndLossPath(sepBounds.from, sepBounds.to);
assert(ledgerPath.includes("fromDate=2026-09-01"), "ledger pull starts this month");
assert(ledgerPath.includes("periods=11"), "ledger pull asks for prior months");
assert(ledgerPath.includes("timeframe=MONTH"), "ledger pull is monthly");
assert(ledgerPath.includes("standardLayout=true"), "ledger pull uses the standard layout");
assert(!ledgerPath.includes("fromDate=2026-01-01"), "ledger pull is not calendar YTD");

const periodMapped = mapXeroToFinancialInputs(freshest.pnl, bs, {
  from: freshest.from,
  to: freshest.to,
  label: freshest.periodLabel,
});
assert(periodMapped.statementSource === "xero", "statement source tagged");
assert(periodMapped.periodStart === "2026-09-01", "period start stored");
assert(periodMapped.periodEnd === "2026-09-21", "period end stored");
assert(periodMapped.periodLabel === "1–21 Sep 2026", "period label stored");
assert(periodMapped.revenue === 8633.6, "mapped revenue is the month, not YTD");
assert(periodMapped.periodMonths === "1", "a month is not annualised as nine months");

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
assert(fnSrc.includes("fetchXeroLedgerStatement"), "sync pulls the freshest month, not year-to-date");
assert(!fnSrc.includes("ytdRange("), "sync does not stamp calendar YTD as this month");
assert(fnSrc.includes("statementSource"), "status exposes a linked Xero statement");
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
