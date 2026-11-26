/**
 * Sage Business Cloud Accounting (South Africa / Sage One) — connect only.
 *
 * API 2.0.0 uses Basic auth (email + password) and the app API key as the
 * `apikey` query parameter. There is no OAuth redirect.
 *
 * Statement populate (P&L, balance sheet, ratios) is Eng1. This module
 * validates a login and encrypts the password for storage. It does not map
 * figures into the client book.
 *
 * Never log the password, password_enc, or SAGE_SA_API_KEY.
 */

import { emptyLedgerSyncError, ledgerSyncReportIsEmpty, ledgerSyncWouldWipe } from "@/lib/ledger-sync-financials";

import { SAGE_SA_LIVE_API_BASE, sageApiBase } from "@/lib/sage-config";

/** Live host. The host actually called is sageApiBase() (SAGE_SA_BASE_URL). */
export const SAGE_SA_API_BASE = SAGE_SA_LIVE_API_BASE;

/** Shown when Sync runs before Eng1 maps a statement. Figures stay put. */
export const SAGE_EMPTY_SYNC_MESSAGE =
  "Sage is connected, but no statement has been synced. Overview figures were left unchanged.";

/** A live Sage company whose statements are all zero. Not a failed login. */
export const SAGE_EMPTY_COMPANY_MESSAGE = "Connected, no transactions yet";

export { sageApiBase, sageApiKey, sageCredentialsConfigured } from "@/lib/sage-config";

export function normalizeSageCompanyId(raw: string): string {
  return raw.trim();
}

export function sageCompanyIdIsValid(raw: string): boolean {
  return /^\d{1,18}$/.test(normalizeSageCompanyId(raw));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Basic auth header. The email is trimmed; the password is not. Unicode is UTF-8. */
export function sageBasicAuthorization(username: string, password: string): string {
  const token = bytesToBase64(new TextEncoder().encode(`${username.trim()}:${password}`));
  return `Basic ${token}`;
}

/**
 * Company read used to prove the login and the Company ID.
 * Does not request a profit and loss, balance sheet, or any other report.
 */
export function sageCompanyValidateUrl(companyId: string, apiKey: string): string {
  const url = new URL(
    `${sageApiBase()}/Company/Get/${encodeURIComponent(normalizeSageCompanyId(companyId))}`,
  );
  url.searchParams.set("apikey", apiKey.trim());
  url.searchParams.set("companyid", normalizeSageCompanyId(companyId));
  return url.toString();
}

/**
 * Companies this login can see. No company id is sent.
 * GET only. Nothing is posted to Sage.
 */
export function sageCompanyListUrl(apiKey: string): string {
  const url = new URL(`${sageApiBase()}/Company/Get`);
  url.searchParams.set("apikey", apiKey.trim());
  return url.toString();
}

export type SageCompanyProof = {
  companyId: string;
  companyName: string | null;
};

function readName(record: Record<string, unknown>): string | null {
  for (const key of ["Name", "CompanyName", "name"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readId(record: Record<string, unknown>): string | null {
  for (const key of ["ID", "Id", "CompanyId", "id"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function sageCompanyRecords(body: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  if (Array.isArray(body)) {
    for (const item of body) {
      if (item && typeof item === "object") records.push(item as Record<string, unknown>);
    }
    return records;
  }
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const results = obj.Results ?? obj.results;
    if (Array.isArray(results)) {
      for (const item of results) {
        if (item && typeof item === "object") records.push(item as Record<string, unknown>);
      }
      return records;
    }
    records.push(obj);
  }
  return records;
}

/** Pull a company object out of the shapes Company/Get returns. */
export function parseSageCompany(body: unknown, expectedCompanyId: string): SageCompanyProof | null {
  const expected = normalizeSageCompanyId(expectedCompanyId);
  for (const record of sageCompanyRecords(body)) {
    const id = readId(record);
    if (id && id !== expected) continue;
    if (!id && !readName(record)) continue;
    return { companyId: expected, companyName: readName(record) };
  }
  return null;
}

const SAGE_GUID_BODY =
  "\\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\}?";

/** Length, braces, GUID form, and surrounding whitespace. Never the key itself. */
function sageApiKeyShape(raw: string): string {
  const trimmed = raw.trim();
  const braced = trimmed.length >= 2 && trimmed.startsWith("{") && trimmed.endsWith("}");
  const core = braced ? trimmed.slice(1, -1) : trimmed;
  const guid =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(core);
  return `keyLen=${raw.length} braced=${braced} guid=${guid} whitespace=${raw !== trimmed}`;
}

function escapeForRedaction(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One line for a failed Company/Get: status, a short redacted body, and the
 * shape of the configured API key. The key, login, and Authorization stay out.
 */
async function warnSageCompanyGetFailure(
  res: Response,
  creds: { username: string; password: string; apiKey: string },
): Promise<void> {
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    raw = "";
  }
  const configured = process.env.SAGE_SA_API_KEY ?? "";
  const secrets = [
    configured,
    configured.trim(),
    creds.apiKey,
    creds.apiKey.trim(),
    creds.username,
    creds.password,
    sageBasicAuthorization(creds.username, creds.password),
  ];
  for (const secret of [...secrets]) {
    if (!secret) continue;
    try {
      const encoded = encodeURIComponent(secret);
      if (encoded !== secret) secrets.push(encoded);
    } catch {
      // Lone surrogates cannot be encoded. The raw secret is still removed.
    }
  }
  const unique = [...new Set(secrets.filter((secret) => secret.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  let body = raw;
  if (unique.length > 0) {
    body = body.replace(new RegExp(unique.map(escapeForRedaction).join("|"), "g"), "[redacted]");
  }
  body = body
    .replace(/apikey=[^&\s"'<>]+/gi, "apikey=[redacted]")
    .replace(/authorization:\s*\S+/gi, "authorization:[redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]")
    .replace(new RegExp(SAGE_GUID_BODY, "g"), "[redacted]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 200);
  console.warn(
    `[sage] Company/Get status=${res.status} body=${body} ${sageApiKeyShape(configured)}`,
  );
}

export type SageValidateResult =
  | { ok: true; company: SageCompanyProof }
  | {
      ok: false;
      reason: "not_configured" | "rejected" | "app_key" | "company_not_found" | "unreachable";
    };

/**
 * Confirm the email, password, and Company ID with Sage.
 * `fetchImpl` is injectable for tests. The API key is never put in the error.
 */
export async function validateSageLogin(
  input: { username: string; password: string; companyId: string; apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SageValidateResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) return { ok: false, reason: "not_configured" };
  const companyId = normalizeSageCompanyId(input.companyId);
  if (!sageCompanyIdIsValid(companyId)) return { ok: false, reason: "company_not_found" };

  let res: Response;
  try {
    res = await fetchImpl(sageCompanyValidateUrl(companyId, apiKey), {
      method: "GET",
      headers: {
        Authorization: sageBasicAuthorization(input.username, input.password),
        Accept: "application/json",
      },
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (!res.ok) {
    await warnSageCompanyGetFailure(res, input);
    if (res.status === 401) return { ok: false, reason: "rejected" };
    if (res.status === 403) return { ok: false, reason: "app_key" };
    if (res.status === 404) return { ok: false, reason: "company_not_found" };
    return { ok: false, reason: "unreachable" };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const company = parseSageCompany(body, companyId);
  if (!company) return { ok: false, reason: "company_not_found" };
  return { ok: true, company };
}

/** Every company in a Company/Get list. Records without a numeric id are skipped. */
export function parseSageCompanyList(body: unknown): SageCompanyProof[] {
  const seen = new Set<string>();
  const companies: SageCompanyProof[] = [];
  for (const record of sageCompanyRecords(body)) {
    const id = readId(record);
    if (!id || !sageCompanyIdIsValid(id) || seen.has(id)) continue;
    seen.add(id);
    companies.push({ companyId: id, companyName: readName(record) });
  }
  return companies;
}

export type SageCompanyListResult =
  | { ok: true; companies: SageCompanyProof[] }
  | { ok: false; reason: "not_configured" | "rejected" | "app_key" | "unreachable" };

/**
 * GET Company/Get with the login. Returns the companies that login can see.
 * Does not write to Sage. `fetchImpl` is injectable for tests.
 */
export async function listSageCompanies(
  input: { username: string; password: string; apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SageCompanyListResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) return { ok: false, reason: "not_configured" };

  let res: Response;
  try {
    res = await fetchImpl(sageCompanyListUrl(apiKey), {
      method: "GET",
      headers: {
        Authorization: sageBasicAuthorization(input.username, input.password),
        Accept: "application/json",
      },
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (!res.ok) {
    await warnSageCompanyGetFailure(res, input);
    if (res.status === 401) return { ok: false, reason: "rejected" };
    if (res.status === 403) return { ok: false, reason: "app_key" };
    return { ok: false, reason: "unreachable" };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  return { ok: true, companies: parseSageCompanyList(body) };
}

/** The company id to preselect. One company is selected; zero or many wait for a choice. */
export function initialSageCompanyId(companies: readonly { companyId: string }[]): string {
  if (companies.length !== 1) return "";
  return companies[0]?.companyId ?? "";
}

/** Shown when Company/Get succeeds and the login can see no companies. */
export const SAGE_NO_COMPANIES_MESSAGE = "This Sage login cannot see any companies.";

/** Shown when Sage cannot run. Never names an environment variable. */
export const SAGE_CONNECTION_UNAVAILABLE = "Sage connection not available yet";

/** Strip operator hints (SAGE_SA_API_KEY and the like) before a user sees the text. */
export function sagePublicError(message: string): string {
  return /SAGE_[A-Z0-9_]+/.test(message) ? SAGE_CONNECTION_UNAVAILABLE : message;
}

export function sageValidateError(reason: Exclude<SageValidateResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "not_configured":
    case "app_key":
      return SAGE_CONNECTION_UNAVAILABLE;
    case "rejected":
      return "Sage rejected that email or password. If your Sage login uses an authenticator code, add a separate Sage user without 2FA for Milōn.";
    case "company_not_found":
      return "Sage did not find that Company ID on this login.";
    case "unreachable":
      return "Sage could not be reached. Try again in a moment.";
  }
}

/**
 * Fields worth handing to the board. Eng1's sync returns `fields` with a
 * period and figures. The connect stub sets `populated: false` and empty
 * fields, which must not auto-populate Health.
 */
export function sageSyncPopulatedFields(result: {
  populated?: boolean;
  fields?: Record<string, string> | null;
} | null | undefined): Record<string, string> | null {
  if (!result || result.populated === false) return null;
  const fields = result.fields;
  if (!fields) return null;
  const hasFigure = ["revenue", "netIncome", "cash", "totalAssets", "equity", "periodStart", "periodEnd"].some(
    (key) => {
      const value = fields[key];
      return value != null && String(value).trim() !== "";
    },
  );
  return hasFigure ? fields : null;
}

export type SageConnectionInsert = {
  client_id: string;
  username: string;
  password_enc: string;
  company_id: string;
  company_name: string | null;
  connected_at: string;
  sync_status: "idle";
  sync_error: null;
  last_synced_at: null;
};

/** Row written after a successful validate. No token columns. */
export function sageConnectionInsert(input: {
  clientId: string;
  username: string;
  passwordEnc: string;
  company: SageCompanyProof;
  connectedAt: string;
}): SageConnectionInsert {
  return {
    client_id: input.clientId,
    username: input.username.trim(),
    password_enc: input.passwordEnc,
    company_id: input.company.companyId,
    company_name: input.company.companyName,
    connected_at: input.connectedAt,
    sync_status: "idle",
    sync_error: null,
    last_synced_at: null,
  };
}

export type SageSyncWriteDecision =
  | { write: false; error: string; neutral?: boolean }
  | { write: true };

/**
 * Empty-sync guard for Sage. No figures, or an all-zero dated report, must
 * not replace the live book or become a health score.
 * An all-zero dated report is a connected company with nothing posted yet:
 * leave the figures, and do not mark the connection as an error.
 * Eng1 calls this before applyLedgerSyncFinancials.
 */
export function sageSyncWriteDecision(
  fields: Record<string, unknown>,
  prev: unknown,
): SageSyncWriteDecision {
  const dated = Boolean(fields.periodStart && fields.periodEnd);
  if (dated && ledgerSyncReportIsEmpty(fields)) {
    return { write: false, error: SAGE_EMPTY_COMPANY_MESSAGE, neutral: true };
  }
  if (ledgerSyncReportIsEmpty(fields) || ledgerSyncWouldWipe(prev, fields)) {
    return { write: false, error: emptyLedgerSyncError("sage") };
  }
  return { write: true };
}
