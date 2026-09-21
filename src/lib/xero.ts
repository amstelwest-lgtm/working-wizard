/**
 * Xero Accounting API client — pure helpers + fetch wrappers.
 * Token handling and report parsing live here.
 * Only import this file from server-side code (server functions / API routes).
 *
 * Never log access_token, refresh_token, or client_secret.
 */

import { PERIOD_MONTHS_KEY } from "@/lib/ratios";

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
 * Phase 2 invoice / transaction pull. Off by default — statement-level sync
 * must not wait on invoice root-cause.
 */
export function xeroInvoiceSyncEnabled(): boolean {
  const raw = (process.env.XERO_SYNC_INVOICES ?? process.env.XERO_SYNC_TRANSACTIONS ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Default scopes for apps created after 2 March 2026 (granular reports).
 * Override with XERO_SCOPES (space-separated) if the Xero app still has the
 * legacy `accounting.reports.read` grant.
 */
export const XERO_DEFAULT_SCOPES = [
  "offline_access",
  "accounting.settings.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.banksummary.read",
] as const;

export const XERO_INVOICE_SCOPE = "accounting.invoices.read";

export function xeroScopes(): string {
  const override = (process.env.XERO_SCOPES ?? "").trim();
  if (override) return override;
  const base = [...XERO_DEFAULT_SCOPES];
  if (xeroInvoiceSyncEnabled() && !base.includes(XERO_INVOICE_SCOPE)) {
    base.push(XERO_INVOICE_SCOPE);
  }
  return base.join(" ");
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

/** Amount from a 2-column row — col 0 is label, last numeric cell is the figure. */
export function xeroRowAmount(row: XeroReportRow | undefined): number {
  if (!row) return 0;
  const cells = row.Cells ?? [];
  for (let i = cells.length - 1; i >= 0; i--) {
    const v = cells[i]?.Value ?? "";
    if (v === "" || v == null) continue;
    if (!/[0-9]/.test(String(v))) continue;
    return parseAmount(String(v));
  }
  return 0;
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

function sectionTotal(section: XeroReportRow | undefined): number {
  if (!section) return 0;
  const summary =
    (section.Rows ?? []).find((r) => (r.RowType ?? "").toLowerCase() === "summaryrow") ??
    findRowByLabel(section.Rows ?? [], "total");
  if (summary) return xeroRowAmount(summary);
  // Fall back to summing leaf rows (skip nested summaries already counted).
  let sum = 0;
  for (const r of section.Rows ?? []) {
    if ((r.RowType ?? "").toLowerCase() === "row") sum += xeroRowAmount(r);
  }
  return sum;
}

function absAmount(row: XeroReportRow | undefined): number {
  return Math.abs(xeroRowAmount(row));
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
): XeroPnL {
  const report = firstXeroReport(json);
  const rows = report?.Rows ?? [];

  const incomeSection = findSection(rows, "income", "revenue");
  const cogsSection = findSection(rows, "cost of sales", "cost of goods");
  const opexSection = findSection(rows, "operating expense", "less operating");

  const revenue =
    absAmount(findRowByLabel(rows, "total income", "total revenue")) ||
    Math.abs(sectionTotal(incomeSection));
  const cogs =
    absAmount(findRowByLabel(rows, "total cost of sales", "total cost of goods")) ||
    Math.abs(sectionTotal(cogsSection));
  const grossProfitRow = findRowByLabel(rows, "gross profit");
  const grossProfit = grossProfitRow ? xeroRowAmount(grossProfitRow) : revenue - cogs;

  const opex =
    absAmount(findRowByLabel(rows, "total operating expense", "total expenses")) ||
    Math.abs(sectionTotal(opexSection));

  const depRow =
    findRowByLabel(rows, "depreciation") ?? findRowByLabel(rows, "amortisation", "amortization");
  const depreciation = depRow ? Math.abs(xeroRowAmount(depRow)) : 0;

  const netRow =
    findRowByLabel(rows, "net profit") ??
    findRowByLabel(rows, "net income") ??
    findRowByLabel(rows, "profit for the period") ??
    findRowByLabel(rows, "surplus");
  const netIncome = netRow ? xeroRowAmount(netRow) : grossProfit - opex;

  const taxRow = findRowByLabel(rows, "income tax", "tax expense");
  const interestRow = findRowByLabel(rows, "interest expense", "interest paid");
  const tax = taxRow ? Math.abs(xeroRowAmount(taxRow)) : 0;
  const interest = interestRow ? Math.abs(xeroRowAmount(interestRow)) : 0;

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

export async function fetchXeroProfitAndLoss(
  tenantId: string,
  accessToken: string,
  range = ytdRange(),
): Promise<XeroPnL> {
  const data = await xeroGet(
    tenantId,
    accessToken,
    `/Reports/ProfitAndLoss?fromDate=${range.from}&toDate=${range.to}`,
  );
  return parseXeroProfitAndLoss(data, range.periodMonths);
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
};

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
  const cash = absAmount(
    findRowByLabel(rows, "bank", "cash and cash equivalent", "cash at bank", "bank accounts"),
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

export async function fetchXeroBalanceSheet(
  tenantId: string,
  accessToken: string,
  date = new Date().toISOString().slice(0, 10),
): Promise<XeroBalanceSheet> {
  const data = await xeroGet(tenantId, accessToken, `/Reports/BalanceSheet?date=${date}`);
  return parseXeroBalanceSheet(data);
}

// ─── Bank summary (cash) ──────────────────────────────────────────────────────

export type XeroBankSummary = {
  closingCash: number;
  openingCash: number;
  accounts: Array<{ name: string; closing: number }>;
};

export function parseXeroBankSummary(json: unknown): XeroBankSummary {
  const report = firstXeroReport(json);
  const rows = report?.Rows ?? [];
  const accounts: Array<{ name: string; closing: number }> = [];

  walkRows(rows, (r) => {
    if ((r.RowType ?? "").toLowerCase() !== "section") return;
    const name = (r.Title ?? "").trim();
    if (!name) return;
    const closing = findRowByLabel(r.Rows ?? [], "closing balance", "closing");
    if (closing) accounts.push({ name, closing: xeroRowAmount(closing) });
  });

  const totalClosing =
    xeroRowAmount(findRowByLabel(rows, "total closing", "total bank")) ||
    accounts.reduce((s, a) => s + a.closing, 0);
  const totalOpening =
    xeroRowAmount(findRowByLabel(rows, "total opening")) ||
    accounts.reduce((s, a) => {
      const section = findSection(rows, a.name.toLowerCase());
      return s + xeroRowAmount(findRowByLabel(section?.Rows ?? [], "opening balance", "opening"));
    }, 0);

  return {
    closingCash: totalClosing,
    openingCash: totalOpening,
    accounts,
  };
}

export async function fetchXeroBankSummary(
  tenantId: string,
  accessToken: string,
  range = ytdRange(),
): Promise<XeroBankSummary> {
  const data = await xeroGet(
    tenantId,
    accessToken,
    `/Reports/BankSummary?fromDate=${range.from}&toDate=${range.to}`,
  );
  return parseXeroBankSummary(data);
}

// ─── Phase 2 invoices (flagged) ───────────────────────────────────────────────

export type XeroInvoiceStub = {
  invoiceID: string;
  type: string;
  status: string;
  total: number;
  date: string;
};

export function parseXeroInvoices(json: unknown): XeroInvoiceStub[] {
  if (!json || typeof json !== "object") return [];
  const list = (json as { Invoices?: unknown }).Invoices;
  if (!Array.isArray(list)) return [];
  const out: XeroInvoiceStub[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    out.push({
      invoiceID: typeof o.InvoiceID === "string" ? o.InvoiceID : "",
      type: typeof o.Type === "string" ? o.Type : "",
      status: typeof o.Status === "string" ? o.Status : "",
      total: typeof o.Total === "number" ? o.Total : parseFloat(String(o.Total ?? 0)) || 0,
      date: typeof o.DateString === "string" ? o.DateString : String(o.Date ?? ""),
    });
  }
  return out;
}

export async function fetchXeroInvoices(
  tenantId: string,
  accessToken: string,
): Promise<XeroInvoiceStub[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const data = await xeroGet(
    tenantId,
    accessToken,
    `/Invoices?where=${encodeURIComponent(`Date >= DateTime(${since.slice(0, 4)}, ${Number(since.slice(5, 7))}, ${Number(since.slice(8, 10))})`)}&page=1`,
  );
  return parseXeroInvoices(data);
}

// ─── Data mapper ──────────────────────────────────────────────────────────────

/**
 * Maps Xero report totals onto the Milōn financials vocabulary used by
 * `computeRatios` / health score. Statement-level only — no invoice root-cause.
 *
 * `operatingCashflow` is left unset: Xero's Reports API has no cash-flow
 * statement. Bank closing cash is mapped to `cash` for forecast seeding.
 */
export function mapXeroToFinancialInputs(
  pnl: XeroPnL,
  bs: XeroBalanceSheet,
  bank?: XeroBankSummary | null,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  const set = (k: string, v: number) => {
    if (Number.isFinite(v) && v !== 0) out[k] = v;
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
  const cash = bank?.closingCash || bs.cash;
  set("cash", cash);
  if (Number.isFinite(pnl.periodMonths) && pnl.periodMonths >= 1 && pnl.periodMonths <= 12) {
    out[PERIOD_MONTHS_KEY] = String(pnl.periodMonths);
  }
  return out;
}
