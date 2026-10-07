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

export const SAGE_SA_API_BASE = "https://accounting.sageone.co.za/api/2.0.0";

/** Shown when Sync runs before Eng1 maps a statement. Figures stay put. */
export const SAGE_EMPTY_SYNC_MESSAGE =
  "Sage is connected, but no statement has been synced. Overview figures were left unchanged.";

export function sageApiKey(): string {
  return process.env.SAGE_SA_API_KEY?.trim() ?? "";
}

export function sageCredentialsConfigured(): boolean {
  return sageApiKey().length > 0;
}

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

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Basic auth header. Unicode passwords are encoded as UTF-8, not Latin-1. */
export function sageBasicAuthorization(username: string, password: string): string {
  const token = bytesToBase64(new TextEncoder().encode(`${username}:${password}`));
  return `Basic ${token}`;
}

/**
 * Company read used to prove the login and the Company ID.
 * Does not request a profit and loss, balance sheet, or any other report.
 */
export function sageCompanyValidateUrl(companyId: string, apiKey: string): string {
  const url = new URL(
    `${SAGE_SA_API_BASE}/Company/Get/${encodeURIComponent(normalizeSageCompanyId(companyId))}`,
  );
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("companyid", normalizeSageCompanyId(companyId));
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

/** Pull a company object out of the shapes Company/Get returns. */
export function parseSageCompany(body: unknown, expectedCompanyId: string): SageCompanyProof | null {
  const expected = normalizeSageCompanyId(expectedCompanyId);
  const records: Record<string, unknown>[] = [];
  if (Array.isArray(body)) {
    for (const item of body) {
      if (item && typeof item === "object") records.push(item as Record<string, unknown>);
    }
  } else if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const results = obj.Results ?? obj.results;
    if (Array.isArray(results)) {
      for (const item of results) {
        if (item && typeof item === "object") records.push(item as Record<string, unknown>);
      }
    } else {
      records.push(obj);
    }
  }
  for (const record of records) {
    const id = readId(record);
    if (id && id !== expected) continue;
    if (!id && !readName(record)) continue;
    return { companyId: expected, companyName: readName(record) };
  }
  return null;
}

export type SageValidateResult =
  | { ok: true; company: SageCompanyProof }
  | { ok: false; reason: "not_configured" | "rejected" | "company_not_found" | "unreachable" };

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

  if (res.status === 401 || res.status === 403) return { ok: false, reason: "rejected" };
  if (res.status === 404) return { ok: false, reason: "company_not_found" };
  if (!res.ok) return { ok: false, reason: "unreachable" };

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

export function sageValidateError(reason: Exclude<SageValidateResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "not_configured":
      return "Sage Accounting is not switched on for this workspace yet.";
    case "rejected":
      return "Sage rejected that email or password.";
    case "company_not_found":
      return "Sage did not find that Company ID on this login.";
    case "unreachable":
      return "Sage could not be reached. Try again in a moment.";
  }
}

const PASSWORD_VERSION = "v1";

async function sagePasswordKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET?.trim() ?? "";
  if (!secret) {
    throw new Error("SESSION_SECRET is not set — refusing to store a Sage password.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`sage-sa:${secret}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-GCM ciphertext. The password is not stored in plaintext. */
export async function encryptSagePassword(plain: string): Promise<string> {
  const key = await sagePasswordKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  return `${PASSWORD_VERSION}.${bytesToBase64(iv)}.${bytesToBase64(cipher)}`;
}

/** Eng1 will decrypt this when a statement pull needs the stored login. */
export async function decryptSagePassword(stored: string): Promise<string> {
  const [version, ivPart, cipherPart] = stored.split(".");
  if (version !== PASSWORD_VERSION || !ivPart || !cipherPart) {
    throw new Error("Stored Sage password could not be read.");
  }
  const key = await sagePasswordKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivPart) },
    key,
    base64ToBytes(cipherPart),
  );
  return new TextDecoder().decode(plain);
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
  | { write: false; error: string }
  | { write: true };

/**
 * Empty-sync guard for Sage. No figures, or an all-zero dated report, must
 * not replace the live book or become a health score.
 * Eng1 calls this before applyLedgerSyncFinancials.
 */
export function sageSyncWriteDecision(
  fields: Record<string, unknown>,
  prev: unknown,
): SageSyncWriteDecision {
  if (ledgerSyncReportIsEmpty(fields) || ledgerSyncWouldWipe(prev, fields)) {
    return { write: false, error: emptyLedgerSyncError("sage") };
  }
  return { write: true };
}
