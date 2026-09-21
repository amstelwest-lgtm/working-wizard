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

/** Intuit error codes are short tokens. Anything else becomes a fixed reason. */
export function sanitizeQboOauthReason(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  if (/^[a-z0-9_]{1,40}$/.test(value)) return value;
  return "denied";
}
