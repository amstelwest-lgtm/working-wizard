/**
 * First-call auth for edge functions.
 * A cold getUser() network or 5xx failure used to come back as 401 Unauthorised.
 * Retry once, or accept a locally verified getClaims() result when supabase-js
 * provides it. 503 auth_unavailable is transient. 401 is a bad or missing token.
 */

export const AUTH_UNAVAILABLE_CODE = "auth_unavailable";

export type EdgeAuthUser = { id: string; email?: string };

export type EdgeAuthSuccess = { ok: true; user: EdgeAuthUser };

export type EdgeAuthFailure = {
  ok: false;
  status: 401 | 503;
  body: { error: string; code?: typeof AUTH_UNAVAILABLE_CODE };
};

export type EdgeAuthResult = EdgeAuthSuccess | EdgeAuthFailure;

export type EdgeAuthApi = {
  getUser: (jwt?: string) => Promise<{
    data: { user: { id?: string | null; email?: string | null } | null } | null;
    error: unknown;
  }>;
  getClaims?: (jwt?: string) => Promise<{
    data: { claims?: Record<string, unknown> | null } | null;
    error: unknown;
  }>;
};

const UNAUTHORISED: EdgeAuthFailure = {
  ok: false,
  status: 401,
  body: { error: "Unauthorised" },
};

const UNAVAILABLE: EdgeAuthFailure = {
  ok: false,
  status: 503,
  body: {
    error: "Auth is temporarily unavailable. Try again.",
    code: AUTH_UNAVAILABLE_CODE,
  },
};

function errorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof error === "object") {
    const record = error as { name?: unknown; message?: unknown; code?: unknown };
    return [record.name, record.message, record.code].filter((part) => typeof part === "string").join(" ");
  }
  return "";
}

function httpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

/** Network failures and 5xx from the Auth API. A 401 JWT error is not transient. */
export function isTransientAuthFailure(error: unknown): boolean {
  if (!error) return false;
  const status = httpStatus(error);
  if (status != null && status >= 500) return true;
  if (status === 0) return true;
  if (error instanceof TypeError) return true;
  const text = errorText(error);
  if (/AuthRetryableFetchError/i.test(text)) return true;
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|econnreset|econnrefused|etimedout|timed out|timeout|socket hang up|temporarily unavailable|bad gateway|gateway timeout/i.test(
    text,
  );
}

function userFromRecord(user: { id?: string | null; email?: string | null } | null | undefined): EdgeAuthUser | null {
  const id = user?.id;
  if (typeof id !== "string" || !id) return null;
  const email = typeof user?.email === "string" && user.email ? user.email : undefined;
  return email ? { id, email } : { id };
}

type Read =
  | { kind: "user"; user: EdgeAuthUser }
  | { kind: "transient" }
  | { kind: "invalid" };

async function readGetUser(auth: EdgeAuthApi, token: string): Promise<Read> {
  try {
    const { data, error } = await auth.getUser(token);
    const user = userFromRecord(data?.user);
    if (user) return { kind: "user", user };
    if (error && isTransientAuthFailure(error)) return { kind: "transient" };
    return { kind: "invalid" };
  } catch {
    return { kind: "transient" };
  }
}

async function readClaims(auth: EdgeAuthApi, token: string): Promise<Read | { kind: "skip" }> {
  if (typeof auth.getClaims !== "function") return { kind: "skip" };
  try {
    const { data, error } = await auth.getClaims(token);
    const claims = data?.claims;
    const sub = claims && typeof claims.sub === "string" ? claims.sub : "";
    if (sub) {
      const email = claims && typeof claims.email === "string" ? claims.email : undefined;
      return { kind: "user", user: email ? { id: sub, email } : { id: sub } };
    }
    if (error && isTransientAuthFailure(error)) return { kind: "transient" };
    return { kind: "invalid" };
  } catch (error) {
    if (isTransientAuthFailure(error)) return { kind: "transient" };
    return { kind: "skip" };
  }
}

export async function authenticateEdgeUser(input: {
  token: string;
  auth: EdgeAuthApi;
}): Promise<EdgeAuthResult> {
  const token = input.token.trim();
  if (!token) return UNAUTHORISED;

  const first = await readGetUser(input.auth, token);
  if (first.kind === "user") return { ok: true, user: first.user };
  if (first.kind === "invalid") return UNAUTHORISED;

  const claims = await readClaims(input.auth, token);
  if (claims.kind === "user") return { ok: true, user: claims.user };
  if (claims.kind === "invalid") return UNAUTHORISED;

  const second = await readGetUser(input.auth, token);
  if (second.kind === "user") return { ok: true, user: second.user };
  if (second.kind === "transient") return UNAVAILABLE;
  return UNAUTHORISED;
}
