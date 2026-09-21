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
  xeroRowAmount,
  xeroScopes,
  ytdRange,
} from "../src/lib/xero";

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

const empty = parseXeroProfitAndLoss({ Reports: [{ Rows: [] }] });
assert(empty.revenue === 0 && empty.netIncome === 0, "empty report is zeros, not throw");

const ownerSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(ownerSrc.includes("<XeroConnectCard"), "owner app mounts Xero connect");
assert(ownerSrc.includes('returnPath="/app"'), "owner OAuth returns to /app");
assert(!ownerSrc.includes("Xero coming later"), "placeholder copy removed from owner app");

const studioSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(studioSrc.includes("<XeroConnectCard"), "accountant studio mounts Xero connect");
assert(studioSrc.includes("search.xero"), "accountant studio handles ?xero= return");

const snapSrc = readFileSync(resolve("src/lib/financial-snapshots.ts"), "utf8");
assert(snapSrc.includes('"xero"'), "snapshot source includes xero");

const fnSrc = readFileSync(resolve("src/lib/xero.functions.ts"), "utf8");
assert(fnSrc.includes('source: "xero"'), "sync writes snapshot source xero");
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
