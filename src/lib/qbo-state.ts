/**
 * Pure QuickBooks OAuth helpers. No I/O, no secrets.
 */

/** Safe return path after OAuth — only the owner board or this client's studio. */
export function sanitizeQboReturnPath(raw: string | null | undefined, clientId: string): string {
  const fallback = `/clients/${clientId}`;
  const value = (raw ?? "").trim();
  if (value === "/app") return "/app";
  if (value === fallback) return fallback;
  return fallback;
}

export function qboOauthStateIsFresh(createdAtIso: string, nowMs = Date.now()): boolean {
  const created = Date.parse(createdAtIso);
  if (!Number.isFinite(created)) return false;
  return nowMs - created < 10 * 60 * 1000;
}

/**
 * Why the callback cannot finish, before token exchange.
 * A missing stored state is not a missing query parameter.
 */
export type QboCallbackIssue =
  | "missing_code"
  | "missing_state"
  | "missing_realm"
  | "invalid_or_expired_state";

export function qboOauthCallbackIssue(input: {
  code: string | null;
  state: string | null;
  realmId: string | null;
  stateFound: boolean;
}): QboCallbackIssue | null {
  if (!input.code) return "missing_code";
  if (!input.state) return "missing_state";
  if (!input.realmId) return "missing_realm";
  if (!input.stateFound) return "invalid_or_expired_state";
  return null;
}

/**
 * Intuit's callback query key is `realmId`. Some proxies and older docs
 * change the casing, and URLSearchParams is case-sensitive.
 */
export function readQboRealmId(params: { get(name: string): string | null }): string | null {
  const direct = params.get("realmId")?.trim() ?? "";
  if (direct) return direct;
  if (params instanceof URLSearchParams) {
    for (const [key, value] of params.entries()) {
      if (key !== "realmId" && key.toLowerCase() === "realmid") {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
    }
  }
  for (const name of ["realmID", "realmid"] as const) {
    const value = params.get(name)?.trim() ?? "";
    if (value) return value;
  }
  return null;
}

/** Intuit error codes are short tokens. Anything else becomes a fixed reason. */
export function sanitizeQboOauthReason(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  if (/^[a-z0-9_]{1,40}$/.test(value)) return value;
  return "denied";
}
