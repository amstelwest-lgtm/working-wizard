/**
 * QuickBooks Online API client — pure functions, no server-fn imports.
 * All token handling and report parsing lives here.
 * Only import this file from server-side code (server functions / API routes).
 */

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

export const QBO_REDIRECT_URI = () =>
  process.env.QBO_REDIRECT_URI ?? "";

const QBO_AUTH_ENDPOINT = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_SCOPE = "com.intuit.quickbooks.accounting";
const MINOR_VERSION = "70";

export const qboApiBase = () =>
  QBO_ENV() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

// ─── OAuth ───────────────────────────────────────────────────────────────────

export function buildQboAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: QBO_CLIENT_ID(),
    response_type: "code",
    scope: QBO_SCOPE,
    redirect_uri: QBO_REDIRECT_URI(),
    state,
  });
  return `${QBO_AUTH_ENDPOINT}?${params}`;
}

function basicCredentials() {
  return btoa(`${QBO_CLIENT_ID()}:${QBO_CLIENT_SECRET()}`);
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
    const t = await res.text();
    throw new Error(`QBO token exchange failed (${res.status}): ${t.slice(0, 300)}`);
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
    const t = await res.text();
    throw new Error(`QBO token refresh failed (${res.status}): ${t.slice(0, 300)}`);
  }
  return res.json() as Promise<TokenResponse>;
}

// ─── Authenticated API calls ──────────────────────────────────────────────────

export async function qboGet(
  realmId: string,
  accessToken: string,
  path: string,
): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${qboApiBase()}/v3/company/${realmId}${path}${sep}minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`QBO API ${path} → ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

// ─── Report row types ─────────────────────────────────────────────────────────

type ColData = { value: string; id?: string };

type ReportRow = {
  type?: string;
  group?: string;
  ColData?: ColData[];
  Header?: { ColData: ColData[] };
  Summary?: { ColData: ColData[] };
  Rows?: { Row?: ReportRow[] };
};

type ReportResponse = { Rows?: { Row?: ReportRow[] } };

/** Extract the numeric amount from a row — prefers Summary over ColData. */
function amount(row: ReportRow | undefined): number {
  if (!row) return 0;
  const cols = row.Summary?.ColData ?? row.ColData ?? [];
  // Col 0 = label, Col 1 = amount (for 2-column reports)
  const raw = cols.length >= 2 ? cols[1].value : (cols[0]?.value ?? "0");
  return parseFloat(raw) || 0;
}

/** Walk row tree and find the first row whose `group` matches. */
function findGroup(rows: ReportRow[], group: string): ReportRow | undefined {
  for (const r of rows) {
    if (r.group === group) return r;
    const nested = r.Rows?.Row;
    if (nested) {
      const found = findGroup(nested, group);
      if (found) return found;
    }
  }
}

/** Walk row tree and find the first row whose label (ColData[0]) contains `text`. */
function findLabel(rows: ReportRow[], text: string): ReportRow | undefined {
  const lc = text.toLowerCase();
  for (const r of rows) {
    const label = (
      r.ColData?.[0]?.value ??
      r.Header?.ColData?.[0]?.value ??
      r.Summary?.ColData?.[0]?.value ??
      ""
    ).toLowerCase();
    if (label.includes(lc)) return r;
    const nested = r.Rows?.Row;
    if (nested) {
      const found = findLabel(nested, text);
      if (found) return found;
    }
  }
}

// ─── P&L ─────────────────────────────────────────────────────────────────────

export type QboPnL = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  ebit: number;
  netIncome: number;
  ebitda: number;
};

export async function fetchPnL(
  realmId: string,
  accessToken: string,
): Promise<QboPnL> {
  const today = new Date();
  const start = `${today.getFullYear()}-01-01`;
  const end = today.toISOString().slice(0, 10);
  const data = (await qboGet(
    realmId,
    accessToken,
    `/reports/ProfitAndLoss?start_date=${start}&end_date=${end}&accounting_method=Accrual`,
  )) as ReportResponse;

  const rows = data.Rows?.Row ?? [];
  const revenue = amount(findGroup(rows, "Income"));
  const cogs = Math.abs(amount(findGroup(rows, "COGS")));
  const grossProfit = revenue - cogs;
  const opex = Math.abs(amount(findGroup(rows, "Expenses")));
  const ebit = grossProfit - opex;
  const netIncomeRow = findGroup(rows, "NetIncome") ?? findLabel(rows, "Net income");
  const netIncome = amount(netIncomeRow);
  const depRow = findLabel(rows, "depreciation") ?? findLabel(rows, "amortization");
  const da = depRow ? Math.abs(amount(depRow)) : 0;

  return { revenue, cogs, grossProfit, operatingExpenses: opex, ebit, netIncome, ebitda: ebit + da };
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

export async function fetchBalanceSheet(
  realmId: string,
  accessToken: string,
): Promise<QboBalanceSheet> {
  const end = new Date().toISOString().slice(0, 10);
  const data = (await qboGet(
    realmId,
    accessToken,
    `/reports/BalanceSheet?date=${end}&accounting_method=Accrual`,
  )) as ReportResponse;

  const rows = data.Rows?.Row ?? [];
  return {
    totalAssets: amount(findGroup(rows, "Assets")),
    totalLiabilities: amount(findGroup(rows, "Liabilities")),
    equity: amount(findGroup(rows, "Equity")),
    receivables: Math.abs(amount(findLabel(rows, "accounts receivable"))),
    inventory: Math.abs(amount(findLabel(rows, "inventory"))),
    payables: Math.abs(amount(findLabel(rows, "accounts payable"))),
    cash: Math.abs(
      amount(
        findLabel(rows, "cash and cash equivalent") ?? findLabel(rows, "cash"),
      ),
    ),
  };
}

// ─── Cash Flow ────────────────────────────────────────────────────────────────

export type QboCashFlow = {
  operatingCashflow: number;
  investingCashflow: number;
  financingCashflow: number;
};

export async function fetchCashFlow(
  realmId: string,
  accessToken: string,
): Promise<QboCashFlow> {
  const today = new Date();
  const start = `${today.getFullYear()}-01-01`;
  const end = today.toISOString().slice(0, 10);
  const data = (await qboGet(
    realmId,
    accessToken,
    `/reports/CashFlow?start_date=${start}&end_date=${end}`,
  )) as ReportResponse;

  const rows = data.Rows?.Row ?? [];
  const opRow =
    findGroup(rows, "Operating") ?? findLabel(rows, "operating activities");
  const invRow =
    findGroup(rows, "Investing") ?? findLabel(rows, "investing activities");
  const finRow =
    findGroup(rows, "Financing") ?? findLabel(rows, "financing activities");

  return {
    operatingCashflow: amount(opRow?.Summary ? opRow : { Summary: opRow?.Summary }),
    investingCashflow: amount(invRow?.Summary ? invRow : { Summary: invRow?.Summary }),
    financingCashflow: amount(finRow?.Summary ? finRow : { Summary: finRow?.Summary }),
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
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const q = `SELECT * FROM Purchase WHERE TxnDate >= '${since}' ORDERBY TxnDate DESC MAXRESULTS 150`;
  const data = (await qboGet(
    realmId,
    accessToken,
    `/query?query=${encodeURIComponent(q)}`,
  )) as {
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

/**
 * Maps QBO report data to the Milōn Financial Inputs schema.
 * Returns numeric values; caller must convert to strings for the ratio form.
 */
export function mapToFinancialInputs(
  pnl: QboPnL,
  bs: QboBalanceSheet,
  cf: QboCashFlow,
): Record<string, number> {
  const out: Record<string, number> = {};
  const set = (k: string, v: number) => {
    if (isFinite(v) && v !== 0) out[k] = v;
  };
  set("revenue", pnl.revenue);
  set("cogs", pnl.cogs);
  set("ebit", pnl.ebit);
  set("ebt", pnl.ebit); // EBT ≈ EBIT when interest is small
  set("netIncome", pnl.netIncome);
  set("ebitda", pnl.ebitda);
  set("totalAssets", bs.totalAssets);
  set("equity", bs.equity);
  set("receivables", bs.receivables);
  set("inventory", bs.inventory);
  set("payables", bs.payables);
  set("operatingCashflow", cf.operatingCashflow);
  return out;
}
