/**
 * Pure Xero connection state machine.
 * Used by server functions and unit tests — no I/O, no secrets.
 *
 * Stored `sync_status` stays compatible with the QBO column vocabulary
 * (`idle` | `syncing` | `error`). The richer `phase` is derived.
 */

export const XERO_SYNC_STATUSES = ["idle", "syncing", "error"] as const;
export type XeroSyncStatus = (typeof XERO_SYNC_STATUSES)[number];

export const XERO_CONNECTION_PHASES = [
  "disconnected",
  "connecting",
  "connected",
  "syncing",
  "error",
] as const;
export type XeroConnectionPhase = (typeof XERO_CONNECTION_PHASES)[number];

export type XeroConnectionEvent =
  | { type: "oauth_started" }
  | { type: "oauth_failed"; reason: string }
  | { type: "oauth_completed" }
  | { type: "sync_started" }
  | { type: "sync_succeeded" }
  | { type: "sync_failed"; error: string }
  | { type: "disconnected" };

export type XeroConnectionState = {
  phase: XeroConnectionPhase;
  syncStatus: XeroSyncStatus;
  syncError: string | null;
};

export function initialXeroConnectionState(): XeroConnectionState {
  return { phase: "disconnected", syncStatus: "idle", syncError: null };
}

/** Reconstruct the machine from a stored connection row (or none). */
export function xeroStateFromStored(row: {
  present: boolean;
  syncStatus?: string | null;
  syncError?: string | null;
}): XeroConnectionState {
  if (!row.present) return initialXeroConnectionState();
  const raw = row.syncStatus ?? "idle";
  if (raw === "syncing") {
    return { phase: "syncing", syncStatus: "syncing", syncError: null };
  }
  if (raw === "error") {
    return {
      phase: "error",
      syncStatus: "error",
      syncError: row.syncError ?? "Unknown sync error",
    };
  }
  return { phase: "connected", syncStatus: "idle", syncError: null };
}

export function reduceXeroConnection(
  state: XeroConnectionState,
  event: XeroConnectionEvent,
): XeroConnectionState {
  switch (event.type) {
    case "oauth_started":
      return { phase: "connecting", syncStatus: "idle", syncError: null };
    case "oauth_failed":
      return { phase: "disconnected", syncStatus: "idle", syncError: event.reason };
    case "oauth_completed":
      return { phase: "connected", syncStatus: "idle", syncError: null };
    case "sync_started":
      if (state.phase === "disconnected") return state;
      return { phase: "syncing", syncStatus: "syncing", syncError: null };
    case "sync_succeeded":
      if (state.phase === "disconnected") return state;
      return { phase: "connected", syncStatus: "idle", syncError: null };
    case "sync_failed":
      if (state.phase === "disconnected") return state;
      return { phase: "error", syncStatus: "error", syncError: event.error };
    case "disconnected":
      return initialXeroConnectionState();
    default:
      return state;
  }
}

/** Safe return path after OAuth — only owner board or this client's studio. */
export function sanitizeXeroReturnPath(
  raw: string | null | undefined,
  clientId: string,
): string {
  const fallback = `/clients/${clientId}`;
  const value = (raw ?? "").trim();
  if (value === "/app") return "/app";
  if (value === fallback) return fallback;
  return fallback;
}

export function xeroOauthStateIsFresh(createdAtIso: string, nowMs = Date.now()): boolean {
  const created = Date.parse(createdAtIso);
  if (!Number.isFinite(created)) return false;
  return nowMs - created < 10 * 60 * 1000;
}
