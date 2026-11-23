/**
 * Pure IM cloud OAuth state helpers (CSRF row in im_cloud_oauth_states).
 */
import type { ImAccessProvider } from "@/lib/im-access-settings";

/** Only the bound client's /clients/<id> path. Other clients, /app, and off-site URLs fall back. */
export function sanitizeImCloudReturnPath(
  raw: string | null | undefined,
  clientId: string,
): string {
  const fallback = `/clients/${clientId}`;
  const value = (raw ?? "").trim();
  if (!value || !clientId) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return fallback;
  const bare = value.split("#")[0]?.split("?")[0] ?? "";
  let path = bare;
  try {
    path = decodeURIComponent(bare);
  } catch {
    return fallback;
  }
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return fallback;
  }
  if (path.split("/").some((part) => part === "." || part === "..")) return fallback;
  if (path === fallback || path.startsWith(`${fallback}/`)) return path;
  return fallback;
}

export function imCloudOauthStateIsFresh(createdAtIso: string, nowMs = Date.now()): boolean {
  const created = Date.parse(createdAtIso);
  if (!Number.isFinite(created)) return false;
  return nowMs - created < 10 * 60 * 1000;
}

export type ImCloudCallbackIssue =
  | "missing_code"
  | "missing_state"
  | "invalid_or_expired_state"
  | "oauth_disabled";

export function imCloudOauthCallbackIssue(input: {
  code: string | null;
  state: string | null;
  stateFound: boolean;
  stateFresh: boolean;
  sqlReady: boolean;
}): ImCloudCallbackIssue | null {
  if (!input.sqlReady) return "oauth_disabled";
  if (!input.code) return "missing_code";
  if (!input.state) return "missing_state";
  if (!input.stateFound || !input.stateFresh) return "invalid_or_expired_state";
  return null;
}

export function imCloudCallbackQueryKey(provider: ImAccessProvider): string {
  return provider === "google" ? "gdrive" : "onedrive";
}
