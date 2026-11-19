/**
 * Pure IM cloud OAuth state helpers (CSRF row in im_cloud_oauth_states).
 */
import type { ImAccessProvider } from "@/lib/im-access-settings";

export function sanitizeImCloudReturnPath(
  raw: string | null | undefined,
  clientId: string,
): string {
  const fallback = `/clients/${clientId}`;
  const value = (raw ?? "").trim();
  if (value === "/app") return "/app";
  if (value === fallback || value.startsWith(`${fallback}?`)) return value.split("?")[0] ?? fallback;
  if (value.startsWith("/clients/")) return value;
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