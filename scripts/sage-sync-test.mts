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
import { SAGE_EMPTY_COMPANY_MESSAGE, sageSyncWriteDecision } from "../src/lib/sage";
import { agedArProofLine } from "../src/lib/collections";
import { agedApProofLine } from "../src/lib/payables";
import {
  fetchSageLedgerStatement,
  mapSageToFinancialInputs,
  parseSageBalanceSheet,
  parseSageBankAccounts,
  parseSageCustomerAgeing,
  parseSageFinancialYearStartMonth,
  parseSagePartyBalances,
  parseSageProfitAndLoss,
  parseSageSupplierAgeing,
  sageAgeingBody,
  sageMappingIssue,
  SAGE_SA_API_BASE,
  SAGE_SA_TIME_ZONE,
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
assert(aged.totalOverdue === 0, "a previous calendar month is not days overdue");
assert(aged.contacts[0]?.buckets[1]?.label === "1 month", "Days30 is one month back");
assert(aged.contacts[0]?.buckets[1]?.amount === 500, "previous month keeps its amount");

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
assert(SAGE_SA_TIME_ZONE === "Africa/Johannesburg", "Sage periods use South African time");
const afterUtcMidnight = sageLedgerRanges(new Date("2026-10-11T22:30:00.000Z"), null);
assert(afterUtcMidnight.month.from === "2026-10-01", "Johannesburg month still opens on the 1st");
assert(afterUtcMidnight.month.to === "2026-10-12", "22:30 UTC is the next morning in Johannesburg");
assert(afterUtcMidnight.year?.to === "2026-10-12", "calendar year ends on the Johannesburg day");
const marchYear = sageLedgerRanges(new Date("2026-10-11T22:30:00.000Z"), 3);
assert(marchYear.year?.from === "2026-03-01", "a March year start is financial year to date");
assert(marchYear.year?.basis === "financial", "client financial year is labeled financial");
assert(marchYear.year?.to === "2026-10-12", "financial year ends on the Johannesburg day");

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
const quietCompany = sageSyncWriteDecision(zeroFields, prior);
assert(!quietCompany.write, "an all-zero company does not overwrite live figures");
if (!quietCompany.write) {
  assert(quietCompany.neutral === true, "an all-zero company is not a connection error");
  assert(
    quietCompany.error === SAGE_EMPTY_COMPANY_MESSAGE,
    "empty company says it is connected with no transactions",
  );
  assert(!quietCompany.error.includes("left unchanged"), "empty company is not the wipe error");
}
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
const spaced = encryptSagePassword("  secret  ");
assert(
  decryptSagePassword(spaced) === "  secret  ",
  "stored password is the one Sage validated, spaces included",
);
let blankPassword = false;
try {
  encryptSagePassword("   ");
} catch {
  blankPassword = true;
}
assert(blankPassword, "trim is only the emptiness check");
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
assert(
  calls.some((call) => call.includes("FinancialYear/GetCurrent")),
  "a missing client year asks Sage for FinancialYear/GetCurrent",
);
assert(ledger.year?.basis === "calendar", "a failed year lookup stays on the calendar year");
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
  server.includes("if (ledger.mappingIssue)") &&
    server.indexOf("if (ledger.mappingIssue)") <
      server.indexOf("const decision = sageSyncWriteDecision"),
  "a contradictory statement is refused before figures are written",
);
assert(
  server.includes('neutral ? "idle" : "error"'),
  "an empty company stays connected, not in error",
);
assert(
  server.includes("SAGE_EMPTY_COMPANY_MESSAGE"),
  "the connection stores the empty-company message",
);
assert(route.includes("result.neutral"), "an empty company is not an HTTP error");
assert(
  read("src/lib/sage.functions.ts").includes("encryptSagePassword(data.password)"),
  "connect stores the password Sage validated",
);
assert(
  read("src/lib/sage-password.ts").includes("if (!plain.trim())"),
  "trim is only the emptiness check",
);
assert(
  read("src/lib/sage-password.ts").includes('cipher.update(plain, "utf8")'),
  "the ciphertext is the password Sage validated",
);
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

// Real Sage SA sandbox layout (company 18721, empty). Section headers have no
// Total. The amount sits on the following "Total for …" line. Ageing Summary
// is one object with no customer or supplier. Numbers below are injected.
type SageFixtureNode = {
  Description?: string;
  Total?: number | number[];
  Children?: SageFixtureNode[];
  [key: string]: unknown;
};

function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function injectTotal(nodes: SageFixtureNode[], description: string, total: number | number[]) {
  const walk = (list: SageFixtureNode[]) => {
    for (const node of list) {
      if (node.Description === description) node.Total = total;
      if (node.Children?.length) walk(node.Children);
    }
  };
  walk(nodes);
}

const realProfitAndLoss: SageFixtureNode[] = [
  {
    ID: 1,
    Description: "Sales",
    Category: "",
    CategoryId: 0,
    AccountTypeId: 0,
    Children: [],
    ReportingLevelType: 1,
    AccountCategoryId: 1,
    AccountCategoryOrder: 1,
    ItemReportingGroupTypeId: 0,
  },
  {
    Total: [0],
    ID: 1,
    Description: "Total for Sales",
    CategoryId: 1,
    AccountTypeId: 0,
    ReportingLevelType: 10,
    AccountCategoryId: 0,
    AccountCategoryOrder: 0,
    ItemReportingGroupTypeId: 0,
  },
  {
    ID: 2,
    Description: "Cost of Sales",
    Category: "",
    CategoryId: 0,
    AccountTypeId: 0,
    Children: [],
    ReportingLevelType: 1,
    AccountCategoryId: 2,
    AccountCategoryOrder: 2,
    ItemReportingGroupTypeId: 0,
  },
  {
    Total: [0],
    ID: 2,
    Description: "Total for Cost of Sales",
    CategoryId: 2,
    AccountTypeId: 0,
    ReportingLevelType: 10,
    AccountCategoryId: 0,
    AccountCategoryOrder: 0,
    ItemReportingGroupTypeId: 0,
  },
  {
    Total: [0],
    ID: 5,
    Description: "Gross Profit",
    CategoryId: 5,
    AccountTypeId: 0,
    ReportingLevelType: 10,
    AccountCategoryId: 0,
    AccountCategoryOrder: 0,
    ItemReportingGroupTypeId: 0,
  },
  {
    ID: 3,
    Description: "Other Income",
    Category: "",
    CategoryId: 0,
    AccountTypeId: 0,
    Children: [],
    ReportingLevelType: 1,
    AccountCategoryId: 3,
    AccountCategoryOrder: 3,
    ItemReportingGroupTypeId: 0,
  },
  {
    Total: [0],
    ID: 3,
    Description: "Total for Other Income",
    CategoryId: 3,
    AccountTypeId: 0,
    ReportingLevelType: 10,
    AccountCategoryId: 0,
    AccountCategoryOrder: 0,
    ItemReportingGroupTypeId: 0,
  },
  {
    ID: 4,
    Description: "Expenses",
    Category: "",
    CategoryId: 0,
    AccountTypeId: 0,
    Children: [],
    ReportingLevelType: 1,
    AccountCategoryId: 4,
    AccountCategoryOrder: 4,
    ItemReportingGroupTypeId: 0,
  },
  {
    Total: [0],
    ID: 4,
    Description: "Total for Expenses",
    CategoryId: 4,
    AccountTypeId: 0,
    ReportingLevelType: 10,
    AccountCategoryId: 0,
    AccountCategoryOrder: 0,
    ItemReportingGroupTypeId: 0,
  },
  {
    Total: [0],
    ID: 6,
    Description: "Net Profit Or Loss Before Tax",
    Category: "",
    CategoryId: 6,
    AccountTypeId: 0,
    Children: [
      {
        Total: [0],
        ID: 664737,
        Description: "Income Tax",
        Category: "Income Tax",
        CategoryId: 10,
        AccountTypeId: 0,
        Children: [],
        ReportingLevelType: 3,
        AccountCategoryId: 10,
        AccountCategoryOrder: 5,
        AccountNumber: "",
        ItemReportingGroupTypeId: 0,
      },
    ],
    ReportingLevelType: 10,
    AccountCategoryId: 10,
    AccountCategoryOrder: 5,
    ItemReportingGroupTypeId: 0,
  },
  {
    Total: [0],
    ID: 7,
    Description: "Net Profit Or Loss After Tax",
    CategoryId: 7,
    AccountTypeId: 0,
    ReportingLevelType: 10,
    AccountCategoryId: 0,
    AccountCategoryOrder: 0,
    ItemReportingGroupTypeId: 0,
  },
];

const realBalanceSheet: SageFixtureNode[] = [
  {
    ID: 0,
    Description: "Assets",
    CategoryId: 0,
    AccountTypeId: 0,
    Children: [
      {
        ID: 5,
        Description: "Non-Current Assets",
        Category: "",
        CategoryId: 0,
        AccountTypeId: 0,
        Children: [],
        ReportingLevelType: 1,
        AccountCategoryId: 5,
        AccountCategoryOrder: 6,
        ItemReportingGroupTypeId: 0,
      },
      {
        Total: 0,
        ID: 0,
        Description: "Total Non-Current Assets",
        CategoryId: 0,
        AccountTypeId: 0,
        ReportingLevelType: 10,
        AccountCategoryId: 0,
        AccountCategoryOrder: 0,
        ItemReportingGroupTypeId: 0,
      },
      {
        ID: 6,
        Description: "Current Assets",
        Category: "",
        CategoryId: 0,
        AccountTypeId: 0,
        Children: [],
        ReportingLevelType: 1,
        AccountCategoryId: 6,
        AccountCategoryOrder: 7,
        ItemReportingGroupTypeId: 0,
      },
      {
        Total: 0,
        ID: 0,
        Description: "Total Current Assets",
        CategoryId: 0,
        AccountTypeId: 0,
        ReportingLevelType: 10,
        AccountCategoryId: 0,
        AccountCategoryOrder: 0,
        ItemReportingGroupTypeId: 0,
      },
    ],
    ReportingLevelType: 1,
    AccountCategoryId: 0,
    AccountCategoryOrder: 0,
    ItemReportingGroupTypeId: 0,
  },
  {
    Total: 0,
    ID: 0,
    Description: "Total Assets",
    CategoryId: 0,
    AccountTypeId: 0,
    ReportingLevelType: 10,
    AccountCategoryId: 0,
    AccountCategoryOrder: 0,
    ItemReportingGroupTypeId: 0,
  },
  {
    ID: 0,
    Description: "Equity and Liabilities",
    CategoryId: 0,
    AccountTypeId: 0,
    Children: [
      {
        ID: 9,
        Description: "Owners Equity",
        Category: "",
        CategoryId: 0,
        AccountTypeId: 0,
        Children: [
          {
            Total: 0,
            ID: -19,
            Description: "Profit and Loss (This Year)",
            Category: "Owners Equity",
            CategoryId: 9,
            AccountTypeId: 2,
            Children: [],
            ReportingLevelType: 4,
            AccountCategoryId: 9,
            AccountCategoryOrder: 10,
            AccountNumber: "",
            ItemReportingGroupTypeId: 0,
          },
        ],
        ReportingLevelType: 1,
        AccountCategoryId: 9,
        AccountCategoryOrder: 10,
        ItemReportingGroupTypeId: 0,
      },
      {
        Total: 0,
        ID: 0,
        Description: "Total Owners Equity",
        CategoryId: 0,
        AccountTypeId: 0,
        ReportingLevelType: 10,
        AccountCategoryId: 0,
        AccountCategoryOrder: 0,
        ItemReportingGroupTypeId: 0,
      },
      {
        ID: 7,
        Description: "Non-Current Liabilities",
        Category: "",
        CategoryId: 0,
        AccountTypeId: 0,
        Children: [],
        ReportingLevelType: 1,
        AccountCategoryId: 7,
        AccountCategoryOrder: 8,
        ItemReportingGroupTypeId: 0,
      },
      {
        Total: 0,
        ID: 0,
        Description: "Total Non-Current Liabilities",
        CategoryId: 0,
        AccountTypeId: 0,
        ReportingLevelType: 10,
        AccountCategoryId: 0,
        AccountCategoryOrder: 0,
        ItemReportingGroupTypeId: 0,
      },
      {
        ID: 8,
        Description: "Current Liabilities",
        Category: "",
        CategoryId: 0,
        AccountTypeId: 0,
        Children: [],
        ReportingLevelType: 1,
        AccountCategoryId: 8,
        AccountCategoryOrder: 9,
        ItemReportingGroupTypeId: 0,
      },
      {
        Total: 0,
        ID: 0,
        Description: "Total Current Liabilities",
        CategoryId: 0,
        AccountTypeId: 0,
        ReportingLevelType: 10,
        AccountCategoryId: 0,
        AccountCategoryOrder: 0,
        ItemReportingGroupTypeId: 0,
      },
    ],
    ReportingLevelType: 1,
    AccountCategoryId: 0,
    AccountCategoryOrder: 0,
    ItemReportingGroupTypeId: 0,
  },
  {
    Total: 0,
    ID: 0,
    Description: "Total Equity and Liabilities",
    CategoryId: 0,
    AccountTypeId: 0,
    ReportingLevelType: 10,
    AccountCategoryId: 0,
    AccountCategoryOrder: 0,
    ItemReportingGroupTypeId: 0,
  },
];

const sandboxProfitAndLoss = cloneFixture(realProfitAndLoss);
injectTotal(sandboxProfitAndLoss, "Total for Sales", [100000]);
injectTotal(sandboxProfitAndLoss, "Total for Cost of Sales", [40000]);
injectTotal(sandboxProfitAndLoss, "Gross Profit", [60000]);
injectTotal(sandboxProfitAndLoss, "Total for Other Income", [0]);
injectTotal(sandboxProfitAndLoss, "Total for Expenses", [25000]);
injectTotal(sandboxProfitAndLoss, "Net Profit Or Loss Before Tax", [35000]);
injectTotal(sandboxProfitAndLoss, "Income Tax", [9450]);
injectTotal(sandboxProfitAndLoss, "Net Profit Or Loss After Tax", [25550]);

const sandboxBalanceSheet = cloneFixture(realBalanceSheet);
injectTotal(sandboxBalanceSheet, "Total Non-Current Assets", 180000);
injectTotal(sandboxBalanceSheet, "Total Current Assets", 120000);
injectTotal(sandboxBalanceSheet, "Total Assets", 300000);
injectTotal(sandboxBalanceSheet, "Total Owners Equity", 120000);
injectTotal(sandboxBalanceSheet, "Total Non-Current Liabilities", 100000);
injectTotal(sandboxBalanceSheet, "Total Current Liabilities", 80000);
injectTotal(sandboxBalanceSheet, "Total Equity and Liabilities", 300000);

const sandboxMonth = parseSageProfitAndLoss(sandboxProfitAndLoss, 1);
assert(sandboxMonth.revenue === 100000, "real layout: sales total, not the empty header");
assert(sandboxMonth.cogs === 40000, "real layout: total for cost of sales");
assert(sandboxMonth.grossProfit === 60000, "real layout: gross profit");
assert(sandboxMonth.operatingExpenses === 25000, "real layout: total for expenses");
assert(sandboxMonth.ebt === 35000, "real layout: net profit or loss before tax");
assert(sandboxMonth.netIncome === 25550, "real layout: net profit or loss after tax");
assert(sandboxMonth.netIncome !== sandboxMonth.grossProfit, "net income is not gross profit");

const sandboxBs = parseSageBalanceSheet(sandboxBalanceSheet);
assert(sandboxBs.totalAssets === 300000, "real layout: total assets");
assert(sandboxBs.currentAssets === 120000, "real layout: total current assets");
assert(sandboxBs.currentLiabilities === 80000, "real layout: total current liabilities");
assert(sandboxBs.equity === 120000, "real layout: total owners equity, not equity and liabilities");
assert(sandboxBs.equity !== 300000, "total equity and liabilities is not owners equity");

const sandboxMapped = mapSageToFinancialInputs(
  sandboxMonth,
  sandboxBs,
  { from: "2026-10-01", to: "2026-10-11", label: "1 Oct 2026 – 11 Oct 2026" },
  null,
  0,
);
assert(sandboxMapped.revenue === 100000, "mapped sales");
assert(sandboxMapped.cogs === 40000, "mapped cost of sales");
assert(sandboxMapped.fixedCosts === 25000, "mapped expenses");
assert(sandboxMapped.ebt === 35000, "mapped profit before tax");
assert(sandboxMapped.netIncome === 25550, "mapped profit after tax");
assert(sandboxMapped.equity === 120000, "mapped owners equity");
assert(sandboxMapped.totalAssets === 300000, "mapped assets");

const childSales = parseSageProfitAndLoss(
  [
    {
      Description: "Sales",
      Category: "Sales",
      ReportingLevelType: 1,
      Children: [
        { Description: "Products", ReportingLevelType: 3, Total: [70000], Children: [] },
        { Description: "Services", ReportingLevelType: 3, Total: [30000], Children: [] },
      ],
    },
  ],
  1,
);
assert(childSales.revenue === 100000, "a header with no total sums its child accounts");

assert(
  parseSageFinancialYearStartMonth({
    ID: 1,
    YearStart: "2026-03-01T00:00:00",
    YearEnd: "2027-02-28T00:00:00",
    IsCurrentYear: true,
  }) === 3,
  "FinancialYear/GetCurrent YearStart month is March",
);
assert(
  parseSageFinancialYearStartMonth({ YearStart: "2026-03-01" }) === 3,
  "a date-only YearStart still yields the month",
);
assert(parseSageFinancialYearStartMonth({}) === null, "a year with no start stays unknown");

const customerSummary = {
  Date: "0001-01-01T00:00:00Z",
  Total: 5000,
  Current: 2000,
  Days30: 3000,
  Days60: 0,
  Days90: 0,
  Days120Plus: 0,
};
const sandboxCustomers = parseSageCustomerAgeing(customerSummary, "2026-10-11");
assert(sandboxCustomers.status === "applied", "a summary total is applied");
assert(sandboxCustomers.contactCount === 0, "summary ageing has no customer names");
assert(sandboxCustomers.totalOutstanding === 5000, "customer ageing total");
assert(sandboxCustomers.totalOverdue === 0, "summary month buckets are not overdue");
assert(
  !agedArProofLine(sandboxCustomers).includes("nothing outstanding"),
  "a non-zero customer summary is not empty",
);
assert(agedArProofLine(sandboxCustomers).includes("5,000.00"), "proof line shows the total");

const zeroCustomers = parseSageCustomerAgeing(
  {
    Date: "0001-01-01T00:00:00Z",
    Total: 0,
    Current: 0,
    Days30: 0,
    Days60: 0,
    Days90: 0,
    Days120Plus: 0,
  },
  "2026-10-11",
);
assert(zeroCustomers.status === "empty", "a zero summary stays empty");
assert(
  agedArProofLine(zeroCustomers).includes("nothing outstanding"),
  "zero summary has nothing outstanding",
);

const supplierSummary = parseSageSupplierAgeing(
  {
    Date: "0001-01-01T00:00:00Z",
    Total: 800,
    Current: 800,
    Days30: 0,
    Days60: 0,
    Days90: 0,
    Days120Plus: 0,
  },
  "2026-10-11",
);
assert(supplierSummary.supplierCount === 0, "summary ageing has no supplier names");
assert(supplierSummary.totalOutstanding === 800, "supplier ageing total");
assert(supplierSummary.status === "applied", "a supplier summary total is applied");
assert(agedApProofLine(supplierSummary).includes("800.00"), "supplier proof line shows the total");

const namedBesideSummary = parseSageCustomerAgeing(
  [customerSummary, { Total: 800, Current: 800, Customer: { ID: 9, Name: "Northwind" } }],
  "2026-10-11",
);
assert(namedBesideSummary.contacts.length === 1, "named customers still parse");
assert(
  namedBesideSummary.contacts[0]?.outstanding === 800,
  "the summary row is not a second customer",
);
assert(
  namedBesideSummary.totalOutstanding === 800,
  "named rows are not added to the summary total",
);

const fyCalls: string[] = [];
const marchLedger = await fetchSageLedgerStatement(
  {
    username: "owner@example.com",
    password: "secret",
    apiKey: "test-key-not-a-secret",
    companyId: "18721",
  },
  now,
  null,
  async (input, init) => {
    const href = String(input);
    const path = new URL(href).pathname;
    fyCalls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/FinancialYear/GetCurrent")) {
      return new Response(
        JSON.stringify({
          ID: 1,
          YearStart: "2026-03-01T00:00:00",
          YearEnd: "2027-02-28T00:00:00",
          IsCurrentYear: true,
        }),
      );
    }
    if (path.endsWith("/ProfitAndLoss/Get"))
      return new Response(JSON.stringify(sandboxProfitAndLoss));
    if (path.endsWith("/BalanceSheet/Get"))
      return new Response(JSON.stringify(sandboxBalanceSheet));
    if (path.endsWith("/BankAccount/Get")) {
      return new Response(JSON.stringify({ TotalResults: 0, ReturnedResults: 0, Results: [] }));
    }
    if (path.endsWith("/CustomerAgeing/GetSummary"))
      return new Response(JSON.stringify(customerSummary));
    if (path.endsWith("/SupplierAgeing/GetSummary")) {
      return new Response(
        JSON.stringify({
          Date: "0001-01-01T00:00:00Z",
          Total: 0,
          Current: 0,
          Days30: 0,
          Days60: 0,
          Days90: 0,
          Days120Plus: 0,
        }),
      );
    }
    return new Response("missing", { status: 404 });
  },
);
assert(
  fyCalls.some((call) => call.startsWith("GET") && call.includes("FinancialYear/GetCurrent")),
  "sync reads the current financial year",
);
assert(marchLedger.year?.from === "2026-03-01", "sandbox company year is March to February");
assert(marchLedger.year?.basis === "financial", "YearStart wins over the calendar year");
assert(marchLedger.pnl.revenue === 100000, "fetched real layout revenue");
assert(marchLedger.pnl.netIncome === 25550, "fetched real layout net profit after tax");
assert(marchLedger.bs.equity === 120000, "fetched real layout owners equity");
assert(marchLedger.agedAr.totalOutstanding === 5000, "fetched customer ageing total");
assert(marchLedger.agedAp.status === "empty", "a zero supplier summary stays empty");
assert(
  marchLedger.cashSource === "balance_sheet",
  "no bank accounts leaves the balance-sheet cash",
);

const clientYearCalls: string[] = [];
await fetchSageLedgerStatement(
  {
    username: "owner@example.com",
    password: "secret",
    apiKey: "test-key-not-a-secret",
    companyId: "18721",
  },
  now,
  3,
  async (input) => {
    const path = new URL(String(input)).pathname;
    clientYearCalls.push(path);
    if (path.endsWith("/ProfitAndLoss/Get"))
      return new Response(JSON.stringify(sandboxProfitAndLoss));
    if (path.endsWith("/BalanceSheet/Get"))
      return new Response(JSON.stringify(sandboxBalanceSheet));
    if (path.endsWith("/BankAccount/Get")) {
      return new Response(JSON.stringify({ TotalResults: 0, ReturnedResults: 0, Results: [] }));
    }
    if (
      path.endsWith("/CustomerAgeing/GetSummary") ||
      path.endsWith("/SupplierAgeing/GetSummary")
    ) {
      return new Response(
        JSON.stringify({ Total: 0, Current: 0, Days30: 0, Days60: 0, Days90: 0, Days120Plus: 0 }),
      );
    }
    return new Response("missing", { status: 404 });
  },
);
assert(
  !clientYearCalls.some((path) => path.includes("FinancialYear")),
  "a client financial year is not asked of Sage again",
);

const ageingBody = sageAgeingBody("2026-10-11");
assert(ageingBody.AgeingPeriod === 0, "ageing sends AgeingPeriod");
assert(
  ageingBody.BasedOnDueDate === false,
  "BasedOnDueDate true is not a documented day-ageing switch",
);

function loadSageFixture(name: string): unknown {
  return JSON.parse(read(`scripts/fixtures/sage-seeded/${name}`));
}

function near(actual: number, expected: number, msg: string) {
  assert(Math.abs(actual - expected) < 0.02, `${msg} (${actual} vs ${expected})`);
}

const seededMtd = parseSageProfitAndLoss(loadSageFixture("mtd-profit-and-loss.json"), 1);
near(seededMtd.revenue, 30000, "October revenue");
near(seededMtd.cogs, 2400, "October cost of sales");
near(seededMtd.operatingExpenses, 31833.33, "October expenses");
near(seededMtd.ebt, -4233.33, "October profit before tax");
near(seededMtd.netIncome, -14700.33, "October profit after tax");
assert(seededMtd.periodMonths === 1, "an 11-day month is still periodMonths 1");
assert(
  sageMappingIssue(seededMtd, parseSageBalanceSheet(loadSageFixture("balance-sheet.json"))) ===
    null,
);

const seededYtd = parseSageProfitAndLoss(loadSageFixture("ytd-profit-and-loss.json"), 8);
near(seededYtd.revenue, 275000, "year-to-date revenue");
near(seededYtd.cogs, 2400, "year-to-date cost of sales");
near(seededYtd.operatingExpenses, 233833.33, "year-to-date expenses");
near(seededYtd.ebt, 38766.67, "year-to-date profit before tax");
near(seededYtd.netIncome, 28299.67, "year-to-date profit after tax");
assert(seededYtd.periodMonths === 8, "March to October is 8 months");

const seededBs = parseSageBalanceSheet(loadSageFixture("balance-sheet.json"));
near(seededBs.totalAssets, 493216.67, "total assets");
near(seededBs.totalLiabilities, 50517, "liabilities");
near(seededBs.equity, 442699.67, "owners equity");
near(seededBs.receivables, 71300, "debtors");
near(seededBs.payables, 20700, "creditors");
near(seededBs.cash, 227750, "type-6 bank line is cash");
near(seededBs.inventory, 12000, "inventory");
assert(seededBs.equity !== seededBs.totalAssets, "equity is not total equity and liabilities");
assert(
  sageMappingIssue(seededYtd, seededBs) === null,
  "the seeded company passes the mapping guard",
);

const zeroPnl = parseSageProfitAndLoss(
  [
    { Description: "Total for Sales", ReportingLevelType: 10, Total: [0], Children: [] },
    { Description: "Gross Profit", ReportingLevelType: 10, Total: [0], Children: [] },
  ],
  1,
);
const zeroBs = parseSageBalanceSheet([
  { Description: "Total Assets", ReportingLevelType: 10, Total: 0, Children: [] },
  { Description: "Total Owners Equity", ReportingLevelType: 10, Total: 0, Children: [] },
]);
assert(sageMappingIssue(zeroPnl, zeroBs) === null, "an all-zero company is not a mapping error");
assert(
  sageMappingIssue(
    { ...seededYtd, revenue: 0, otherIncome: 0, cogs: 0, grossProfit: 0 },
    seededBs,
  )?.includes("sales total"),
  "a non-zero sales line with zero revenue is refused",
);
assert(
  sageMappingIssue({ ...seededYtd, grossProfit: 1 }, seededBs)?.includes("gross profit"),
  "gross profit must equal revenue minus cost of sales",
);
assert(
  sageMappingIssue(seededYtd, { ...seededBs, equity: seededBs.totalAssets })?.includes("equity"),
  "equity equal to assets while liabilities are outstanding is refused",
);

const summaryCustomers = loadSageFixture("customer-ageing-summary.json");
const detailCustomers = loadSageFixture("customer-ageing-detail.json");
assert(
  JSON.stringify(summaryCustomers) === JSON.stringify(detailCustomers),
  "Summary true and Summary false are the same totals object",
);
const seededParties = parseSagePartyBalances(loadSageFixture("customers.json"));
assert(
  seededParties.map((party) => party.name).join("|") ===
    "Fynbos Design Studio|Table Mountain Dental Group",
  "zero-balance customers are omitted",
);
near(
  seededParties.find((party) => party.name === "Fynbos Design Studio")?.balance ?? 0,
  36800,
  "Fynbos balance",
);
near(
  seededParties.find((party) => party.name === "Table Mountain Dental Group")?.balance ?? 0,
  34500,
  "Table Mountain Dental balance",
);
const seededAged = parseSageCustomerAgeing(
  summaryCustomers,
  "2026-10-11",
  "2026-10-11T00:00:00.000Z",
  seededParties,
);
assert(seededAged.contactCount === 2, "debtors are named from Customer/Get");
near(seededAged.totalOutstanding, 71300, "debtor total comes from the ageing totals row");
assert(seededAged.totalOverdue === 0, "month buckets are not overdue");
assert(
  seededAged.contacts.every((contact) => contact.buckets.length === 0),
  "party rows are not given invented month buckets",
);
assert(seededAged.note?.includes("Current month"), "the totals row keeps the month buckets");
assert(seededAged.note?.includes("2 months"), "Days60 is two months");

const seededSuppliers = parseSagePartyBalances(loadSageFixture("suppliers.json"));
assert(
  seededSuppliers.length === 1 && seededSuppliers[0]?.name === "Bright IT Solutions (Pty) Ltd",
  "zero-balance suppliers are omitted",
);
near(seededSuppliers[0]?.balance ?? 0, 20700, "Bright IT balance");
const seededAp = parseSageSupplierAgeing(
  loadSageFixture("supplier-ageing-summary.json"),
  "2026-10-11",
  "2026-10-11T00:00:00.000Z",
  seededSuppliers,
);
assert(
  JSON.stringify(loadSageFixture("supplier-ageing-summary.json")) ===
    JSON.stringify(loadSageFixture("supplier-ageing-detail.json")),
  "supplier Summary true and false are the same totals object",
);
near(seededAp.totalOutstanding, 20700, "creditor total");
assert(seededAp.totalOverdue === 0, "a 13-day-old bill in Days30 is not overdue");
assert(seededAp.note?.includes("1 month"), "Days30 is labelled as one month");

const seededWhen = new Date("2026-10-11T08:00:00.000Z");
const seededCalls: string[] = [];
const seededLedger = await fetchSageLedgerStatement(
  {
    username: "owner@example.com",
    password: "secret",
    apiKey: "test-key-not-a-secret",
    companyId: "18721",
  },
  seededWhen,
  null,
  async (input, init) => {
    const href = String(input);
    const path = new URL(href).pathname;
    seededCalls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/FinancialYear/GetCurrent")) {
      return new Response(JSON.stringify(loadSageFixture("financial-year.json")));
    }
    if (path.endsWith("/ProfitAndLoss/Get")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { FromDate?: string };
      const file =
        body.FromDate === "2026-03-01" ? "ytd-profit-and-loss.json" : "mtd-profit-and-loss.json";
      return new Response(JSON.stringify(loadSageFixture(file)));
    }
    if (path.endsWith("/BalanceSheet/Get")) {
      return new Response(JSON.stringify(loadSageFixture("balance-sheet.json")));
    }
    if (path.endsWith("/BankAccount/Get")) {
      return new Response(JSON.stringify(loadSageFixture("bank-accounts.json")));
    }
    if (path.endsWith("/Customer/Get")) {
      return new Response(JSON.stringify(loadSageFixture("customers.json")));
    }
    if (path.endsWith("/Supplier/Get")) {
      return new Response(JSON.stringify(loadSageFixture("suppliers.json")));
    }
    if (path.endsWith("/CustomerAgeing/GetSummary")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        BasedOnDueDate?: boolean;
        AgeingPeriod?: number;
      };
      assert(
        body.BasedOnDueDate === false,
        "the ageing request does not pretend to age by due date",
      );
      assert(body.AgeingPeriod === 0, "the ageing request sends AgeingPeriod 0");
      return new Response(JSON.stringify(loadSageFixture("customer-ageing-summary.json")));
    }
    if (path.endsWith("/SupplierAgeing/GetSummary")) {
      return new Response(JSON.stringify(loadSageFixture("supplier-ageing-summary.json")));
    }
    return new Response("missing", { status: 404 });
  },
);
assert(seededLedger.mappingIssue === null, "seeded figures are consistent");
assert(seededLedger.from === "2026-10-01", "October opens on the 1st");
assert(seededLedger.to === "2026-10-11", "October ends on the seeded day");
assert(seededLedger.pnl.periodMonths === 1, "partial October is one waterfall month");
near(seededLedger.pnl.revenue, 30000, "fetched October revenue");
near(seededLedger.pnl.netIncome, -14700.33, "fetched October profit after tax");
assert(seededLedger.year?.from === "2026-03-01", "year to date starts at YearStart");
assert(seededLedger.year?.basis === "financial", "YearStart is a financial year");
assert(seededLedger.year?.pnl.periodMonths === 8, "March to October is eight months");
near(seededLedger.year?.pnl.revenue ?? 0, 275000, "fetched year-to-date revenue");
near(seededLedger.year?.pnl.netIncome ?? 0, 28299.67, "fetched year-to-date profit after tax");
near(seededLedger.bs.equity, 442699.67, "fetched owners equity");
near(seededLedger.bs.totalLiabilities, 50517, "fetched liabilities");
assert(
  seededLedger.cashSource === "bank_accounts",
  "bank accounts supply cash when the call works",
);
near(seededLedger.cash, 227750, "FNB Business Cheque");
assert(
  seededLedger.agedAr.contacts.map((contact) => contact.name).join("|") ===
    "Fynbos Design Studio|Table Mountain Dental Group",
  "fetched debtor names",
);
near(seededLedger.agedAr.totalOutstanding, 71300, "fetched debtors");
assert(seededLedger.agedAr.totalOverdue === 0, "fetched debtors are not marked overdue");
assert(
  seededLedger.agedAp.suppliers[0]?.name === "Bright IT Solutions (Pty) Ltd",
  "fetched creditor",
);
near(seededLedger.agedAp.totalOutstanding, 20700, "fetched creditors");
const seededMapped = mapSageToFinancialInputs(
  seededLedger.pnl,
  seededLedger.bs,
  { from: seededLedger.from, to: seededLedger.to, label: seededLedger.periodLabel },
  seededLedger.year,
  seededLedger.cash,
);
assert(seededMapped.periodMonths === "1", "stored month count matches Xero and QuickBooks");
assert(seededMapped.ytdPeriodMonths === "8", "stored year count is March to October");
assert(
  seededMapped.periodStart === "2026-10-01" && seededMapped.periodEnd === "2026-10-11",
  "the dates keep the 11-day span",
);
assert(
  read("src/lib/sage-sync.ts").includes("parseSageProfitAndLoss(monthJson, 1)"),
  "the month parser is called with one month",
);
assert(
  read("docs/SAGE.md").includes("periodMonths") && read("docs/SAGE.md").includes("QuickBooks"),
  "the partial-month rule is documented next to Xero and QuickBooks",
);

const bankErrors: string[] = [];
const logged = console.error;
console.error = (...args: unknown[]) => {
  bankErrors.push(args.map((arg) => String(arg)).join(" "));
};
const bankFallback = await fetchSageLedgerStatement(
  {
    username: "owner@example.com",
    password: "secret",
    apiKey: "test-key-not-a-secret",
    companyId: "18721",
  },
  seededWhen,
  3,
  async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/ProfitAndLoss/Get")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { FromDate?: string };
      const file =
        body.FromDate === "2026-03-01" ? "ytd-profit-and-loss.json" : "mtd-profit-and-loss.json";
      return new Response(JSON.stringify(loadSageFixture(file)));
    }
    if (path.endsWith("/BalanceSheet/Get")) {
      return new Response(JSON.stringify(loadSageFixture("balance-sheet.json")));
    }
    if (path.endsWith("/BankAccount/Get")) throw new Error("bank down");
    if (path.endsWith("/Customer/Get")) {
      return new Response(JSON.stringify(loadSageFixture("customers.json")));
    }
    if (path.endsWith("/Supplier/Get")) {
      return new Response(JSON.stringify(loadSageFixture("suppliers.json")));
    }
    if (path.endsWith("/CustomerAgeing/GetSummary")) {
      return new Response(JSON.stringify(loadSageFixture("customer-ageing-summary.json")));
    }
    if (path.endsWith("/SupplierAgeing/GetSummary")) {
      return new Response(JSON.stringify(loadSageFixture("supplier-ageing-summary.json")));
    }
    return new Response("missing", { status: 404 });
  },
);
console.error = logged;
assert(
  bankFallback.cashSource === "balance_sheet",
  "a bank failure falls back to the balance sheet",
);
near(bankFallback.cash, 227750, "fallback cash is the type-6 line");
assert(
  bankErrors.some((line) => line.includes("BankAccount/Get failed")),
  "a bank failure is logged",
);
assert(
  !bankErrors.some((line) => line.includes("secret")),
  "the bank log does not include the password",
);

console.log("sage-sync-test: ok");
