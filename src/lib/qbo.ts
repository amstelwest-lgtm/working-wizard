/**
 * QuickBooks Online API client — pure helpers + fetch wrappers.
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
import { periodMonthsBetween, ytdRange } from "@/lib/xero";

// ─── Config ──────────────────────────────────────────────────────────────────

export const QBO_ENV = () => process.env.QBO_ENVIRONMENT ?? "sandbox";

export const QBO_CLIENT_ID = () => {
  const id = process.env.QBO_CLIENT_ID ?? "";
  if (!id) throw new Error("QBO_CLIENT_ID environment variable is not set");
  return id;
};

export const QBO_CLIENT_SECRET = () => {
  const s = process.env.QBO_CLIENT_SECRET ?? "";
  if (!s) throw new Error("QBO_CLIENT_SECRET environment variable is not set");
  return s;
};

export const QBO_REDIRECT_URI = () => process.env.QBO_REDIRECT_URI ?? "";

/** Accounting reports + company info. One scope. No payments, payroll, or OpenID. */
export const QBO_ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";

const QBO_AUTH_ENDPOINT = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_REVOKE_ENDPOINT = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const MINOR_VERSION = "70";

const FISCAL_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export function qboCredentialsConfigured(): boolean {
  return Boolean(
    process.env.QBO_CLIENT_ID?.trim() &&
    process.env.QBO_CLIENT_SECRET?.trim() &&
    process.env.QBO_REDIRECT_URI?.trim(),
  );
}

export const qboApiBase = () =>
  QBO_ENV() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

export function redactSecrets(text: string): string {
  return text
    .replace(
      /"(access_token|refresh_token|id_token|client_secret)"\s*:\s*"[^"]*"/gi,
      '"$1":"[redacted]"',
    )
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [redacted]");
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

export function buildQboAuthUrl(state: string): string {
  const redirect = QBO_REDIRECT_URI().trim();
  if (!redirect) throw new Error("QBO_REDIRECT_URI environment variable is not set");
  const params = new URLSearchParams({
    client_id: QBO_CLIENT_ID(),
    response_type: "code",
    scope: QBO_ACCOUNTING_SCOPE,
    redirect_uri: redirect,
    state,
  });
  return `${QBO_AUTH_ENDPOINT}?${params}`;
}

function basicCredentials() {
  return btoa(`${QBO_CLIENT_ID()}:${QBO_CLIENT_SECRET()}`);
}

async function qboErrorText(res: Response): Promise<string> {
  return redactSecrets(await res.text()).slice(0, 300);
}

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
};

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(QBO_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicCredentials()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: QBO_REDIRECT_URI(),
    }),
  });
  if (!res.ok) {
    throw new Error(`QBO token exchange failed (${res.status}): ${await qboErrorText(res)}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export async function refreshQboToken(
  refreshToken: string,
): Promise<Omit<TokenResponse, "x_refresh_token_expires_in">> {
  const res = await fetch(QBO_TOKEN_ENDPOINT, {
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
    throw new Error(`QBO token refresh failed (${res.status}): ${await qboErrorText(res)}`);
  }
  return res.json() as Promise<TokenResponse>;
}

/** Revoke the grant. A 400 means the token is already dead — disconnect can continue. */
export async function revokeQboToken(token: string): Promise<void> {
  if (!token) return;
  const res = await fetch(QBO_REVOKE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicCredentials()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
  if (!res.ok && res.status !== 400) {
    throw new Error(`QBO token revoke failed (${res.status}): ${await qboErrorText(res)}`);
  }
}

// ─── Authenticated API calls ──────────────────────────────────────────────────

export async function qboGet(realmId: string, accessToken: string, path: string): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${qboApiBase()}/v3/company/${realmId}${path}${sep}minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`QBO API ${path.split("?")[0]} → ${res.status}: ${await qboErrorText(res)}`);
  }
  return res.json();
}

export async function fetchQboCompanyName(
  realmId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const info = await qboGet(realmId, accessToken, `/companyinfo/${realmId}`);
    const name = (info as { CompanyInfo?: { CompanyName?: string } }).CompanyInfo?.CompanyName;
    const trimmed = name?.trim() ?? "";
    return trimmed || null;
  } catch {
    return null;
  }
}

// ─── Report row types ─────────────────────────────────────────────────────────

type ColData = { value?: string; id?: string };

type ReportRow = {
  type?: string;
  group?: string;
  ColData?: ColData[];
  Header?: { ColData: ColData[] };
  Summary?: { ColData: ColData[] };
  Rows?: { Row?: ReportRow[] };
};

type ReportColumn = { ColTitle?: string; ColType?: string };

type ReportResponse = {
  Header?: { StartPeriod?: string; EndPeriod?: string };
  Columns?: { Column?: ReportColumn[] };
  Rows?: { Row?: ReportRow[] };
};

function asReport(json: unknown): ReportResponse {
  if (!json || typeof json !== "object") return {};
  return json as ReportResponse;
}

/**
 * One money column. Prefer a column titled Total, otherwise the first Money
 * column. Never the last cell — a trailing 0.00 is not the total.
 */
export function qboMoneyColumnIndex(json: unknown): number {
  const cols = asReport(json).Columns?.Column ?? [];
  const monies: number[] = [];
  cols.forEach((col, index) => {
    if ((col.ColType ?? "").toLowerCase() === "money") monies.push(index);
  });
  const total = cols.findIndex(
    (col, index) => monies.includes(index) && (col.ColTitle ?? "").trim().toLowerCase() === "total",
  );
  if (total >= 0) return total;
  if (monies.length > 0) return monies[0];
  return 1;
}

function parseMoney(raw: string | undefined): number {
  const text = (raw ?? "").trim();
  if (!text || text === "-") return 0;
  const negative = /^\(.*\)$/.test(text);
  const n = parseFloat(text.replace(/[(),$]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

function cellAmount(row: ReportRow | undefined, col: number): number {
  if (!row) return 0;
  const cols = row.Summary?.ColData ?? row.ColData ?? [];
  return parseMoney(cols[col]?.value);
}

function findGroup(rows: ReportRow[], group: string): ReportRow | undefined {
  const want = group.toLowerCase();
  for (const row of rows) {
    if ((row.group ?? "").toLowerCase() === want) return row;
    const nested = row.Rows?.Row;
    if (nested) {
      const found = findGroup(nested, group);
      if (found) return found;
    }
  }
}

function findLabel(rows: ReportRow[], text: string): ReportRow | undefined {
  const lc = text.toLowerCase();
  for (const row of rows) {
    const label = (
      row.ColData?.[0]?.value ??
      row.Header?.ColData?.[0]?.value ??
      row.Summary?.ColData?.[0]?.value ??
      ""
    ).toLowerCase();
    if (label.includes(lc)) return row;
    const nested = row.Rows?.Row;
    if (nested) {
      const found = findLabel(nested, text);
      if (found) return found;
    }
  }
}

function reportRows(json: unknown): ReportRow[] {
  return asReport(json).Rows?.Row ?? [];
}

// ─── Report paths — one date range, no summarize_column_by ───────────────────

/** One P&L for an explicit range. Do not pass summarize_column_by. */
export function qboProfitAndLossPath(from: string, to: string): string {
  const q = new URLSearchParams({
    start_date: from,
    end_date: to,
    accounting_method: "Accrual",
  });
  return `/reports/ProfitAndLoss?${q.toString()}`;
}

/** Balance sheet as at one date. One amount column. */
export function qboBalanceSheetPath(date: string): string {
  const q = new URLSearchParams({
    date,
    accounting_method: "Accrual",
  });
  return `/reports/BalanceSheet?${q.toString()}`;
}

export function qboCashFlowPath(from: string, to: string): string {
  const q = new URLSearchParams({
    start_date: from,
    end_date: to,
  });
  return `/reports/CashFlow?${q.toString()}`;
}

// ─── P&L ─────────────────────────────────────────────────────────────────────

export type QboPnL = {
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

export function parseQboProfitAndLoss(
  json: unknown,
  periodMonths = 1,
  amountColumn = qboMoneyColumnIndex(json),
): QboPnL {
  const rows = reportRows(json);
  const revenue = cellAmount(findGroup(rows, "Income"), amountColumn);
  const cogs = Math.abs(cellAmount(findGroup(rows, "COGS"), amountColumn));
  const grossRow = findGroup(rows, "GrossProfit");
  const grossProfit = grossRow ? cellAmount(grossRow, amountColumn) : revenue - cogs;
  const opex = Math.abs(cellAmount(findGroup(rows, "Expenses"), amountColumn));
  const noi = findGroup(rows, "NetOperatingIncome");
  const ebit = noi ? cellAmount(noi, amountColumn) : grossProfit - opex;
  const netRow = findGroup(rows, "NetIncome") ?? findLabel(rows, "net income");
  const netIncome = cellAmount(netRow, amountColumn);
  const depRow = findLabel(rows, "depreciation") ?? findLabel(rows, "amortization");
  const depreciation = depRow ? Math.abs(cellAmount(depRow, amountColumn)) : 0;
  const taxRow = findLabel(rows, "income tax") ?? findLabel(rows, "tax expense");
  const tax = taxRow ? Math.abs(cellAmount(taxRow, amountColumn)) : 0;
  const ebt = tax ? netIncome + tax : ebit;

  return {
    revenue,
    cogs,
    grossProfit,
    operatingExpenses: opex,
    ebit,
    ebt: Number.isFinite(ebt) ? ebt : ebit,
    netIncome,
    ebitda: ebit + depreciation,
    depreciation,
    periodMonths,
  };
}

// ─── Balance Sheet ────────────────────────────────────────────────────────────

export type QboBalanceSheet = {
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  receivables: number;
  inventory: number;
  payables: number;
  cash: number;
};

export function parseQboBalanceSheet(
  json: unknown,
  amountColumn = qboMoneyColumnIndex(json),
): QboBalanceSheet {
  const rows = reportRows(json);
  const assets = findGroup(rows, "Assets") ?? findGroup(rows, "TotalAssets");
  const liabilities = findGroup(rows, "Liabilities") ?? findGroup(rows, "TotalLiabilities");
  const equityRow = findGroup(rows, "Equity");
  const totalAssets = Math.abs(cellAmount(assets, amountColumn));
  const totalLiabilities = Math.abs(cellAmount(liabilities, amountColumn));
  const equity = equityRow ? cellAmount(equityRow, amountColumn) : totalAssets - totalLiabilities;
  const receivables = Math.abs(
    cellAmount(findGroup(rows, "AR") ?? findLabel(rows, "accounts receivable"), amountColumn),
  );
  const inventory = Math.abs(cellAmount(findLabel(rows, "inventory"), amountColumn));
  const payables = Math.abs(
    cellAmount(findGroup(rows, "AP") ?? findLabel(rows, "accounts payable"), amountColumn),
  );
  const cash = Math.abs(
    cellAmount(
      findGroup(rows, "BankAccounts") ??
        findLabel(rows, "bank accounts") ??
        findLabel(rows, "cash and cash equivalent") ??
        findLabel(rows, "cash"),
      amountColumn,
    ),
  );
  return {
    totalAssets,
    totalLiabilities,
    equity,
    receivables,
    inventory,
    payables,
    cash,
  };
}

// ─── Cash Flow ────────────────────────────────────────────────────────────────

export type QboCashFlow = {
  operatingCashflow: number;
  investingCashflow: number;
  financingCashflow: number;
};

export function parseQboCashFlow(
  json: unknown,
  amountColumn = qboMoneyColumnIndex(json),
): QboCashFlow {
  const rows = reportRows(json);
  const opRow = findGroup(rows, "OperatingActivities") ?? findLabel(rows, "operating activities");
  const invRow = findGroup(rows, "InvestingActivities") ?? findLabel(rows, "investing activities");
  const finRow = findGroup(rows, "FinancingActivities") ?? findLabel(rows, "financing activities");
  return {
    operatingCashflow: cellAmount(opRow, amountColumn),
    investingCashflow: cellAmount(invRow, amountColumn),
    financingCashflow: cellAmount(finRow, amountColumn),
  };
}

// ─── Fiscal year ──────────────────────────────────────────────────────────────

/** CompanyInfo.FiscalYearStartMonth is a month name ("January" … "December"). */
export function parseQboFiscalYearStartMonth(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const info =
    root.CompanyInfo && typeof root.CompanyInfo === "object"
      ? (root.CompanyInfo as Record<string, unknown>)
      : root;
  const raw = info.FiscalYearStartMonth;
  if (typeof raw !== "string") return null;
  const index = FISCAL_MONTHS.indexOf(raw.trim().toLowerCase());
  return index >= 0 ? index + 1 : null;
}

/** Fiscal year containing `now`, from the 1st of FiscalYearStartMonth through today. */
export function qboYearRangeFromFiscalStart(
  now: Date,
  startMonth: number,
): { from: string; to: string; basis: YearBasis } {
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const range = financialYearToDate(now, endMonth, 31);
  return { ...range, basis: "financial" };
}

async function resolveQboYearRange(
  realmId: string,
  accessToken: string,
  now: Date,
): Promise<{ from: string; to: string; basis: YearBasis }> {
  try {
    const info = await qboGet(realmId, accessToken, `/companyinfo/${realmId}`);
    const start = parseQboFiscalYearStartMonth(info);
    if (start) return qboYearRangeFromFiscalStart(now, start);
  } catch {
    // Company info failed. Calendar year to date, labeled calendar — not financial year.
  }
  const calendar = ytdRange(now);
  return { from: calendar.from, to: calendar.to, basis: "calendar" };
}

export type QboYearStatement = {
  pnl: QboPnL;
  from: string;
  to: string;
  periodLabel: string;
  basis: YearBasis;
};

export type QboLedgerStatement = {
  /** Month to date — the range an accountant compares as this month. */
  pnl: QboPnL;
  bs: QboBalanceSheet;
  from: string;
  to: string;
  periodLabel: string;
  /** Financial year to date, or calendar year to date when the fiscal start is unknown. Null when that range is the month. */
  year: QboYearStatement | null;
  operatingCashflow: number | null;
};

/**
 * Two explicit P&L ranges (month to date, and financial year to date) plus the
 * balance sheet at the month-end date. Each report is one start_date/end_date.
 */
export async function fetchQboLedgerStatement(
  realmId: string,
  accessToken: string,
  now = new Date(),
): Promise<QboLedgerStatement> {
  const month = calendarMonthBounds(now, 0);
  const yearRange = await resolveQboYearRange(realmId, accessToken, now);
  const same = yearRange.from === month.from && yearRange.to === month.to;
  const [monthJson, yearJson, bsJson, cfJson] = await Promise.all([
    qboGet(realmId, accessToken, qboProfitAndLossPath(month.from, month.to)),
    same
      ? Promise.resolve(null)
      : qboGet(realmId, accessToken, qboProfitAndLossPath(yearRange.from, yearRange.to)),
    qboGet(realmId, accessToken, qboBalanceSheetPath(month.to)),
    qboGet(realmId, accessToken, qboCashFlowPath(month.from, month.to)).catch(() => null),
  ]);
  const year = yearJson
    ? {
        pnl: parseQboProfitAndLoss(
          yearJson,
          periodMonthsBetween(yearRange.from, yearRange.to),
          qboMoneyColumnIndex(yearJson),
        ),
        from: yearRange.from,
        to: yearRange.to,
        periodLabel: formatStatementPeriodLabel(yearRange.from, yearRange.to),
        basis: yearRange.basis,
      }
    : null;
  const cf = cfJson ? parseQboCashFlow(cfJson, qboMoneyColumnIndex(cfJson)) : null;
  return {
    pnl: parseQboProfitAndLoss(monthJson, 1, qboMoneyColumnIndex(monthJson)),
    bs: parseQboBalanceSheet(bsJson, qboMoneyColumnIndex(bsJson)),
    from: month.from,
    to: month.to,
    periodLabel: formatStatementPeriodLabel(month.from, month.to),
    year,
    operatingCashflow: cf ? cf.operatingCashflow : null,
  };
}

// ─── Chart of Accounts ────────────────────────────────────────────────────────

export type QboAccount = {
  id: string;
  name: string;
  type: string;
  subType: string;
  balance: number;
  active: boolean;
};

export async function fetchChartOfAccounts(
  realmId: string,
  accessToken: string,
): Promise<QboAccount[]> {
  const data = (await qboGet(
    realmId,
    accessToken,
    `/query?query=${encodeURIComponent("SELECT * FROM Account MAXRESULTS 300")}`,
  )) as {
    QueryResponse?: {
      Account?: Array<{
        Id: string;
        Name: string;
        AccountType: string;
        AccountSubType: string;
        CurrentBalance: number;
        Active: boolean;
      }>;
    };
  };
  return (data.QueryResponse?.Account ?? []).map((a) => ({
    id: a.Id,
    name: a.Name,
    type: a.AccountType,
    subType: a.AccountSubType,
    balance: a.CurrentBalance ?? 0,
    active: a.Active,
  }));
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export type QboTransaction = {
  id: string;
  type: string;
  date: string;
  amount: number;
  memo: string;
};

export async function fetchRecentTransactions(
  realmId: string,
  accessToken: string,
): Promise<QboTransaction[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const q = `SELECT * FROM Purchase WHERE TxnDate >= '${since}' ORDERBY TxnDate DESC MAXRESULTS 150`;
  const data = (await qboGet(realmId, accessToken, `/query?query=${encodeURIComponent(q)}`)) as {
    QueryResponse?: {
      Purchase?: Array<{
        Id: string;
        TxnDate?: string;
        TotalAmt?: number;
        PrivateNote?: string;
      }>;
    };
  };
  return (data.QueryResponse?.Purchase ?? []).map((t) => ({
    id: t.Id,
    type: "Purchase",
    date: t.TxnDate ?? "",
    amount: t.TotalAmt ?? 0,
    memo: t.PrivateNote ?? "",
  }));
}

// ─── Data mapper ──────────────────────────────────────────────────────────────

export type QboMappedYear = {
  pnl: Pick<QboPnL, "revenue" | "netIncome" | "periodMonths">;
  from: string;
  to: string;
  label: string;
  basis: YearBasis;
};

/**
 * Maps QuickBooks P&L + balance sheet onto the financials vocabulary used by
 * `computeRatios`. The primary figures are month to date (`periodMonths = 1`).
 * The year range is stored beside them and is never labeled as that month.
 */
export function mapQboToFinancialInputs(
  pnl: QboPnL,
  bs: QboBalanceSheet,
  period?: { from: string; to: string; label: string },
  year?: QboMappedYear | null,
  operatingCashflow?: number | null,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  const dated = Boolean(period?.from && period?.to);
  const set = (k: string, v: number) => {
    if (!Number.isFinite(v)) return;
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
  if (operatingCashflow != null && Number.isFinite(operatingCashflow)) {
    set("operatingCashflow", operatingCashflow);
  }
  const setBs = (k: string, v: number) => {
    if (Number.isFinite(v) && v !== 0) out[k] = v;
  };
  setBs("totalAssets", bs.totalAssets);
  setBs("equity", bs.equity);
  setBs("receivables", bs.receivables);
  setBs("inventory", bs.inventory);
  setBs("payables", bs.payables);
  setBs("cash", bs.cash);
  if (Number.isFinite(pnl.periodMonths) && pnl.periodMonths >= 1 && pnl.periodMonths <= 12) {
    out[PERIOD_MONTHS_KEY] = String(pnl.periodMonths);
  }
  if (period?.from && period.to) {
    out.statementSource = "qbo";
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
