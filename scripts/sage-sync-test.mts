/**
 * Sage Business Cloud Accounting (SA) sync — fixtures only, no live calls.
 * Run: pnpm test:sage-sync
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyLedgerSyncFinancials,
  emptyLedgerSyncError,
  ledgerSyncWouldWipe,
} from "../src/lib/ledger-sync-financials";
import { decryptSagePassword, encryptSagePassword } from "../src/lib/sage-password";
import { sageSyncWriteDecision } from "../src/lib/sage";
import {
  fetchSageLedgerStatement,
  mapSageToFinancialInputs,
  parseSageBalanceSheet,
  parseSageBankAccounts,
  parseSageCustomerAgeing,
  parseSageProfitAndLoss,
  parseSageSupplierAgeing,
  SAGE_SA_API_BASE,
  sageBasicAuthHeader,
  sageLedgerRanges,
  sageLevelAmount,
  sageRequestUrl,
  redactSageSecrets,
} from "../src/lib/sage-sync";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

process.env.SAGE_SA_API_KEY = "test-key-not-a-secret";
process.env.SAGE_SA_PASSWORD_KEY = "test-password-key-not-a-secret";
delete process.env.SAGE_SA_BASE_URL;

const pnl = [
  {
    Description: "Sales",
    Category: "Sales",
    ReportingLevelType: 1,
    Total: [120000, 0],
    Children: [
      { Description: "Sales - Products", ReportingLevelType: 3, Total: [100000, 0], Children: [] },
      { Description: "Sales - Services", ReportingLevelType: 3, Total: [20000, 0], Children: [] },
    ],
  },
  {
    Description: "Cost of Sales",
    Category: "Cost of Sales",
    ReportingLevelType: 1,
    Total: [45000, 0],
    Children: [],
  },
  { Description: "Gross Profit", ReportingLevelType: 10, Total: [75000, 0], Children: [] },
  {
    Description: "Other Income",
    Category: "Other Income",
    ReportingLevelType: 1,
    Total: [2000, 0],
    Children: [],
  },
  {
    Description: "Expenses",
    Category: "Expenses",
    ReportingLevelType: 1,
    Total: [25000, 0],
    Children: [
      { Description: "Depreciation", ReportingLevelType: 3, Total: [4000, 0], Children: [] },
      { Description: "Interest Paid", ReportingLevelType: 3, Total: [1000, 0], Children: [] },
      { Description: "Rent", ReportingLevelType: 3, Total: [20000, 0], Children: [] },
    ],
  },
  { Description: "Net Profit Before Tax", ReportingLevelType: 10, Total: [52000, 0], Children: [] },
  { Description: "Income Tax", ReportingLevelType: 3, Total: [5000, 0], Children: [] },
  { Description: "Net Profit", ReportingLevelType: 10, Total: [47000, 0], Children: [] },
];

assert(
  sageLevelAmount({ Total: [8633.6, 0] }) === 8633.6,
  "first column is the period, not the trailing zero",
);
const month = parseSageProfitAndLoss(pnl, 1);
assert(month.revenue === 122000, "revenue is sales plus other income");
assert(month.revenue !== 0, "trailing comparative zero is not revenue");
assert(month.cogs === 45000, "cost of sales");
assert(month.grossProfit === 75000, "gross profit");
assert(month.operatingExpenses === 25000, "expenses");
assert(month.netIncome === 47000, "net profit, not the before-tax line");
assert(month.ebt === 52000, "profit before tax");
assert(month.depreciation === 4000, "depreciation leaf");
assert(month.ebit === 53000, "ebit adds interest back");
assert(month.ebitda === 57000, "ebitda adds depreciation");
assert(month.periodMonths === 1, "month report is one month");

const year = parseSageProfitAndLoss(
  [
    {
      Description: "Sales",
      Category: "Sales",
      ReportingLevelType: 1,
      Total: [480000],
      Children: [],
    },
    { Description: "Net Profit", ReportingLevelType: 10, Total: [90000], Children: [] },
  ],
  10,
);
assert(year.revenue === 480000, "year revenue");
assert(year.netIncome === 90000, "year net profit");

const bs = parseSageBalanceSheet([
  {
    Description: "Non-Current Assets",
    Category: "Non-Current Assets",
    ReportingLevelType: 1,
    Total: 80000,
    Children: [],
  },
  {
    Description: "Current Assets",
    Category: "Current Assets",
    ReportingLevelType: 1,
    Total: 50000,
    Children: [
      { Description: "Inventory", ReportingLevelType: 2, Total: 12000, Children: [] },
      { Description: "Trade Receivables", ReportingLevelType: 2, Total: 18000, Children: [] },
      {
        Description: "Bank",
        ReportingLevelType: 2,
        Total: 20000,
        Children: [
          { Description: "Current Account", ReportingLevelType: 6, Total: 22000, Children: [] },
          { Description: "Credit Card", ReportingLevelType: 6, Total: -2000, Children: [] },
        ],
      },
    ],
  },
  { Description: "Total Assets", ReportingLevelType: 10, Total: 130000, Children: [] },
  {
    Description: "Owners Equity",
    Category: "Owners Equity",
    ReportingLevelType: 1,
    Total: 90000,
    Children: [],
  },
  {
    Description: "Current Liabilities",
    Category: "Current Liabilities",
    ReportingLevelType: 1,
    Total: 25000,
    Children: [
      { Description: "Trade Payables", ReportingLevelType: 2, Total: 15000, Children: [] },
    ],
  },
  {
    Description: "Non-Current Liabilities",
    Category: "Non-Current Liabilities",
    ReportingLevelType: 1,
    Total: 15000,
    Children: [],
  },
]);
assert(bs.totalAssets === 130000, "total assets");
assert(bs.currentAssets === 50000, "current assets");
assert(bs.currentLiabilities === 25000, "current liabilities");
assert(bs.equity === 90000, "equity");
assert(bs.receivables === 18000, "trade receivables");
assert(bs.inventory === 12000, "inventory");
assert(bs.payables === 15000, "trade payables");
assert(bs.cash === 20000, "bank group total, not a child account");

const banks = parseSageBankAccounts({
  TotalResults: 2,
  ReturnedResults: 2,
  Results: [
    { ID: 1, Name: "Current", Balance: 15000, Active: true },
    { ID: 2, Name: "Overdraft", Balance: -500, Active: true },
    { ID: 3, Name: "Closed", Balance: 999, Active: false },
  ],
});
assert(banks.accounts.length === 2, "inactive bank accounts are skipped");
assert(
  banks.accounts.reduce((sum, account) => sum + account.balance, 0) === 14500,
  "overdraft stays negative",
);

const aged = parseSageCustomerAgeing(
  [
    {
      Total: 800,
      Current: 300,
      Days30: 500,
      Days60: 0,
      Days90: 0,
      Days120Plus: 0,
      Customer: { ID: 9, Name: "Northwind" },
    },
  ],
  "2026-10-07",
);
assert(aged.source === "sage", "aged receivables are tagged sage");
assert(aged.status === "applied", "a named customer is applied");
assert(aged.contacts[0]?.name === "Northwind", "customer name");
assert(aged.contacts[0]?.outstanding === 800, "customer total");
assert(aged.totalOverdue === 500, "current bucket is not overdue");

const suppliers = parseSageSupplierAgeing(
  { Results: [{ Total: 150, Current: 150, Days30: 0, Supplier: { ID: 4, Name: "Acme Timber" } }] },
  "2026-10-07",
);
assert(suppliers.source === "sage", "aged payables are tagged sage");
assert(suppliers.suppliers[0]?.name === "Acme Timber", "supplier name");

const now = new Date("2026-10-07T12:00:00.000Z");
const ranges = sageLedgerRanges(now, null);
assert(ranges.month.from === "2026-10-01", "month starts on the 1st");
assert(ranges.month.to === "2026-10-07", "month ends today");
assert(ranges.year?.from === "2026-01-01", "missing financial year is calendar year to date");
assert(ranges.year?.basis === "calendar", "calendar basis is labeled calendar");
const octoberYear = sageLedgerRanges(now, 10);
assert(octoberYear.year == null, "a financial year that started this month is not stored twice");

const mapped = mapSageToFinancialInputs(
  month,
  bs,
  { from: ranges.month.from, to: ranges.month.to, label: ranges.month.label },
  {
    pnl: { revenue: year.revenue, netIncome: year.netIncome, periodMonths: year.periodMonths },
    from: "2026-01-01",
    to: "2026-10-07",
    label: "1 Jan 2026 – 7 Oct 2026",
    basis: "calendar",
  },
  14500,
);
assert(mapped.statementSource === "sage", "source tagged sage");
assert(mapped.revenue === 122000, "mapped month revenue");
assert(mapped.cash === 14500, "bank balances replace the balance-sheet cash line");
assert(mapped.ytdRevenue === 480000, "year-to-date revenue");
assert(mapped.ytdBasis === "calendar", "year basis");
assert(mapped.periodMonths === "1", "waterfall month");
assert(mapped.currentAssets === 50000, "current assets for the current ratio");

const prior = {
  statementSource: "pdf_upload",
  periodLabel: "1 Sep 2026 – 30 Sep 2026",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  revenue: "8633.6",
  cash: "7430.22",
  weeklyInputs: { weeks: { "1": { revenue: "1" } } },
};
const owned = applyLedgerSyncFinancials(prior, mapped, "sage");
assert(owned.statementSource === "sage", "Sage sync replaces the saved statement");
assert(owned.revenue === 122000, "Sage revenue replaces the statement");
assert(
  JSON.stringify(owned.weeklyInputs) === JSON.stringify(prior.weeklyInputs),
  "weekly inputs stay",
);

const zeroFields: Record<string, string | number> = {
  statementSource: "sage",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-07",
  periodLabel: "1 Oct 2026 – 7 Oct 2026",
  periodMonths: "1",
  revenue: 0,
  cogs: 0,
  netIncome: 0,
  cash: 0,
  totalAssets: 0,
  equity: 0,
  ytdRevenue: 0,
  ytdNetIncome: 0,
};
assert(ledgerSyncWouldWipe(prior, zeroFields), "an all-zero Sage report would wipe live figures");
const kept = applyLedgerSyncFinancials(prior, zeroFields, "sage");
assert(kept.statementSource === "pdf_upload", "empty Sage sync does not take the statement");
assert(kept.revenue === prior.revenue, "empty Sage sync keeps revenue");
assert(kept.cash === prior.cash, "empty Sage sync keeps cash");
assert(emptyLedgerSyncError("sage").includes("Sage"), "the empty-sync error names Sage");
assert(
  emptyLedgerSyncError("sage").includes("left unchanged"),
  "the empty-sync error says figures were left unchanged",
);
const blank = applyLedgerSyncFinancials({}, zeroFields, "sage");
assert(blank.statementSource === "sage", "the ledger helper still overlays a blank file");
assert(
  !sageSyncWriteDecision(zeroFields, prior).write,
  "sync refuses to write zeros over live figures",
);
const blankDecision = sageSyncWriteDecision(zeroFields, {});
assert(!blankDecision.write, "sync refuses an empty report even on a blank file");
assert(
  sageSyncWriteDecision(mapped, prior).write === true,
  "a real Sage statement may replace the file",
);

const url = sageRequestUrl("ProfitAndLoss/Get", {
  apiKey: "test-key-not-a-secret",
  companyId: "42",
});
assert(url.startsWith(`${SAGE_SA_API_BASE}/ProfitAndLoss/Get`), "SA API base");
assert(
  SAGE_SA_API_BASE === "https://accounting.sageone.co.za/api/2.0.0",
  "default is the live host",
);
process.env.SAGE_SA_BASE_URL = "https://resellers.accounting.sageone.co.za/api/2.0.0";
assert(
  sageRequestUrl("ProfitAndLoss/Get", { apiKey: "k", companyId: "42" }).startsWith(
    "https://resellers.accounting.sageone.co.za/api/2.0.0/ProfitAndLoss/Get",
  ),
  "sync honours SAGE_SA_BASE_URL (sandbox)",
);
delete process.env.SAGE_SA_BASE_URL;
const syncServer = read("src/lib/sage-sync.server.ts");
assert(syncServer.includes("needsReencrypt"), "sync re-encrypts legacy password rows");
assert(
  syncServer.indexOf("fetchSageLedgerStatement(") <
    syncServer.indexOf("reencryptSagePassword(input.clientId"),
  "re-encrypt only after Sage accepted the login",
);
assert(url.includes("apikey=test-key-not-a-secret"), "apikey query");
assert(url.includes("CompanyId=42"), "company id query");
assert(!url.includes("oauth.accounting.sage.com"), "not the UK OAuth host");
assert(!url.includes("api.accounting.sage.com"), "not the UK accounting host");
assert(
  sageBasicAuthHeader("owner@example.com", "secret") ===
    `Basic ${Buffer.from("owner@example.com:secret").toString("base64")}`,
  "basic auth is email:password",
);
assert(
  redactSageSecrets(url, ["test-key-not-a-secret"]).includes("apikey=[redacted]"),
  "logs redact the api key",
);

const stored = encryptSagePassword("secret");
assert(stored.startsWith("enc:v1:"), "password ciphertext is versioned");
assert(!stored.includes("secret"), "ciphertext does not contain the password");
assert(decryptSagePassword(stored) === "secret", "password round-trips");
let rejected = false;
try {
  decryptSagePassword("plaintext-password");
} catch {
  rejected = true;
}
assert(rejected, "plaintext password_enc is refused");

const calls: string[] = [];
const ledger = await fetchSageLedgerStatement(
  {
    username: "owner@example.com",
    password: "secret",
    apiKey: "test-key-not-a-secret",
    companyId: "42",
  },
  now,
  null,
  async (input, init) => {
    const href = String(input);
    calls.push(`${init?.method ?? "GET"} ${new URL(href).pathname}`);
    const path = new URL(href).pathname;
    if (path.endsWith("/ProfitAndLoss/Get")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { FromDate?: string };
      return new Response(
        JSON.stringify(
          body.FromDate === "2026-01-01"
            ? [
                {
                  Description: "Sales",
                  Category: "Sales",
                  ReportingLevelType: 1,
                  Total: [480000],
                  Children: [],
                },
                { Description: "Net Profit", ReportingLevelType: 10, Total: [90000], Children: [] },
              ]
            : pnl,
        ),
      );
    }
    if (path.endsWith("/BalanceSheet/Get"))
      return new Response(
        JSON.stringify([
          {
            Description: "Current Assets",
            Category: "Current Assets",
            ReportingLevelType: 1,
            Total: 50000,
            Children: [],
          },
          { Description: "Total Assets", ReportingLevelType: 10, Total: 50000, Children: [] },
          {
            Description: "Owners Equity",
            Category: "Owners Equity",
            ReportingLevelType: 1,
            Total: 20000,
            Children: [],
          },
        ]),
      );
    if (path.endsWith("/BankAccount/Get")) {
      return new Response(
        JSON.stringify({
          ReturnedResults: 1,
          Results: [{ ID: 1, Name: "Current", Balance: 14500, Active: true }],
        }),
      );
    }
    if (path.endsWith("/CustomerAgeing/GetSummary")) {
      return new Response(
        JSON.stringify([{ Total: 10, Current: 10, Customer: { ID: 1, Name: "Northwind" } }]),
      );
    }
    if (path.endsWith("/SupplierAgeing/GetSummary")) {
      return new Response("nope", { status: 500 });
    }
    return new Response("missing", { status: 404 });
  },
);
assert(
  calls.filter((call) => call.includes("ProfitAndLoss")).length === 2,
  "month and year profit and loss",
);
assert(
  calls.some((call) => call.startsWith("POST") && call.includes("BalanceSheet")),
  "balance sheet is a POST",
);
assert(
  calls.some((call) => call.includes("BankAccount")),
  "bank accounts",
);
assert(ledger.cash === 14500, "sync cash is the bank total");
assert(ledger.cashSource === "bank_accounts", "cash came from bank accounts");
assert(ledger.year?.pnl.revenue === 480000, "year companion");
assert(ledger.agedAr.status === "applied", "customer ageing applied");
assert(ledger.agedAp.status === "skipped", "supplier ageing failure does not fail the statement");
assert(!calls.some((call) => call.includes("Company/Get")), "sync does not call Company/Get");
assert(!calls.some((call) => call.includes("Login/Validate")), "sync does not call Login/Validate");

const src = read("src/lib/sage-sync.ts");
const server = read("src/lib/sage-sync.server.ts");
const route = read("src/routes/api/sage/sync.ts");
for (const file of [src, server, route, read("docs/SAGE.md")]) {
  assert(!file.includes("oauth.accounting.sage.com"), "no UK token host");
  assert(!file.includes("SAGE_CLIENT_ID"), "no UK client id");
  assert(!file.includes("SAGE_CLIENT_SECRET"), "no UK client secret");
  assert(!file.includes("/api/sage/callback"), "no OAuth callback");
}
assert(server.includes("sageSyncWriteDecision"), "Sage sync refuses an empty report");
assert(
  server.includes('applyLedgerSyncFinancials(prev, fields, "sage")'),
  "Sage sync owns the live file",
);
assert(read("src/lib/sage.functions.ts").includes("executeSageSync"), "connect stub runs the sync");
assert(
  !existsSync(resolve("src/lib/sage-sync.functions.ts")),
  "there is no second triggerSageSync",
);
assert(server.includes('source: "sage"'), "snapshot source is sage");
assert(route.includes('createFileRoute("/api/sage/sync")'), "sync route is /api/sage/sync");
assert(
  !read("src/lib/sage-password.ts").includes("sk_live"),
  "no live secret in the password helper",
);

console.log("sage-sync-test: ok");
