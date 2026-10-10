/**
 * Sage Business Cloud Accounting (South Africa) statement pull.
 * Basic auth + apikey query. No OAuth.
 *
 * Host: sageApiBase() — SAGE_SA_BASE_URL, default https://accounting.sageone.co.za/api/2.0.0
 */
import { SAGE_SA_LIVE_API_BASE, sageApiBase } from "@/lib/sage-config";
import {
  finalizeCollections,
  skippedCollections,
  type CollectionsContact,
  type CollectionsSnapshot,
} from "@/lib/collections";
import {
  finalizePayables,
  skippedPayables,
  type PayablesSnapshot,
  type PayablesSupplier,
} from "@/lib/payables";
import { PERIOD_MONTHS_KEY } from "@/lib/ratios";
import {
  calendarMonthBounds,
  financialYearToDate,
  formatStatementPeriodLabel,
  type YearBasis,
} from "@/lib/statement-period";
import { periodMonthsBetween } from "@/lib/xero";

/** Live host. The host actually called is sageApiBase() (SAGE_SA_BASE_URL). */
export const SAGE_SA_API_BASE = SAGE_SA_LIVE_API_BASE;
export const SAGE_STATEMENT_SOURCE = "sage" as const;

const CATEGORY = 1;
const GROUP = 2;
const ACCOUNT = 3;
const SYSTEM = 4;
const BANK = 6;
const TOTAL = 10;

export type SageAuth = {
  username: string;
  password: string;
  apiKey: string;
  companyId: string;
};

export type SagePnL = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  ebit: number;
  ebt: number;
  netIncome: number;
  ebitda: number;
  depreciation: number;
  periodMonths: number;
};

export type SageBalanceSheet = {
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  receivables: number;
  inventory: number;
  payables: number;
  cash: number;
  currentAssets: number;
  currentLiabilities: number;
};

export type SageBankAccount = {
  id: string;
  name: string;
  balance: number;
  active: boolean;
};

export type SageMappedYear = {
  pnl: Pick<SagePnL, "revenue" | "netIncome" | "periodMonths">;
  from: string;
  to: string;
  label: string;
  basis: YearBasis;
};

export type SageLedgerStatement = {
  pnl: SagePnL;
  bs: SageBalanceSheet;
  from: string;
  to: string;
  periodLabel: string;
  year: SageMappedYear | null;
  cash: number;
  cashSource: "bank_accounts" | "balance_sheet";
  bankAccounts: SageBankAccount[];
  agedAr: CollectionsSnapshot;
  agedAp: PayablesSnapshot;
};

type SageNode = {
  Description?: string;
  Category?: string;
  ReportingLevelType?: number;
  Total?: number | Array<number | null> | null;
  Children?: SageNode[];
  ID?: number;
};

type FlatNode = { node: SageNode; parent: SageNode | null };

export { sageApiBase, sageCredentialsConfigured } from "@/lib/sage-config";

export function redactSageSecrets(text: string, secrets: string[] = []): string {
  let out = text.replace(/apikey=[^&\s]+/gi, "apikey=[redacted]");
  for (const secret of secrets) {
    if (secret.trim().length >= 4) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export function sageBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export function sageRequestUrl(
  path: string,
  auth: Pick<SageAuth, "apiKey" | "companyId">,
  query: Record<string, string> = {},
): string {
  const url = new URL(`${sageApiBase()}/${path.replace(/^\//, "")}`);
  url.searchParams.set("apikey", auth.apiKey);
  url.searchParams.set("CompanyId", auth.companyId);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

export function sageProfitAndLossBody(from: string, to: string): Record<string, unknown> {
  return {
    FromDate: from,
    ToDate: to,
    UsePurchases: false,
    DisplayReportingGroupDetail: false,
    Comparative: false,
    ShowVariance: false,
  };
}

export function sageBalanceSheetBody(date: string): Record<string, unknown> {
  return { RunAtDate: date, DisplayReportingGroupDetail: false };
}

export function sageAgeingBody(date: string): Record<string, unknown> {
  return {
    ToDate: date,
    Summary: true,
    IncludeActive: true,
    IncludeInactive: false,
    ExcludeZeroBalance: true,
    UseForeignCurrency: false,
  };
}

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function sageLedgerRanges(
  now = new Date(),
  fyStartMonth: number | null = null,
): {
  month: { from: string; to: string; label: string };
  year: { from: string; to: string; label: string; basis: YearBasis; periodMonths: number } | null;
} {
  const month = calendarMonthBounds(now, 0);
  const monthLabel = formatStatementPeriodLabel(month.from, month.to);
  let yearFrom: string;
  let basis: YearBasis;
  if (fyStartMonth != null && fyStartMonth >= 1 && fyStartMonth <= 12) {
    const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1;
    yearFrom = financialYearToDate(now, endMonth, 31).from;
    basis = "financial";
  } else {
    yearFrom = `${now.getUTCFullYear()}-01-01`;
    basis = "calendar";
  }
  const yearTo = isoDate(now);
  if (yearFrom === month.from && yearTo === month.to) {
    return { month: { ...month, label: monthLabel }, year: null };
  }
  return {
    month: { ...month, label: monthLabel },
    year: {
      from: yearFrom,
      to: yearTo,
      label: formatStatementPeriodLabel(yearFrom, yearTo),
      basis,
      periodMonths: periodMonthsBetween(yearFrom, yearTo),
    },
  };
}

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isNode(value: unknown): value is SageNode {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sageReportNodes(json: unknown): SageNode[] {
  if (Array.isArray(json)) return json.filter(isNode);
  if (!isNode(json)) return [];
  if (Array.isArray(json.Children) && json.Total == null && !json.Description) {
    return json.Children.filter(isNode);
  }
  const results = (json as { Results?: unknown }).Results;
  if (Array.isArray(results)) return results.filter(isNode);
  return [json];
}

function flatten(nodes: SageNode[], parent: SageNode | null = null): FlatNode[] {
  const out: FlatNode[] = [];
  for (const node of nodes) {
    out.push({ node, parent });
    if (Array.isArray(node.Children) && node.Children.length) {
      out.push(...flatten(node.Children.filter(isNode), node));
    }
  }
  return out;
}

/** First column is the requested period. A trailing comparative zero is not the total. */
export function sageLevelAmount(node: SageNode): number | null {
  const total = node.Total;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  if (!Array.isArray(total) || total.length === 0) return null;
  const first = total[0];
  if (typeof first === "number" && Number.isFinite(first)) return first;
  for (const value of total) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function nodeLabel(node: SageNode): string {
  return norm(node.Description || node.Category || "");
}

function typeRank(node: SageNode): number {
  const order = [GROUP, TOTAL, CATEGORY, BANK, ACCOUNT, SYSTEM];
  const index = order.indexOf(node.ReportingLevelType ?? -1);
  return index === -1 ? 99 : index;
}

function pickAmount(flat: FlatNode[], phrases: string[], exclude: string[] = []): number | null {
  for (const phrase of phrases) {
    const hits = flat.filter(({ node }) => {
      const text = nodeLabel(node);
      if (!text || sageLevelAmount(node) == null) return false;
      if (exclude.some((skipped) => text.includes(skipped))) return false;
      if (text === phrase) return true;
      return phrase.length >= 8 && text.includes(phrase);
    });
    if (!hits.length) continue;
    hits.sort((a, b) => {
      const byType = typeRank(a.node) - typeRank(b.node);
      if (byType !== 0) return byType;
      return nodeLabel(a.node).length - nodeLabel(b.node).length;
    });
    return sageLevelAmount(hits[0].node);
  }
  return null;
}

function categorySum(flat: FlatNode[], names: string[]): number | null {
  const wanted = new Set(names);
  const cats = flat.filter(({ node }) => {
    if (node.ReportingLevelType !== CATEGORY) return false;
    const cat = norm(node.Category);
    const desc = norm(node.Description);
    if (!wanted.has(cat) && !wanted.has(desc)) return false;
    return sageLevelAmount(node) != null;
  });
  if (!cats.length) return null;
  return cats.reduce((sum, { node }) => sum + (sageLevelAmount(node) ?? 0), 0);
}

function leafSum(flat: FlatNode[], pattern: RegExp, exclude?: RegExp): number {
  const leaves = flat.filter(({ node }) => {
    const type = node.ReportingLevelType;
    const isLeaf =
      type === ACCOUNT ||
      type === SYSTEM ||
      (!node.Children?.length && type !== CATEGORY && type !== TOTAL);
    if (!isLeaf) return false;
    const text = nodeLabel(node);
    if (!pattern.test(text)) return false;
    if (exclude && exclude.test(text)) return false;
    return sageLevelAmount(node) != null;
  });
  return leaves.reduce((sum, { node }) => sum + Math.abs(sageLevelAmount(node) ?? 0), 0);
}

function absOr(value: number | null, fallback = 0): number {
  return value == null || !Number.isFinite(value) ? fallback : Math.abs(value);
}

export function parseSageProfitAndLoss(json: unknown, periodMonths = 1): SagePnL {
  const flat = flatten(sageReportNodes(json));
  const sales = categorySum(flat, ["sales", "turnover", "trading income", "revenue"]);
  const otherIncome = categorySum(flat, ["other income"]);
  const revenueFromCategories =
    sales == null && otherIncome == null ? null : (sales ?? 0) + (otherIncome ?? 0);
  const revenueLine = pickAmount(flat, [
    "total sales",
    "total income",
    "total revenue",
    "total trading income",
  ]);
  const revenue = revenueFromCategories ?? revenueLine ?? 0;

  const cogsRaw = categorySum(flat, ["cost of sales", "cost of goods sold", "cost of goods"]);
  const cogs = absOr(cogsRaw ?? pickAmount(flat, ["total cost of sales", "total cost of goods"]));

  const grossLine = pickAmount(flat, ["gross profit"]);
  const grossProfit = grossLine ?? revenue - cogs;

  const expenseCategories = categorySum(flat, ["expenses", "operating expenses", "other expenses"]);
  const operatingExpenses = absOr(
    expenseCategories ?? pickAmount(flat, ["total expenses", "total operating expenses"]),
  );

  const depreciation = leafSum(flat, /depreciat|amortis|amortiz/);
  const interest = leafSum(flat, /interest (paid|expense|on)/);
  const tax = leafSum(flat, /income tax|taxation|tax expense/, /receivable|refund|control/);

  const netAfter = pickAmount(flat, ["net profit after tax", "profit after tax", "net income"]);
  const netBefore = pickAmount(flat, ["net profit before tax", "profit before tax"]);
  const netGeneric = pickAmount(
    flat,
    ["net profit", "net profit loss", "profit loss"],
    ["before tax", "after tax"],
  );
  const netIncome = netAfter ?? netGeneric ?? grossProfit + (otherIncome ?? 0) - operatingExpenses;
  const ebt = netBefore ?? (tax ? netIncome + tax : netIncome);
  const ebit = interest ? ebt + interest : grossProfit + (otherIncome ?? 0) - operatingExpenses;

  return {
    revenue,
    cogs,
    grossProfit,
    operatingExpenses,
    ebit,
    ebt,
    netIncome,
    ebitda: ebit + depreciation,
    depreciation,
    periodMonths,
  };
}

export function parseSageBalanceSheet(json: unknown): SageBalanceSheet {
  const flat = flatten(sageReportNodes(json));
  const currentAssets = absOr(
    categorySum(flat, ["current assets"]) ?? pickAmount(flat, ["total current assets"]),
  );
  const nonCurrent = absOr(
    categorySum(flat, ["non current assets", "fixed assets"]) ??
      pickAmount(flat, ["total non current assets", "total fixed assets"]),
  );
  const totalAssets = absOr(pickAmount(flat, ["total assets"])) || currentAssets + nonCurrent;
  const currentLiabilities = absOr(
    categorySum(flat, ["current liabilities"]) ?? pickAmount(flat, ["total current liabilities"]),
  );
  const nonCurrentLiabilities = absOr(
    categorySum(flat, ["non current liabilities", "long term liabilities"]) ??
      pickAmount(flat, ["total non current liabilities", "total long term liabilities"]),
  );
  const totalLiabilities =
    absOr(pickAmount(flat, ["total liabilities"])) || currentLiabilities + nonCurrentLiabilities;
  const equityLine =
    categorySum(flat, [
      "owners equity",
      "owner equity",
      "equity",
      "shareholders equity",
      "members equity",
    ]) ?? pickAmount(flat, ["total equity", "total owners equity", "capital and reserves"]);
  const equity = equityLine ?? totalAssets - totalLiabilities;
  const receivables = absOr(
    pickAmount(flat, [
      "trade and other receivables",
      "trade receivables",
      "accounts receivable",
      "debtors",
    ]),
  );
  const inventory = absOr(pickAmount(flat, ["inventory", "trading stock", "stock on hand"]));
  const payables = absOr(
    pickAmount(flat, [
      "trade and other payables",
      "trade payables",
      "accounts payable",
      "creditors",
    ]),
  );
  const cash = pickAmount(flat, ["cash and cash equivalents", "cash at bank", "bank", "cash"]) ?? 0;
  return {
    totalAssets,
    totalLiabilities,
    equity,
    receivables,
    inventory,
    payables,
    cash,
    currentAssets,
    currentLiabilities,
  };
}

export function parseSageBankAccounts(json: unknown): {
  accounts: SageBankAccount[];
  complete: boolean;
} {
  const root =
    json && typeof json === "object"
      ? (json as { Results?: unknown; ReturnedResults?: unknown })
      : null;
  const rows = Array.isArray(json) ? json : Array.isArray(root?.Results) ? root.Results : [];
  const accounts: SageBankAccount[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as {
      ID?: unknown;
      Name?: unknown;
      Description?: unknown;
      Balance?: unknown;
      Active?: unknown;
    };
    const balance = typeof record.Balance === "number" ? record.Balance : Number(record.Balance);
    if (!Number.isFinite(balance)) continue;
    const active = record.Active !== false;
    if (!active) continue;
    const name = String(record.Name || record.Description || "Bank").trim() || "Bank";
    accounts.push({
      id: record.ID == null ? name : String(record.ID),
      name,
      balance,
      active,
    });
  }
  const returned = typeof root?.ReturnedResults === "number" ? root.ReturnedResults : rows.length;
  return { accounts, complete: returned < 100 || accounts.length < 100 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ageingRows(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json))
    return json.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  if (!json || typeof json !== "object") return [];
  const root = json as { Results?: unknown };
  if (Array.isArray(root.Results)) {
    return root.Results.filter((row) => row && typeof row === "object") as Record<
      string,
      unknown
    >[];
  }
  return [json as Record<string, unknown>];
}

function ageingAmount(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function party(
  row: Record<string, unknown>,
  key: "Customer" | "Supplier",
): { id: string; name: string } | null {
  const nested = row[key];
  if (nested && typeof nested === "object") {
    const record = nested as { Name?: unknown; Description?: unknown; ID?: unknown };
    const name = String(record.Name || record.Description || "").trim();
    if (name) return { id: record.ID == null ? name : String(record.ID), name };
  }
  const flat = String(row[`${key}Name`] || row.Name || "").trim();
  if (!flat) return null;
  return { id: flat, name: flat };
}

function ageingBuckets(
  row: Record<string, unknown>,
): { label: string; amount: number; current: boolean }[] {
  return [
    { label: "Current", amount: round2(ageingAmount(row, "Current")), current: true },
    { label: "30 days", amount: round2(ageingAmount(row, "Days30")), current: false },
    { label: "60 days", amount: round2(ageingAmount(row, "Days60")), current: false },
    { label: "90 days", amount: round2(ageingAmount(row, "Days90")), current: false },
    {
      label: "120+ days",
      amount: round2(ageingAmount(row, "Days120Plus") || ageingAmount(row, "Days120")),
      current: false,
    },
  ];
}

function outstandingOf(row: Record<string, unknown>, buckets: { amount: number }[]): number {
  const total = ageingAmount(row, "Total");
  if (total !== 0) return round2(total);
  return round2(buckets.reduce((sum, bucket) => sum + bucket.amount, 0));
}

export function parseSageCustomerAgeing(
  json: unknown,
  asOf: string,
  syncedAt = new Date().toISOString(),
): CollectionsSnapshot {
  const contacts: CollectionsContact[] = [];
  for (const row of ageingRows(json)) {
    const who = party(row, "Customer");
    if (!who) continue;
    const buckets = ageingBuckets(row);
    const outstanding = outstandingOf(row, buckets);
    const current = buckets
      .filter((bucket) => bucket.current)
      .reduce((sum, bucket) => sum + bucket.amount, 0);
    const overdue = round2(outstanding - current);
    contacts.push({
      contactId: who.id,
      name: who.name,
      outstanding,
      overdue: overdue > 0 ? overdue : 0,
      ageBucket:
        buckets.filter((bucket) => !bucket.current && Math.abs(bucket.amount) >= 0.005).at(-1)
          ?.label ?? "Current",
      buckets: buckets.map((bucket) => ({ label: bucket.label, amount: bucket.amount })),
      invoices: [],
    });
  }
  return finalizeCollections({ source: "sage", asOf, syncedAt, contacts });
}

export function parseSageSupplierAgeing(
  json: unknown,
  asOf: string,
  syncedAt = new Date().toISOString(),
): PayablesSnapshot {
  const suppliers: PayablesSupplier[] = [];
  for (const row of ageingRows(json)) {
    const who = party(row, "Supplier");
    if (!who) continue;
    const buckets = ageingBuckets(row);
    const outstanding = outstandingOf(row, buckets);
    const current = buckets
      .filter((bucket) => bucket.current)
      .reduce((sum, bucket) => sum + bucket.amount, 0);
    const overdue = round2(outstanding - current);
    suppliers.push({
      supplierId: who.id,
      name: who.name,
      outstanding,
      overdue: overdue > 0 ? overdue : 0,
      ageBucket:
        buckets.filter((bucket) => !bucket.current && Math.abs(bucket.amount) >= 0.005).at(-1)
          ?.label ?? "Current",
      buckets: buckets.map((bucket) => ({ label: bucket.label, amount: bucket.amount })),
      bills: [],
    });
  }
  return finalizePayables({ source: "sage", asOf, syncedAt, suppliers });
}

export function sumSageBankBalances(accounts: SageBankAccount[]): number | null {
  if (!accounts.length) return null;
  return round2(accounts.reduce((sum, account) => sum + account.balance, 0));
}

/**
 * Maps a Sage P&L and balance sheet onto the financials blob QuickBooks and
 * Xero already write. Month-to-date is the waterfall (`periodMonths = 1`).
 * The year range sits beside it and is omitted when it is the same month.
 */
export function mapSageToFinancialInputs(
  pnl: SagePnL,
  bs: SageBalanceSheet,
  period: { from: string; to: string; label: string } | undefined,
  year: SageMappedYear | null,
  cash: number | null,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  const dated = Boolean(period?.from && period?.to);
  const set = (key: string, value: number) => {
    if (!Number.isFinite(value)) return;
    if (!dated && value === 0) return;
    out[key] = value;
  };
  set("revenue", pnl.revenue);
  set("cogs", pnl.cogs);
  set("ebit", pnl.ebit);
  set("ebt", pnl.ebt);
  set("netIncome", pnl.netIncome);
  set("ebitda", pnl.ebitda);
  set("fixedCosts", pnl.operatingExpenses);
  set("totalAssets", bs.totalAssets);
  set("equity", bs.equity);
  set("receivables", bs.receivables);
  set("inventory", bs.inventory);
  set("payables", bs.payables);
  set("currentAssets", bs.currentAssets);
  set("currentLiabilities", bs.currentLiabilities);
  set("cash", cash != null && Number.isFinite(cash) ? cash : bs.cash);
  if (Number.isFinite(pnl.periodMonths) && pnl.periodMonths >= 1 && pnl.periodMonths <= 12) {
    out[PERIOD_MONTHS_KEY] = String(pnl.periodMonths);
  }
  if (period?.from && period.to) {
    out.statementSource = SAGE_STATEMENT_SOURCE;
    out.periodStart = period.from;
    out.periodEnd = period.to;
    out.periodLabel = period.label || formatStatementPeriodLabel(period.from, period.to);
  }
  if (year?.from && year.to && !(period?.from === year.from && period?.to === year.to)) {
    if (Number.isFinite(year.pnl.revenue)) out.ytdRevenue = year.pnl.revenue;
    if (Number.isFinite(year.pnl.netIncome)) out.ytdNetIncome = year.pnl.netIncome;
    out.ytdPeriodStart = year.from;
    out.ytdPeriodEnd = year.to;
    out.ytdPeriodLabel = year.label || formatStatementPeriodLabel(year.from, year.to);
    if (Number.isFinite(year.pnl.periodMonths) && year.pnl.periodMonths >= 1) {
      out.ytdPeriodMonths = String(year.pnl.periodMonths);
    }
    out.ytdBasis = year.basis;
  }
  return out;
}

export class SageApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SageApiError";
    this.status = status;
  }
}

async function sageCall(
  auth: SageAuth,
  path: string,
  init: { method: "GET" | "POST"; body?: Record<string, unknown>; query?: Record<string, string> },
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const url = sageRequestUrl(path, auth, init.query);
  const headers: Record<string, string> = {
    Authorization: sageBasicAuthHeader(auth.username, auth.password),
    Accept: "application/json",
  };
  if (init.body) headers["Content-Type"] = "application/json";
  const response = await fetchImpl(url, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    const secrets = [auth.password, auth.apiKey, auth.username];
    const detail = redactSageSecrets(text.replace(/\s+/g, " ").slice(0, 180), secrets);
    if (response.status === 401 || response.status === 403) {
      throw new SageApiError(
        "Sage rejected the login or API key. Overview figures were left unchanged.",
        response.status,
      );
    }
    throw new SageApiError(
      `Sage Accounting API ${response.status}${detail ? `: ${detail}` : ""}. Overview figures were left unchanged.`,
      response.status,
    );
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SageApiError(
      "Sage Accounting API returned a response that was not JSON.",
      response.status,
    );
  }
}

async function fetchBankAccounts(
  auth: SageAuth,
  fetchImpl: typeof fetch,
): Promise<SageBankAccount[]> {
  const accounts: SageBankAccount[] = [];
  let skip = 0;
  for (let page = 0; page < 10; page++) {
    const json = await sageCall(
      auth,
      "BankAccount/Get",
      { method: "GET", query: { $top: "100", $skip: String(skip), $orderby: "ID" } },
      fetchImpl,
    );
    const parsed = parseSageBankAccounts(json);
    accounts.push(...parsed.accounts);
    if (parsed.complete || parsed.accounts.length === 0) break;
    skip += 100;
  }
  return accounts;
}

export async function fetchSageLedgerStatement(
  auth: SageAuth,
  now = new Date(),
  fyStartMonth: number | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<SageLedgerStatement> {
  const ranges = sageLedgerRanges(now, fyStartMonth);
  const monthJson = await sageCall(
    auth,
    "ProfitAndLoss/Get",
    { method: "POST", body: sageProfitAndLossBody(ranges.month.from, ranges.month.to) },
    fetchImpl,
  );
  const yearJson = ranges.year
    ? await sageCall(
        auth,
        "ProfitAndLoss/Get",
        { method: "POST", body: sageProfitAndLossBody(ranges.year.from, ranges.year.to) },
        fetchImpl,
      )
    : null;
  const bsJson = await sageCall(
    auth,
    "BalanceSheet/Get",
    { method: "POST", body: sageBalanceSheetBody(ranges.month.to) },
    fetchImpl,
  );
  const pnl = parseSageProfitAndLoss(monthJson, 1);
  const yearPnl =
    yearJson && ranges.year ? parseSageProfitAndLoss(yearJson, ranges.year.periodMonths) : null;
  const bs = parseSageBalanceSheet(bsJson);

  let bankAccounts: SageBankAccount[] = [];
  try {
    bankAccounts = await fetchBankAccounts(auth, fetchImpl);
  } catch {
    bankAccounts = [];
  }
  const bankCash = sumSageBankBalances(bankAccounts);
  const cash = bankCash ?? bs.cash;
  const syncedAt = now.toISOString();

  let agedAr: CollectionsSnapshot;
  try {
    const json = await sageCall(
      auth,
      "CustomerAgeing/GetSummary",
      { method: "POST", body: sageAgeingBody(ranges.month.to) },
      fetchImpl,
    );
    agedAr = parseSageCustomerAgeing(json, ranges.month.to, syncedAt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Aged receivables failed";
    agedAr = skippedCollections({
      source: "sage",
      asOf: ranges.month.to,
      syncedAt,
      skipReason: `Aged receivables were not applied. ${msg.replace(/\s+/g, " ").slice(0, 180)}`,
    });
  }

  let agedAp: PayablesSnapshot;
  try {
    const json = await sageCall(
      auth,
      "SupplierAgeing/GetSummary",
      { method: "POST", body: sageAgeingBody(ranges.month.to) },
      fetchImpl,
    );
    agedAp = parseSageSupplierAgeing(json, ranges.month.to, syncedAt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Aged payables failed";
    agedAp = skippedPayables({
      source: "sage",
      asOf: ranges.month.to,
      syncedAt,
      skipReason: `Aged payables were not applied. ${msg.replace(/\s+/g, " ").slice(0, 180)}`,
    });
  }

  return {
    pnl,
    bs,
    from: ranges.month.from,
    to: ranges.month.to,
    periodLabel: ranges.month.label,
    year:
      ranges.year && yearPnl
        ? {
            pnl: {
              revenue: yearPnl.revenue,
              netIncome: yearPnl.netIncome,
              periodMonths: yearPnl.periodMonths,
            },
            from: ranges.year.from,
            to: ranges.year.to,
            label: ranges.year.label,
            basis: ranges.year.basis,
          }
        : null,
    cash,
    cashSource: bankCash != null ? "bank_accounts" : "balance_sheet",
    bankAccounts,
    agedAr,
    agedAp,
  };
}
