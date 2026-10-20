/**
 * Sage Business Cloud Accounting (South Africa) statement pull.
 * Basic auth + apikey query. No OAuth.
 *
 * Host: sageApiBase() — SAGE_SA_BASE_URL, default https://accounting.sageone.co.za/api/2.0.0
 */
import { SAGE_SA_LIVE_API_BASE, sageApiBase } from "@/lib/sage-config";
import {
  finalizeCollections,
  olderThanCurrentMonth,
  skippedCollections,
  type CalendarMonthAgeing,
  type CollectionsContact,
  type CollectionsSnapshot,
} from "@/lib/collections";
import {
  finalizePayables,
  skippedPayables,
  type PayablesSnapshot,
  type PayablesSupplier,
} from "@/lib/payables";
import type { DateMarket } from "@/lib/market/format";
import { marketForClient } from "@/lib/market/scope";
import { PERIOD_MONTHS_KEY } from "@/lib/ratios";
import {
  calendarDateInTimeZone,
  calendarMonthBounds,
  financialYearToDate,
  formatStatementPeriodLabel,
  type YearBasis,
} from "@/lib/statement-period";
import { periodMonthsBetween } from "@/lib/xero";

/** Live host. The host actually called is sageApiBase() (SAGE_SA_BASE_URL). */
export const SAGE_SA_API_BASE = SAGE_SA_LIVE_API_BASE;
export const SAGE_STATEMENT_SOURCE = "sage" as const;
/** Sage SA companies keep their books on South African time, not UTC. */
export const SAGE_SA_TIME_ZONE = "Africa/Johannesburg";

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
  /**
   * Other income sits below gross profit on a Sage profit and loss, so the
   * identity gross profit = revenue − cost of sales uses revenue excluding it.
   */
  otherIncome: number;
  /** Amount on a "Total for Sales" line. Null when that line is absent. */
  salesTotal: number | null;
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
  /**
   * Set when mapped figures contradict the report (gross profit, a non-zero
   * sales total read as zero revenue, or equity equal to assets while
   * liabilities are outstanding). Sync must not write.
   */
  mappingIssue: string | null;
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

/**
 * CustomerAgeing/GetSummary and SupplierAgeing/GetSummary.
 *
 * The help page lists AgeingPeriod (integer) and BasedOnDueDate (bool) and
 * does not say what either does. Sage's own seeded request sends
 * AgeingPeriod 0 and BasedOnDueDate false. That response is still calendar
 * months by invoice date: a supplier bill dated 28 Sep sits in Days30 on
 * 11 Oct, and the company has AgeMonthly. Sending BasedOnDueDate true is
 * not a documented way to get day buckets, so the buckets are labelled as
 * months and a non-current month is not treated as overdue.
 */
export function sageAgeingBody(date: string): Record<string, unknown> {
  return {
    ToDate: date,
    Summary: true,
    AgeingPeriod: 0,
    BasedOnDueDate: false,
    IncludeActive: true,
    IncludeInactive: false,
    ExcludeZeroBalance: true,
    UseForeignCurrency: false,
  };
}

function sageIsoDate(now: Date): string {
  const { year, month, day } = calendarDateInTimeZone(now, SAGE_SA_TIME_ZONE);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function sageLedgerRanges(
  now = new Date(),
  fyStartMonth: number | null = null,
  market: DateMarket = marketForClient(null),
): {
  month: { from: string; to: string; label: string };
  year: { from: string; to: string; label: string; basis: YearBasis; periodMonths: number } | null;
} {
  const month = calendarMonthBounds(now, 0, SAGE_SA_TIME_ZONE);
  const monthLabel = formatStatementPeriodLabel(month.from, month.to, market);
  let yearFrom: string;
  let basis: YearBasis;
  if (fyStartMonth != null && fyStartMonth >= 1 && fyStartMonth <= 12) {
    const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1;
    yearFrom = financialYearToDate(now, endMonth, 31, SAGE_SA_TIME_ZONE).from;
    basis = "financial";
  } else {
    yearFrom = `${calendarDateInTimeZone(now, SAGE_SA_TIME_ZONE).year}-01-01`;
    basis = "calendar";
  }
  const yearTo = sageIsoDate(now);
  if (yearFrom === month.from && yearTo === month.to) {
    return { month: { ...month, label: monthLabel }, year: null };
  }
  return {
    month: { ...month, label: monthLabel },
    year: {
      from: yearFrom,
      to: yearTo,
      label: formatStatementPeriodLabel(yearFrom, yearTo, market),
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

function categorySum(flat: FlatNode[], names: string[], exclude: string[] = []): number | null {
  const wanted = new Set(names);
  const cats = flat.filter(({ node }) => {
    if (node.ReportingLevelType !== CATEGORY) return false;
    const cat = norm(node.Category);
    const desc = norm(node.Description);
    if (!wanted.has(cat) && !wanted.has(desc)) return false;
    if (exclude.some((skipped) => `${cat} ${desc}`.includes(skipped))) return false;
    return sageLevelAmount(node) != null;
  });
  if (!cats.length) return null;
  return cats.reduce((sum, { node }) => sum + (sageLevelAmount(node) ?? 0), 0);
}

/** Header has no total of its own. Sum the account lines under it, skipping "Total …" children. */
function headerChildSum(flat: FlatNode[], names: string[]): number | null {
  const wanted = new Set(names);
  const headers = flat.filter(({ node }) => {
    if (node.ReportingLevelType !== CATEGORY) return false;
    const cat = norm(node.Category);
    const desc = norm(node.Description);
    return wanted.has(cat) || wanted.has(desc);
  });
  if (!headers.length) return null;
  let any = false;
  let sum = 0;
  for (const { node } of headers) {
    for (const child of node.Children ?? []) {
      if (!isNode(child)) continue;
      const label = nodeLabel(child);
      if (label.startsWith("total ")) continue;
      const amount = sageLevelAmount(child);
      if (amount == null) continue;
      any = true;
      sum += amount;
    }
  }
  return any ? sum : null;
}

function sectionAmount(flat: FlatNode[], names: string[], totalPhrases: string[]): number | null {
  return categorySum(flat, names) ?? pickAmount(flat, totalPhrases) ?? headerChildSum(flat, names);
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
  const sales = sectionAmount(
    flat,
    ["sales", "turnover", "trading income", "revenue"],
    ["total for sales", "total sales"],
  );
  const otherIncome = sectionAmount(
    flat,
    ["other income"],
    ["total for other income", "total other income"],
  );
  const revenueFromSections =
    sales == null && otherIncome == null ? null : (sales ?? 0) + (otherIncome ?? 0);
  const revenueLine = pickAmount(flat, ["total income", "total revenue", "total trading income"]);
  const revenue = revenueFromSections ?? revenueLine ?? 0;

  const cogs = absOr(
    sectionAmount(
      flat,
      ["cost of sales", "cost of goods sold", "cost of goods"],
      [
        "total for cost of sales",
        "total cost of sales",
        "total for cost of goods",
        "total cost of goods",
      ],
    ),
  );

  const grossLine = pickAmount(flat, ["gross profit"]);
  const grossProfit = grossLine ?? revenue - cogs;

  const operatingExpenses = absOr(
    sectionAmount(
      flat,
      ["expenses", "operating expenses", "other expenses"],
      [
        "total for expenses",
        "total expenses",
        "total for operating expenses",
        "total operating expenses",
      ],
    ),
  );

  const depreciation = leafSum(flat, /depreciat|amortis|amortiz/);
  const interest = leafSum(flat, /interest (paid|expense|on)/);
  const tax = leafSum(flat, /income tax|taxation|tax expense/, /receivable|refund|control/);

  const netAfter = pickAmount(flat, [
    "net profit or loss after tax",
    "net profit after tax",
    "profit after tax",
    "net income",
  ]);
  const netBefore = pickAmount(flat, [
    "net profit or loss before tax",
    "net profit before tax",
    "profit before tax",
  ]);
  const netGeneric = pickAmount(
    flat,
    ["net profit", "net profit loss", "profit loss"],
    ["before tax", "after tax"],
  );
  const netIncome = netAfter ?? netGeneric ?? grossProfit + (otherIncome ?? 0) - operatingExpenses;
  const ebt = netBefore ?? (tax ? netIncome + tax : netIncome);
  const ebit = interest ? ebt + interest : grossProfit + (otherIncome ?? 0) - operatingExpenses;
  const salesTotal = pickAmount(flat, ["total for sales"]);

  return {
    revenue: round2(revenue),
    otherIncome: round2(otherIncome ?? 0),
    salesTotal: salesTotal == null ? null : round2(salesTotal),
    cogs: round2(cogs),
    grossProfit: round2(grossProfit),
    operatingExpenses: round2(operatingExpenses),
    ebit: round2(ebit),
    ebt: round2(ebt),
    netIncome: round2(netIncome),
    ebitda: round2(ebit + depreciation),
    depreciation: round2(depreciation),
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
    categorySum(
      flat,
      ["owners equity", "owner equity", "equity", "shareholders equity", "members equity"],
      ["liabilities"],
    ) ??
    pickAmount(
      flat,
      ["total owners equity", "total owner equity", "total equity", "capital and reserves"],
      ["liabilities"],
    );
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
  // Bank accounts are ReportingLevelType 6 and are named after the account
  // ("FNB Business Cheque"), so a "bank" / "cash" phrase misses them.
  // Overdrafts stay negative. A grouped "Bank" total is the fallback when
  // the report has no type-6 lines.
  const bankLines = flat.filter(
    ({ node }) => node.ReportingLevelType === BANK && sageLevelAmount(node) != null,
  );
  const bankLineCash = bankLines.length
    ? round2(bankLines.reduce((sum, { node }) => sum + (sageLevelAmount(node) ?? 0), 0))
    : null;
  const cash =
    bankLineCash ??
    pickAmount(flat, ["cash and cash equivalents", "cash at bank", "bank", "cash"]) ??
    0;
  return {
    totalAssets: round2(totalAssets),
    totalLiabilities: round2(totalLiabilities),
    equity: round2(equity),
    receivables: round2(receivables),
    inventory: round2(inventory),
    payables: round2(payables),
    cash: round2(cash),
    currentAssets: round2(currentAssets),
    currentLiabilities: round2(currentLiabilities),
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

/** Customer/Get and Supplier/Get. Zero balances are omitted. */
export function parseSagePartyBalances(json: unknown): SagePartyBalance[] {
  const root =
    json && typeof json === "object" && !Array.isArray(json)
      ? (json as { Results?: unknown })
      : null;
  const rows = Array.isArray(json) ? json : Array.isArray(root?.Results) ? root.Results : [];
  const parties: SagePartyBalance[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as { ID?: unknown; Name?: unknown; Balance?: unknown };
    const balance = typeof record.Balance === "number" ? record.Balance : Number(record.Balance);
    if (!Number.isFinite(balance) || Math.abs(balance) < 0.005) continue;
    const name = String(record.Name ?? "").trim();
    if (!name) continue;
    parties.push({
      id: record.ID == null ? name : String(record.ID),
      name,
      balance: round2(balance),
    });
  }
  return parties;
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

export type SagePartyBalance = {
  id: string;
  name: string;
  balance: number;
};

/**
 * GetSummary columns are calendar months by invoice date, not days past due.
 * Current is this month. Days30 is one month back. A bill dated 13 days ago
 * can land in Days30, so these amounts are not overdue.
 */
function ageingBuckets(row: Record<string, unknown>): { label: string; amount: number }[] {
  return [
    { label: "Current month", amount: round2(ageingAmount(row, "Current")) },
    { label: "1 month", amount: round2(ageingAmount(row, "Days30")) },
    { label: "2 months", amount: round2(ageingAmount(row, "Days60")) },
    { label: "3 months", amount: round2(ageingAmount(row, "Days90")) },
    {
      label: "4+ months",
      amount: round2(ageingAmount(row, "Days120Plus") || ageingAmount(row, "Days120")),
    },
  ];
}

function calendarMonthAgeing(row: Record<string, unknown>): CalendarMonthAgeing {
  return {
    basis: "calendar_month",
    current: round2(ageingAmount(row, "Current")),
    month_1: round2(ageingAmount(row, "Days30")),
    month_2: round2(ageingAmount(row, "Days60")),
    month_3: round2(ageingAmount(row, "Days90")),
    older: round2(ageingAmount(row, "Days120Plus") || ageingAmount(row, "Days120")),
  };
}

function sumCalendarMonthAgeing(parts: CalendarMonthAgeing[]): CalendarMonthAgeing | null {
  if (!parts.length) return null;
  const total = {
    basis: "calendar_month" as const,
    current: 0,
    month_1: 0,
    month_2: 0,
    month_3: 0,
    older: 0,
  };
  for (const part of parts) {
    total.current = round2(total.current + part.current);
    total.month_1 = round2(total.month_1 + part.month_1);
    total.month_2 = round2(total.month_2 + part.month_2);
    total.month_3 = round2(total.month_3 + part.month_3);
    total.older = round2(total.older + part.older);
  }
  return total;
}

function monthAgeBucket(buckets: { label: string; amount: number }[]): string {
  for (let i = buckets.length - 1; i >= 0; i--) {
    const bucket = buckets[i];
    if (bucket.label === "Current month") continue;
    if (Math.abs(bucket.amount) >= 0.005) return bucket.label;
  }
  return "Current month";
}

function monthBucketNote(row: Record<string, unknown> | null): string {
  const parts = (row ? ageingBuckets(row) : [])
    .filter((bucket) => Math.abs(bucket.amount) >= 0.005)
    .map(
      (bucket) =>
        `${bucket.label} ${bucket.amount.toLocaleString("en-GB", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
    );
  const listed = parts.length ? ` (${parts.join("; ")})` : "";
  return `Sage ages by calendar month${listed}, not days past due.`;
}

function outstandingOf(row: Record<string, unknown>, buckets: { amount: number }[]): number {
  const total = ageingAmount(row, "Total");
  if (total !== 0) return round2(total);
  return round2(buckets.reduce((sum, bucket) => sum + bucket.amount, 0));
}

/**
 * Summary true and Summary false both return one totals object and no party.
 * A non-zero total on that row is the company total. A row that names a
 * customer or supplier stays on the per-party path so the totals row is not
 * added twice.
 */
function unnamedAgeingTotal(
  rows: Record<string, unknown>[],
  key: "Customer" | "Supplier",
): { row: Record<string, unknown>; outstanding: number } | null {
  if (rows.some((row) => party(row, key))) return null;
  for (const row of rows) {
    const outstanding = outstandingOf(row, ageingBuckets(row));
    if (outstanding === 0) continue;
    return { row, outstanding };
  }
  return null;
}

function contactsFromBalances(parties: SagePartyBalance[]): CollectionsContact[] {
  return parties
    .filter((partyBalance) => partyBalance.name.trim() && Math.abs(partyBalance.balance) >= 0.005)
    .map((partyBalance) => ({
      contactId: partyBalance.id,
      name: partyBalance.name,
      outstanding: partyBalance.balance,
      overdue: 0,
      ageBucket: "Balance",
      buckets: [],
      invoices: [],
    }));
}

function suppliersFromBalances(parties: SagePartyBalance[]): PayablesSupplier[] {
  return parties
    .filter((partyBalance) => partyBalance.name.trim() && Math.abs(partyBalance.balance) >= 0.005)
    .map((partyBalance) => ({
      supplierId: partyBalance.id,
      name: partyBalance.name,
      outstanding: partyBalance.balance,
      overdue: 0,
      ageBucket: "Balance",
      buckets: [],
      bills: [],
    }));
}

export function parseSageCustomerAgeing(
  json: unknown,
  asOf: string,
  syncedAt = new Date().toISOString(),
  parties: SagePartyBalance[] = [],
): CollectionsSnapshot {
  const rows = ageingRows(json);
  const contacts: CollectionsContact[] = [];
  for (const row of rows) {
    const who = party(row, "Customer");
    if (!who) continue;
    const buckets = ageingBuckets(row);
    const monthAgeing = calendarMonthAgeing(row);
    contacts.push({
      contactId: who.id,
      name: who.name,
      outstanding: outstandingOf(row, buckets),
      overdue: 0,
      ageBucket: monthAgeBucket(buckets),
      buckets,
      monthAgeing,
      invoices: [],
    });
  }
  const named = contacts.length > 0;
  const listed = named ? contacts : contactsFromBalances(parties);
  const summary = unnamedAgeingTotal(rows, "Customer");
  const snap = finalizeCollections({
    source: "sage",
    asOf,
    syncedAt,
    contacts: listed,
    note: named
      ? monthBucketNote(null)
      : listed.length
        ? `Customer balances are from Customer/Get. ${monthBucketNote(summary?.row ?? null)}`
        : summary
          ? monthBucketNote(summary.row)
          : null,
  });
  const monthAgeing = summary
    ? calendarMonthAgeing(summary.row)
    : sumCalendarMonthAgeing(
        listed.flatMap((contact) => (contact.monthAgeing ? [contact.monthAgeing] : [])),
      );
  if (!summary && !monthAgeing) return snap;
  return {
    ...snap,
    status: summary || listed.length ? "applied" : snap.status,
    ...(summary ? { totalOutstanding: summary.outstanding } : {}),
    totalOverdue: 0,
    ...(monthAgeing
      ? { monthAgeing, olderThanCurrentMonth: olderThanCurrentMonth(monthAgeing) }
      : {}),
  };
}

export function parseSageSupplierAgeing(
  json: unknown,
  asOf: string,
  syncedAt = new Date().toISOString(),
  parties: SagePartyBalance[] = [],
): PayablesSnapshot {
  const rows = ageingRows(json);
  const suppliers: PayablesSupplier[] = [];
  for (const row of rows) {
    const who = party(row, "Supplier");
    if (!who) continue;
    const buckets = ageingBuckets(row);
    const monthAgeing = calendarMonthAgeing(row);
    suppliers.push({
      supplierId: who.id,
      name: who.name,
      outstanding: outstandingOf(row, buckets),
      overdue: 0,
      ageBucket: monthAgeBucket(buckets),
      buckets,
      monthAgeing,
      bills: [],
    });
  }
  const named = suppliers.length > 0;
  const listed = named ? suppliers : suppliersFromBalances(parties);
  const summary = unnamedAgeingTotal(rows, "Supplier");
  const snap = finalizePayables({
    source: "sage",
    asOf,
    syncedAt,
    suppliers: listed,
    note: named
      ? monthBucketNote(null)
      : listed.length
        ? `Supplier balances are from Supplier/Get. ${monthBucketNote(summary?.row ?? null)}`
        : summary
          ? monthBucketNote(summary.row)
          : null,
  });
  const monthAgeing = summary
    ? calendarMonthAgeing(summary.row)
    : sumCalendarMonthAgeing(
        listed.flatMap((supplier) => (supplier.monthAgeing ? [supplier.monthAgeing] : [])),
      );
  if (!summary && !monthAgeing) return snap;
  return {
    ...snap,
    status: summary || listed.length ? "applied" : snap.status,
    ...(summary ? { totalOutstanding: summary.outstanding } : {}),
    totalOverdue: 0,
    ...(monthAgeing
      ? { monthAgeing, olderThanCurrentMonth: olderThanCurrentMonth(monthAgeing) }
      : {}),
  };
}

/** Month buckets stored on clients.financials beside the statement figures. */
export function sageMonthAgeingFinancialFields(
  agedAr: CollectionsSnapshot,
  agedAp: PayablesSnapshot,
): Record<string, number | CalendarMonthAgeing> {
  const out: Record<string, number | CalendarMonthAgeing> = {};
  if (agedAr.monthAgeing) {
    out.sageArMonthBuckets = agedAr.monthAgeing;
    out.sageArOlderThanCurrentMonth =
      agedAr.olderThanCurrentMonth ?? olderThanCurrentMonth(agedAr.monthAgeing);
  }
  if (agedAp.monthAgeing) {
    out.sageApMonthBuckets = agedAp.monthAgeing;
    out.sageApOlderThanCurrentMonth =
      agedAp.olderThanCurrentMonth ?? olderThanCurrentMonth(agedAp.monthAgeing);
  }
  return out;
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
  market: DateMarket = marketForClient(null),
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  const dated = Boolean(period?.from && period?.to);
  const set = (key: string, value: number) => {
    if (!Number.isFinite(value)) return;
    if (!dated && value === 0) return;
    out[key] = round2(value);
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
    out.periodLabel = period.label || formatStatementPeriodLabel(period.from, period.to, market);
  }
  if (year?.from && year.to && !(period?.from === year.from && period?.to === year.to)) {
    if (Number.isFinite(year.pnl.revenue)) out.ytdRevenue = round2(year.pnl.revenue);
    if (Number.isFinite(year.pnl.netIncome)) out.ytdNetIncome = round2(year.pnl.netIncome);
    out.ytdPeriodStart = year.from;
    out.ytdPeriodEnd = year.to;
    out.ytdPeriodLabel = year.label || formatStatementPeriodLabel(year.from, year.to, market);
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

async function fetchPartyBalances(
  auth: SageAuth,
  path: "Customer/Get" | "Supplier/Get",
  fetchImpl: typeof fetch,
): Promise<SagePartyBalance[]> {
  const parties: SagePartyBalance[] = [];
  let skip = 0;
  for (let page = 0; page < 10; page++) {
    const json = await sageCall(
      auth,
      path,
      { method: "GET", query: { $top: "100", $skip: String(skip), $orderby: "ID" } },
      fetchImpl,
    );
    parties.push(...parseSagePartyBalances(json));
    const root =
      json && typeof json === "object" && !Array.isArray(json)
        ? (json as { ReturnedResults?: unknown; Results?: unknown })
        : null;
    const returned =
      typeof root?.ReturnedResults === "number"
        ? root.ReturnedResults
        : Array.isArray(root?.Results)
          ? root.Results.length
          : 0;
    if (returned < 100) break;
    skip += 100;
  }
  return parties;
}

const MAPPING_TOLERANCE = 1;

/**
 * Refuse a write when the mapped statement contradicts itself.
 * Other income is excluded from the gross-profit identity because Sage
 * prints it below gross profit. Tolerance is one currency unit so cent
 * rounding passes and a mismatched section does not.
 */
export function sageMappingIssue(pnl: SagePnL, bs: SageBalanceSheet): string | null {
  const tradingRevenue = pnl.revenue - pnl.otherIncome;
  if (Math.abs(pnl.grossProfit - (tradingRevenue - pnl.cogs)) > MAPPING_TOLERANCE) {
    return "Sage gross profit does not equal revenue minus cost of sales. Overview figures were left unchanged.";
  }
  if (
    pnl.salesTotal != null &&
    Math.abs(pnl.salesTotal) > MAPPING_TOLERANCE &&
    Math.abs(pnl.revenue) <= MAPPING_TOLERANCE
  ) {
    return "Sage reported a sales total but revenue mapped to zero. Overview figures were left unchanged.";
  }
  if (
    bs.totalLiabilities > MAPPING_TOLERANCE &&
    Math.abs(bs.equity - bs.totalAssets) <= MAPPING_TOLERANCE
  ) {
    return "Sage equity matches total assets while liabilities are outstanding. Overview figures were left unchanged.";
  }
  return null;
}

export function sageLedgerMappingIssue(
  month: SagePnL,
  year: SagePnL | null,
  bs: SageBalanceSheet,
): string | null {
  return sageMappingIssue(month, bs) ?? (year ? sageMappingIssue(year, bs) : null);
}

function monthFromYearStart(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12)
    return value;
  if (typeof value !== "string") return null;
  const iso = /^(\d{4})-(\d{2})/.exec(value.trim());
  if (!iso) return null;
  const month = Number(iso[2]);
  return month >= 1 && month <= 12 ? month : null;
}

/** FinancialYear/GetCurrent.YearStart is a date. The month is the year-start month. */
export function parseSageFinancialYearStartMonth(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const record = json as { YearStart?: unknown; Results?: unknown };
  const direct = monthFromYearStart(record.YearStart);
  if (direct) return direct;
  if (!Array.isArray(record.Results)) return null;
  const current =
    record.Results.find(
      (row) =>
        row &&
        typeof row === "object" &&
        (row as { IsCurrentYear?: unknown }).IsCurrentYear === true,
    ) ?? record.Results[0];
  if (!current || typeof current !== "object") return null;
  return monthFromYearStart((current as { YearStart?: unknown }).YearStart);
}

async function resolveFyStartMonth(
  auth: SageAuth,
  fyStartMonth: number | null,
  fetchImpl: typeof fetch,
): Promise<number | null> {
  if (fyStartMonth != null && fyStartMonth >= 1 && fyStartMonth <= 12) return fyStartMonth;
  try {
    const json = await sageCall(auth, "FinancialYear/GetCurrent", { method: "GET" }, fetchImpl);
    return parseSageFinancialYearStartMonth(json);
  } catch (err) {
    if (err instanceof SageApiError && (err.status === 401 || err.status === 403)) throw err;
    return null;
  }
}

export async function fetchSageLedgerStatement(
  auth: SageAuth,
  now = new Date(),
  fyStartMonth: number | null = null,
  fetchImpl: typeof fetch = fetch,
  market: DateMarket = marketForClient(null),
): Promise<SageLedgerStatement> {
  const resolvedFy = await resolveFyStartMonth(auth, fyStartMonth, fetchImpl);
  const ranges = sageLedgerRanges(now, resolvedFy, market);
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
  // An open month stays periodMonths 1, matching Xero (fetchXeroLedgerStatement)
  // and QuickBooks (fetchQboLedgerStatement). periodStart/periodEnd carry the
  // partial span (1 Oct–11 Oct is still one month). Year-to-date uses
  // periodMonthsBetween, so March–October is 8.
  const pnl = parseSageProfitAndLoss(monthJson, 1);
  const yearPnl =
    yearJson && ranges.year ? parseSageProfitAndLoss(yearJson, ranges.year.periodMonths) : null;
  const bs = parseSageBalanceSheet(bsJson);

  let bankAccounts: SageBankAccount[] = [];
  try {
    bankAccounts = await fetchBankAccounts(auth, fetchImpl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "BankAccount/Get failed";
    console.error(
      "[sage sync] BankAccount/Get failed; cash falls back to the balance sheet.",
      detail.replace(/\s+/g, " ").slice(0, 180),
    );
    bankAccounts = [];
  }
  const bankCash = sumSageBankBalances(bankAccounts);
  const cash = bankCash ?? bs.cash;
  const syncedAt = now.toISOString();

  let customers: SagePartyBalance[] = [];
  try {
    customers = await fetchPartyBalances(auth, "Customer/Get", fetchImpl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Customer/Get failed";
    console.error(
      "[sage sync] Customer/Get failed; customer ageing keeps the totals row only.",
      detail.replace(/\s+/g, " ").slice(0, 180),
    );
  }
  let suppliers: SagePartyBalance[] = [];
  try {
    suppliers = await fetchPartyBalances(auth, "Supplier/Get", fetchImpl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Supplier/Get failed";
    console.error(
      "[sage sync] Supplier/Get failed; supplier ageing keeps the totals row only.",
      detail.replace(/\s+/g, " ").slice(0, 180),
    );
  }

  let agedAr: CollectionsSnapshot;
  try {
    const json = await sageCall(
      auth,
      "CustomerAgeing/GetSummary",
      { method: "POST", body: sageAgeingBody(ranges.month.to) },
      fetchImpl,
    );
    agedAr = parseSageCustomerAgeing(json, ranges.month.to, syncedAt, customers);
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
    agedAp = parseSageSupplierAgeing(json, ranges.month.to, syncedAt, suppliers);
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
    mappingIssue: sageLedgerMappingIssue(pnl, yearPnl, bs),
  };
}
