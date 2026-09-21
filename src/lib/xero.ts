/**
 * Xero Accounting API client — pure helpers + fetch wrappers.
 * Token handling and report parsing live here.
 * Only import this file from server-side code (server functions / API routes).
 *
 * Never log access_token, refresh_token, or client_secret.
 */

import { PERIOD_MONTHS_KEY } from "@/lib/ratios";
import {
  calendarMonthBounds,
  financialYearToDate,
  formatStatementPeriodLabel,
  type YearBasis,
} from "@/lib/statement-period";

// ─── Config ──────────────────────────────────────────────────────────────────

export const XERO_CLIENT_ID = () => {
  const id = process.env.XERO_CLIENT_ID ?? "";
  if (!id) throw new Error("XERO_CLIENT_ID environment variable is not set");
  return id;
};

export const XERO_CLIENT_SECRET = () => {
  const s = process.env.XERO_CLIENT_SECRET ?? "";
  if (!s) throw new Error("XERO_CLIENT_SECRET environment variable is not set");
  return s;
};

export const XERO_REDIRECT_URI = () => process.env.XERO_REDIRECT_URI ?? "";

/**
 * Scopes the Xero web app must grant. A refresh token keeps only the scopes
 * from the last consent, so an existing connection has to disconnect and
 * connect again after `accounting.reports.banksummary.read` is enabled.
 *
 * offline_access
 * accounting.settings.read               — organisation name and financial year end
 * accounting.reports.profitandloss.read  — month-to-date and year-to-date P&L
 * accounting.reports.balancesheet.read   — balance sheet
 * accounting.reports.banksummary.read    — bank account names and closing balances
 *
 * Not requested: accounting.banktransactions, invoices, payroll, or bank feeds.
 * Bank Summary over the 13 weeks ending on the balance-sheet date is enough
 * for starting cash. It is not a bank-feed product.
 */
export const XERO_DEFAULT_SCOPES = [
  "offline_access",
  "accounting.settings.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.banksummary.read",
] as const;

export function xeroScopes(): string {
  return XERO_DEFAULT_SCOPES.join(" ");
}

const XERO_AUTH_ENDPOINT = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_ENDPOINT = "https://identity.xero.com/connect/token";
const XERO_REVOKE_ENDPOINT = "https://identity.xero.com/connect/revocation";
const XERO_CONNECTIONS_ENDPOINT = "https://api.xero.com/connections";
const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";

/** Header name Xero requires on every Accounting API call. */
export const XERO_TENANT_HEADER = "Xero-tenant-id";

// ─── OAuth ───────────────────────────────────────────────────────────────────

export function buildXeroAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: XERO_CLIENT_ID(),
    redirect_uri: XERO_REDIRECT_URI(),
    scope: xeroScopes(),
    state,
  });
  return `${XERO_AUTH_ENDPOINT}?${params}`;
}

function basicCredentials() {
  return btoa(`${XERO_CLIENT_ID()}:${XERO_CLIENT_SECRET()}`);
}

export type XeroTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
};

function readTokenResponse(json: unknown): XeroTokenResponse {
  if (!json || typeof json !== "object") throw new Error("Xero token response was empty");
  const o = json as Record<string, unknown>;
  const access = typeof o.access_token === "string" ? o.access_token : "";
  const refresh = typeof o.refresh_token === "string" ? o.refresh_token : "";
  const expires = typeof o.expires_in === "number" ? o.expires_in : Number(o.expires_in);
  if (!access || !refresh || !Number.isFinite(expires)) {
    throw new Error("Xero token response missing access_token, refresh_token, or expires_in");
  }
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: expires,
    token_type: typeof o.token_type === "string" ? o.token_type : undefined,
    scope: typeof o.scope === "string" ? o.scope : undefined,
  };
}

export async function exchangeXeroCodeForTokens(code: string): Promise<XeroTokenResponse> {
  const res = await fetch(XERO_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicCredentials()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: XERO_REDIRECT_URI(),
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Xero token exchange failed (${res.status}): ${redactSecrets(t).slice(0, 300)}`);
  }
  return readTokenResponse(await res.json());
}

export async function refreshXeroToken(refreshToken: string): Promise<XeroTokenResponse> {
  const res = await fetch(XERO_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicCredentials()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Xero token refresh failed (${res.status}): ${redactSecrets(t).slice(0, 300)}`);
  }
  return readTokenResponse(await res.json());
}

export async function revokeXeroToken(token: string): Promise<void> {
  try {
    await fetch(XERO_REVOKE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicCredentials()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Best-effort — local disconnect still proceeds.
  }
}

export function redactSecrets(text: string): string {
  return text
    .replace(/"(access_token|refresh_token|id_token|client_secret)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [redacted]");
}

// ─── Connections / tenants ────────────────────────────────────────────────────

export type XeroTenantConnection = {
  id: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
  createdDateUtc?: string;
  updatedDateUtc?: string;
};

export function parseXeroConnections(json: unknown): XeroTenantConnection[] {
  if (!Array.isArray(json)) return [];
  const out: XeroTenantConnection[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const tenantId = typeof o.tenantId === "string" ? o.tenantId : "";
    if (!tenantId) continue;
    out.push({
      id: typeof o.id === "string" ? o.id : "",
      tenantId,
      tenantType: typeof o.tenantType === "string" ? o.tenantType : "ORGANISATION",
      tenantName: typeof o.tenantName === "string" ? o.tenantName : "",
      createdDateUtc: typeof o.createdDateUtc === "string" ? o.createdDateUtc : undefined,
      updatedDateUtc: typeof o.updatedDateUtc === "string" ? o.updatedDateUtc : undefined,
    });
  }
  return out;
}

/** Prefer organisations; if several, take the most recently updated. */
export function pickXeroTenant(
  connections: XeroTenantConnection[],
): XeroTenantConnection | null {
  const orgs = connections.filter((c) => (c.tenantType || "ORGANISATION") === "ORGANISATION");
  const pool = orgs.length ? orgs : connections;
  if (!pool.length) return null;
  return [...pool].sort((a, b) => {
    const ta = Date.parse(a.updatedDateUtc ?? a.createdDateUtc ?? "") || 0;
    const tb = Date.parse(b.updatedDateUtc ?? b.createdDateUtc ?? "") || 0;
    return tb - ta;
  })[0] ?? null;
}

export async function fetchXeroConnections(
  accessToken: string,
): Promise<XeroTenantConnection[]> {
  const res = await fetch(XERO_CONNECTIONS_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Xero connections failed (${res.status}): ${redactSecrets(t).slice(0, 300)}`);
  }
  return parseXeroConnections(await res.json());
}

export async function deleteXeroConnection(
  accessToken: string,
  connectionId: string,
): Promise<void> {
  if (!connectionId) return;
  try {
    await fetch(`${XERO_CONNECTIONS_ENDPOINT}/${connectionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Best-effort remote disconnect.
  }
}

// ─── Authenticated API calls ──────────────────────────────────────────────────

export async function xeroGet(
  tenantId: string,
  accessToken: string,
  path: string,
): Promise<unknown> {
  const url = path.startsWith("http") ? path : `${XERO_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      [XERO_TENANT_HEADER]: tenantId,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Xero API ${path} → ${res.status}: ${redactSecrets(t).slice(0, 300)}`);
  }
  return res.json();
}

// ─── Report row types ─────────────────────────────────────────────────────────

export type XeroReportCell = { Value?: string; Attributes?: unknown[] };

export type XeroReportRow = {
  RowType?: string;
  Title?: string;
  Cells?: XeroReportCell[];
  Rows?: XeroReportRow[];
};

export type XeroReport = {
  ReportID?: string;
  ReportName?: string;
  ReportTitles?: string[];
  ReportDate?: string;
  Rows?: XeroReportRow[];
};

export type XeroReportsResponse = { Reports?: XeroReport[] };

export function firstXeroReport(json: unknown): XeroReport | null {
  if (!json || typeof json !== "object") return null;
  const reports = (json as XeroReportsResponse).Reports;
  return Array.isArray(reports) && reports[0] ? reports[0] : null;
}

function cellValue(row: XeroReportRow | undefined, index: number): string {
  const cells = row?.Cells ?? [];
  const raw = cells[index]?.Value ?? "";
  return String(raw);
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[, ]/g, "").replace(/[()]/g, (ch) => (ch === "(" ? "-" : ""));
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Amount for one report column.
 * Cell 0 is the label when the row has more than one cell. Column 0 is the
 * current period — the first amount — not the last cell. Xero comparison
 * reports put older periods, and sometimes a trailing 0.00, after it.
 * Returns 0 when that column is absent (callers must not clamp onto the last column).
 */
export function xeroRowAmount(row: XeroReportRow | undefined, amountColumn = 0): number {
  if (!row) return 0;
  const cells = row.Cells ?? [];
  const start = cells.length > 1 ? 1 : 0;
  const amounts: number[] = [];
  for (let i = start; i < cells.length; i++) {
    const v = cells[i]?.Value ?? "";
    if (v === "" || v == null) continue;
    if (!/[0-9]/.test(String(v))) continue;
    amounts.push(parseAmount(String(v)));
  }
  if (amountColumn < 0 || amountColumn >= amounts.length) return 0;
  return amounts[amountColumn] ?? 0;
}

function rowLabel(row: XeroReportRow | undefined): string {
  if (!row) return "";
  if (row.Title) return row.Title;
  return cellValue(row, 0);
}

function walkRows(rows: XeroReportRow[] | undefined, visit: (row: XeroReportRow) => void) {
  if (!rows) return;
  for (const r of rows) {
    visit(r);
    if (r.Rows?.length) walkRows(r.Rows, visit);
  }
}

function findSection(rows: XeroReportRow[], ...titles: string[]): XeroReportRow | undefined {
  const needles = titles.map((t) => t.toLowerCase());
  let found: XeroReportRow | undefined;
  walkRows(rows, (r) => {
    if (found) return;
    if ((r.RowType ?? "").toLowerCase() !== "section") return;
    const label = (r.Title ?? rowLabel(r)).toLowerCase();
    if (needles.some((n) => label.includes(n))) found = r;
  });
  return found;
}

function findRowByLabel(rows: XeroReportRow[], ...labels: string[]): XeroReportRow | undefined {
  const needles = labels.map((t) => t.toLowerCase());
  let found: XeroReportRow | undefined;
  walkRows(rows, (r) => {
    if (found) return;
    const type = (r.RowType ?? "").toLowerCase();
    if (type === "header" || type === "section") return;
    const label = rowLabel(r).toLowerCase();
    if (needles.some((n) => label.includes(n))) found = r;
  });
  return found;
}

function sectionTotal(section: XeroReportRow | undefined, amountColumn = 0): number {
  if (!section) return 0;
  const summary =
    (section.Rows ?? []).find((r) => (r.RowType ?? "").toLowerCase() === "summaryrow") ??
    findRowByLabel(section.Rows ?? [], "total");
  if (summary) return xeroRowAmount(summary, amountColumn);
  // Fall back to summing leaf rows (skip nested summaries already counted).
  let sum = 0;
  for (const r of section.Rows ?? []) {
    if ((r.RowType ?? "").toLowerCase() === "row") sum += xeroRowAmount(r, amountColumn);
  }
  return sum;
}

function absAmount(row: XeroReportRow | undefined, amountColumn = 0): number {
  return Math.abs(xeroRowAmount(row, amountColumn));
}

// ─── P&L ─────────────────────────────────────────────────────────────────────

export type XeroPnL = {
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

export function periodMonthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) {
    return 12;
  }
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth()) +
    1;
  return Math.min(12, Math.max(1, months));
}

export function ytdRange(now = new Date()): { from: string; to: string; periodMonths: number } {
  const to = now.toISOString().slice(0, 10);
  const from = `${now.getUTCFullYear()}-01-01`;
  return { from, to, periodMonths: periodMonthsBetween(from, to) };
}

export function parseXeroProfitAndLoss(
  json: unknown,
  periodMonths = 12,
  amountColumn = 0,
): XeroPnL {
  const report = firstXeroReport(json);
  const rows = report?.Rows ?? [];

  const incomeSection = findSection(rows, "income", "revenue");
  const cogsSection = findSection(rows, "cost of sales", "cost of goods");
  const opexSection = findSection(rows, "operating expense", "less operating");

  const revenue =
    absAmount(findRowByLabel(rows, "total income", "total revenue", "total trading income"), amountColumn) ||
    Math.abs(sectionTotal(incomeSection, amountColumn));
  const cogs =
    absAmount(findRowByLabel(rows, "total cost of sales", "total cost of goods"), amountColumn) ||
    Math.abs(sectionTotal(cogsSection, amountColumn));
  const grossProfitRow = findRowByLabel(rows, "gross profit");
  const grossProfit = grossProfitRow ? xeroRowAmount(grossProfitRow, amountColumn) : revenue - cogs;

  const opex =
    absAmount(findRowByLabel(rows, "total operating expense", "total expenses"), amountColumn) ||
    Math.abs(sectionTotal(opexSection, amountColumn));

  const depRow =
    findRowByLabel(rows, "depreciation") ?? findRowByLabel(rows, "amortisation", "amortization");
  const depreciation = depRow ? Math.abs(xeroRowAmount(depRow, amountColumn)) : 0;

  const netRow =
    findRowByLabel(rows, "net profit") ??
    findRowByLabel(rows, "net income") ??
    findRowByLabel(rows, "profit for the period") ??
    findRowByLabel(rows, "surplus");
  const netIncome = netRow ? xeroRowAmount(netRow, amountColumn) : grossProfit - opex;

  const taxRow = findRowByLabel(rows, "income tax", "tax expense");
  const interestRow = findRowByLabel(rows, "interest expense", "interest paid");
  const tax = taxRow ? Math.abs(xeroRowAmount(taxRow, amountColumn)) : 0;
  const interest = interestRow ? Math.abs(xeroRowAmount(interestRow, amountColumn)) : 0;

  const ebit = opex ? grossProfit - opex : netIncome + tax + interest;
  const ebt = tax ? netIncome + tax : ebit;
  const ebitda = ebit + depreciation;

  return {
    revenue,
    cogs,
    grossProfit,
    operatingExpenses: opex,
    ebit,
    ebt,
    netIncome,
    ebitda,
    depreciation,
    periodMonths,
  };
}

/** One P&L for an explicit range. No `periods` — that would add unlabeled columns. */
export function xeroProfitAndLossRangePath(from: string, to: string): string {
  const q = new URLSearchParams({
    fromDate: from,
    toDate: to,
    standardLayout: "true",
  });
  return `/Reports/ProfitAndLoss?${q.toString()}`;
}

/** Balance sheet as at one date. One amount column, standard layout. */
export function xeroBalanceSheetPath(date: string): string {
  const q = new URLSearchParams({
    date,
    standardLayout: "true",
  });
  return `/Reports/BalanceSheet?${q.toString()}`;
}

/** 13 weeks — the cash-forecast horizon. Bank Summary refuses ranges over a year. */
export const XERO_BANK_SUMMARY_DAYS = 13 * 7;

/**
 * Bank Summary window ending on the balance-sheet date.
 * Closing balances are the forecast's starting cash. Cash received and cash
 * spent in the window are stored with the cache; they are not turned into
 * forecast lines.
 */
export function bankSummaryRange(asOfIso: string): { from: string; to: string } {
  const to = /^\d{4}-\d{2}-\d{2}/.test(asOfIso) ? asOfIso.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - XERO_BANK_SUMMARY_DAYS);
  return { from: end.toISOString().slice(0, 10), to };
}

export function xeroBankSummaryPath(from: string, to: string): string {
  const q = new URLSearchParams({ fromDate: from, toDate: to });
  return `/Reports/BankSummary?${q.toString()}`;
}

export async function fetchXeroProfitAndLoss(
  tenantId: string,
  accessToken: string,
  range = ytdRange(),
): Promise<XeroPnL> {
  const data = await xeroGet(
    tenantId,
    accessToken,
    xeroProfitAndLossRangePath(range.from, range.to),
  );
  return parseXeroProfitAndLoss(data, range.periodMonths);
}

/** Organisation.FinancialYearEndMonth (1–12) and FinancialYearEndDay. */
export function parseXeroFinancialYearEnd(json: unknown): { month: number; day: number } | null {
  if (!json || typeof json !== "object") return null;
  const orgs = (json as { Organisations?: unknown }).Organisations;
  const org = Array.isArray(orgs) ? orgs[0] : null;
  if (!org || typeof org !== "object") return null;
  const row = org as Record<string, unknown>;
  const month = Number(row.FinancialYearEndMonth);
  const day = Number(row.FinancialYearEndDay);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return { month, day };
}

export type XeroYearStatement = {
  pnl: XeroPnL;
  from: string;
  to: string;
  periodLabel: string;
  basis: YearBasis;
};

export type XeroLedgerStatement = {
  /** Month to date — the range an accountant compares in the Xero month view. */
  pnl: XeroPnL;
  bs: XeroBalanceSheet;
  from: string;
  to: string;
  periodLabel: string;
  /** Financial year to date, or calendar year to date when the org year-end is unknown. Null when that range is the month. */
  year: XeroYearStatement | null;
  /** Null when the connection has not granted the bank-summary scope yet. */
  bank: XeroBankSummary | null;
  bankWarning: string | null;
};

async function resolveYearRange(
  tenantId: string,
  accessToken: string,
  now: Date,
): Promise<{ from: string; to: string; basis: YearBasis }> {
  try {
    const org = await xeroGet(tenantId, accessToken, "/Organisation");
    const fy = parseXeroFinancialYearEnd(org);
    if (fy) {
      const range = financialYearToDate(now, fy.month, fy.day);
      return { ...range, basis: "financial" };
    }
  } catch {
    // Settings read failed. Calendar year to date, labeled as calendar — not as FY.
  }
  const calendar = ytdRange(now);
  return { from: calendar.from, to: calendar.to, basis: "calendar" };
}

const BANK_SCOPE_WARNING =
  "Bank balances need a reconnect. In the Xero app, enable accounting.reports.banksummary.read, then disconnect and connect again.";

async function fetchXeroBankSummarySafe(
  tenantId: string,
  accessToken: string,
  range: { from: string; to: string },
): Promise<{ bank: XeroBankSummary | null; bankWarning: string | null }> {
  try {
    const data = await xeroGet(tenantId, accessToken, xeroBankSummaryPath(range.from, range.to));
    return { bank: parseXeroBankSummary(data, range), bankWarning: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Xero bank summary failed";
    // A missing scope is 401/403 on this report only. P&L and the balance sheet still save.
    if (/\b(401|403)\b/.test(msg)) return { bank: null, bankWarning: BANK_SCOPE_WARNING };
    throw err instanceof Error ? err : new Error(msg);
  }
}

/**
 * Two explicit P&L ranges (month to date, and financial year to date), the
 * balance sheet at the month-end date, and a Bank Summary for the 13 weeks
 * ending that day. Each report is one fromDate/toDate.
 */
export async function fetchXeroLedgerStatement(
  tenantId: string,
  accessToken: string,
  now = new Date(),
): Promise<XeroLedgerStatement> {
  const month = calendarMonthBounds(now, 0);
  const yearRange = await resolveYearRange(tenantId, accessToken, now);
  const banks = bankSummaryRange(month.to);
  const same = yearRange.from === month.from && yearRange.to === month.to;
  const [monthJson, yearJson, bsJson, bankResult] = await Promise.all([
    xeroGet(tenantId, accessToken, xeroProfitAndLossRangePath(month.from, month.to)),
    same
      ? Promise.resolve(null)
      : xeroGet(
          tenantId,
          accessToken,
          xeroProfitAndLossRangePath(yearRange.from, yearRange.to),
        ),
    xeroGet(tenantId, accessToken, xeroBalanceSheetPath(month.to)),
    fetchXeroBankSummarySafe(tenantId, accessToken, banks),
  ]);
  const year = yearJson
    ? {
        pnl: parseXeroProfitAndLoss(
          yearJson,
          periodMonthsBetween(yearRange.from, yearRange.to),
          0,
        ),
        from: yearRange.from,
        to: yearRange.to,
        periodLabel: formatStatementPeriodLabel(yearRange.from, yearRange.to),
        basis: yearRange.basis,
      }
    : null;
  const parsedBs = parseXeroBalanceSheet(bsJson);
  return {
    pnl: parseXeroProfitAndLoss(monthJson, 1, 0),
    bs: { ...parsedBs, asOf: month.to },
    from: month.from,
    to: month.to,
    periodLabel: formatStatementPeriodLabel(month.from, month.to),
    year,
    bank: bankResult.bank,
    bankWarning: bankResult.bankWarning,
  };
}

// ─── Balance Sheet ────────────────────────────────────────────────────────────

export type XeroBalanceSheet = {
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  receivables: number;
  inventory: number;
  payables: number;
  cash: number;
  /** Bank plus the Current Assets section. Current ratio reads this. */
  currentAssets: number;
  /** Current Liabilities section, else payables. Current ratio reads this. */
  currentLiabilities: number;
  /**
   * Interest-bearing debt (non-current liabilities plus loans sitting in
   * current liabilities). Debt-to-equity on the board is still
   * (total assets − equity), which is every liability, not only this figure.
   */
  debt: number;
  /** ISO date the report was requested for. Empty when parsed from a fixture. */
  asOf: string;
};

function sectionTitle(row: XeroReportRow): string {
  return (row.Title ?? rowLabel(row)).toLowerCase();
}

function findTitledSection(
  rows: XeroReportRow[],
  match: (title: string) => boolean,
): XeroReportRow | undefined {
  let found: XeroReportRow | undefined;
  walkRows(rows, (r) => {
    if (found) return;
    if ((r.RowType ?? "").toLowerCase() !== "section") return;
    if (match(sectionTitle(r))) found = r;
  });
  return found;
}

function isNonCurrentTitle(title: string): boolean {
  return title.includes("non-current") || title.includes("non current");
}

function sectionIsInside(parent: XeroReportRow | undefined, child: XeroReportRow | undefined): boolean {
  if (!parent || !child) return false;
  let hit = false;
  walkRows(parent.Rows, (r) => {
    if (r === child) hit = true;
  });
  return hit;
}

const DEBT_LABEL =
  /loan|borrowing|overdraft|hire purchase|finance lease|long[- ]term debt|term loan|mortgage|asset finance/i;
const NOT_DEBT_LABEL = /bad debt|debtor/i;

function sumDebtRows(section: XeroReportRow | undefined): number {
  if (!section) return 0;
  let sum = 0;
  walkRows(section.Rows, (r) => {
    const type = (r.RowType ?? "").toLowerCase();
    if (type === "header" || type === "section" || type === "summaryrow") return;
    const label = rowLabel(r);
    if (!DEBT_LABEL.test(label) || NOT_DEBT_LABEL.test(label)) return;
    sum += Math.abs(xeroRowAmount(r));
  });
  return sum;
}

export function parseXeroBalanceSheet(json: unknown): XeroBalanceSheet {
  const report = firstXeroReport(json);
  const rows = report?.Rows ?? [];

  const totalAssets =
    absAmount(findRowByLabel(rows, "total assets")) ||
    Math.abs(sectionTotal(findSection(rows, "assets")));
  const totalLiabilities =
    absAmount(findRowByLabel(rows, "total liabilities")) ||
    Math.abs(sectionTotal(findSection(rows, "liabilities")));
  const equity =
    xeroRowAmount(findRowByLabel(rows, "total equity", "net assets", "proprietorship")) ||
    totalAssets - totalLiabilities;

  const receivables = absAmount(
    findRowByLabel(
      rows,
      "accounts receivable",
      "trade receivables",
      "trade debtors",
      "accounts receiv",
    ),
  );
  const inventory = absAmount(findRowByLabel(rows, "inventory", "stock on hand", "inventories"));
  const payables = absAmount(
    findRowByLabel(rows, "accounts payable", "trade payables", "trade creditors", "accounts payable"),
  );

  const bankSection = findTitledSection(
    rows,
    (title) => title === "bank" || title === "bank accounts" || title.startsWith("bank ") || title.includes("cash and cash"),
  );
  const bankTotal = bankSection ? Math.abs(sectionTotal(bankSection)) : 0;
  const cash =
    bankTotal ||
    absAmount(
      findRowByLabel(rows, "total bank", "cash and cash equivalent", "cash at bank", "cash and cash equivalents"),
    ) ||
    absAmount(findRowByLabel(rows, "bank"));

  const currentAssetsSection = findTitledSection(
    rows,
    (title) => !isNonCurrentTitle(title) && title.includes("current asset"),
  );
  const currentLiabSection = findTitledSection(
    rows,
    (title) => !isNonCurrentTitle(title) && title.includes("current liabilit"),
  );

  let currentAssets = 0;
  if (currentAssetsSection) {
    currentAssets = Math.abs(sectionTotal(currentAssetsSection));
    if (bankSection && !sectionIsInside(currentAssetsSection, bankSection)) {
      currentAssets += bankTotal || cash;
    }
  } else {
    currentAssets = cash + receivables + inventory;
  }

  const currentLiabilities = currentLiabSection
    ? Math.abs(sectionTotal(currentLiabSection))
    : payables || totalLiabilities;

  const nonCurrentLiab = findTitledSection(
    rows,
    (title) =>
      title.includes("non-current liabilit") ||
      title.includes("non current liabilit") ||
      title.includes("long-term liabilit") ||
      title.includes("long term liabilit"),
  );
  const debt = (nonCurrentLiab ? Math.abs(sectionTotal(nonCurrentLiab)) : 0) + sumDebtRows(currentLiabSection);

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
    debt,
    asOf: "",
  };
}

// ─── Bank Summary ─────────────────────────────────────────────────────────────

export type XeroBankAccount = {
  accountId: string | null;
  name: string;
  opening: number;
  cashReceived: number;
  cashSpent: number;
  closing: number;
};

export type XeroBankSummary = {
  from: string;
  to: string;
  accounts: XeroBankAccount[];
  totalClosing: number;
};

function accountIdOf(cell: XeroReportCell | undefined): string | null {
  const attrs = cell?.Attributes;
  if (!Array.isArray(attrs)) return null;
  for (const attr of attrs) {
    if (!attr || typeof attr !== "object") continue;
    const row = attr as { Id?: unknown; Value?: unknown };
    const id = typeof row.Id === "string" ? row.Id : "";
    if (!/account/i.test(id)) continue;
    return typeof row.Value === "string" && row.Value ? row.Value : null;
  }
  return null;
}

function headerColumn(header: XeroReportRow | undefined, needles: string[], fallback: number): number {
  const cells = header?.Cells ?? [];
  const idx = cells.findIndex((cell) =>
    needles.some((needle) => String(cell?.Value ?? "").toLowerCase().includes(needle)),
  );
  return idx >= 0 ? idx : fallback;
}

/**
 * Bank Summary rows: account name, opening, cash received, cash spent, closing.
 * The Total row is not an account. Closing balances stay signed (an overdraft
 * reduces starting cash).
 */
export function parseXeroBankSummary(
  json: unknown,
  range: { from: string; to: string },
): XeroBankSummary {
  const report = firstXeroReport(json);
  const rows = report?.Rows ?? [];
  let header: XeroReportRow | undefined;
  walkRows(rows, (row) => {
    if (header) return;
    if ((row.RowType ?? "").toLowerCase() === "header") header = row;
  });
  const nameIdx = headerColumn(header, ["bank account", "account"], 0);
  const openIdx = headerColumn(header, ["opening"], 1);
  const inIdx = headerColumn(header, ["received"], 2);
  const outIdx = headerColumn(header, ["spent"], 3);
  const closeIdx = headerColumn(header, ["closing"], 4);

  const accounts: XeroBankAccount[] = [];
  walkRows(rows, (row) => {
    if ((row.RowType ?? "").toLowerCase() !== "row") return;
    const name = cellValue(row, nameIdx).trim();
    if (!name || /^total\b/i.test(name)) return;
    accounts.push({
      accountId: accountIdOf(row.Cells?.[nameIdx]),
      name,
      opening: parseAmount(cellValue(row, openIdx)),
      cashReceived: parseAmount(cellValue(row, inIdx)),
      cashSpent: parseAmount(cellValue(row, outIdx)),
      closing: parseAmount(cellValue(row, closeIdx)),
    });
  });
  const totalClosing = Math.round(accounts.reduce((sum, account) => sum + account.closing, 0) * 100) / 100;
  return { from: range.from, to: range.to, accounts, totalClosing };
}

/** Bank Summary closing total when accounts came back; otherwise the balance-sheet cash line. */
export function resolveXeroCash(
  bs: { cash: number },
  bank: { accounts: unknown[]; totalClosing: number } | null | undefined,
): number {
  if (bank && bank.accounts.length > 0 && Number.isFinite(bank.totalClosing)) return bank.totalClosing;
  return bs.cash;
}

export type XeroSyncCoverage = {
  bsAsOf: string | null;
  bankCount: number | null;
  bankTotal: number | null;
  bankWarning: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Read the cached balance sheet and bank summary written by sync. */
export function coverageFromXeroCache(
  rows: Array<{ data_type?: string | null; raw_data?: unknown }>,
): XeroSyncCoverage {
  const bs = asRecord(rows.find((row) => row.data_type === "bs")?.raw_data);
  const bank = asRecord(rows.find((row) => row.data_type === "bank")?.raw_data);
  const warning = typeof bank?.warning === "string" && bank.warning.trim() ? bank.warning : null;
  const accounts = Array.isArray(bank?.accounts) ? bank.accounts : null;
  const total =
    typeof bank?.totalClosing === "number" && Number.isFinite(bank.totalClosing) ? bank.totalClosing : null;
  const granted = accounts != null && !warning;
  const asOf = typeof bs?.asOf === "string" && bs.asOf.trim() ? bs.asOf : null;
  return {
    bsAsOf: asOf,
    bankCount: granted ? accounts.length : null,
    bankTotal: granted ? total : null,
    bankWarning: warning,
  };
}

export async function fetchXeroBalanceSheet(
  tenantId: string,
  accessToken: string,
  date = new Date().toISOString().slice(0, 10),
): Promise<XeroBalanceSheet> {
  const data = await xeroGet(tenantId, accessToken, xeroBalanceSheetPath(date));
  return parseXeroBalanceSheet(data);
}

// ─── Data mapper ──────────────────────────────────────────────────────────────

/**
 * Maps Xero P&L + balance sheet onto the financials the health score, ratios,
 * and cash forecast already read.
 *
 * Current ratio reads `currentAssets` and `currentLiabilities`.
 * Debt-to-equity reads `totalAssets` and `equity` (debt = assets − equity).
 * The cash forecast opening reads `cash`: bank-summary closing balances when
 * the Bank Summary came back, otherwise the balance-sheet Bank section.
 */
export type XeroMappedYear = {
  pnl: Pick<XeroPnL, "revenue" | "netIncome" | "periodMonths">;
  from: string;
  to: string;
  label: string;
  basis: YearBasis;
};

export function mapXeroToFinancialInputs(
  pnl: XeroPnL,
  bs: XeroBalanceSheet,
  period?: { from: string; to: string; label: string },
  year?: XeroMappedYear | null,
  bank?: XeroBankSummary | null,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  const dated = Boolean(period?.from && period?.to);
  const set = (k: string, v: number) => {
    if (!Number.isFinite(v)) return;
    // A dated statement replaces the previous total, including a real zero.
    // Undated balance-sheet zeros stay unset so a bad column does not wipe cash.
    if (!dated && v === 0) return;
    out[k] = v;
  };
  set("revenue", pnl.revenue);
  set("cogs", pnl.cogs);
  set("ebit", pnl.ebit);
  set("ebt", pnl.ebt);
  set("netIncome", pnl.netIncome);
  set("ebitda", pnl.ebitda);
  set("fixedCosts", pnl.operatingExpenses);
  const setBs = (k: string, v: number) => {
    if (Number.isFinite(v) && v !== 0) out[k] = v;
  };
  setBs("totalAssets", bs.totalAssets);
  setBs("equity", bs.equity);
  setBs("receivables", bs.receivables);
  setBs("inventory", bs.inventory);
  setBs("payables", bs.payables);
  setBs("currentAssets", bs.currentAssets);
  setBs("currentLiabilities", bs.currentLiabilities);
  setBs("cash", resolveXeroCash(bs, bank));
  if (Number.isFinite(pnl.periodMonths) && pnl.periodMonths >= 1 && pnl.periodMonths <= 12) {
    out[PERIOD_MONTHS_KEY] = String(pnl.periodMonths);
  }
  if (period?.from && period.to) {
    out.statementSource = "xero";
    out.periodStart = period.from;
    out.periodEnd = period.to;
    out.periodLabel = period.label || formatStatementPeriodLabel(period.from, period.to);
  }
  if (
    year?.from &&
    year.to &&
    !(period?.from === year.from && period?.to === year.to)
  ) {
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
