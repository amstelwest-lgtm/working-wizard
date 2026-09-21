/**
 * Xero connection state machine — no I/O, no live Xero calls.
 * Run: pnpm test:xero-state
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  initialXeroConnectionState,
  reduceXeroConnection,
  sanitizeXeroReturnPath,
  xeroOauthStateIsFresh,
  xeroStateFromStored,
} from "../src/lib/xero-state";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const clientId = "11111111-1111-1111-1111-111111111111";

let s = initialXeroConnectionState();
assert(s.phase === "disconnected", "initial disconnected");
assert(s.syncStatus === "idle", "initial idle");

s = reduceXeroConnection(s, { type: "oauth_started" });
assert(s.phase === "connecting", "oauth_started → connecting");

s = reduceXeroConnection(s, { type: "oauth_completed" });
assert(s.phase === "connected" && s.syncStatus === "idle", "oauth_completed → connected");

s = reduceXeroConnection(s, { type: "sync_started" });
assert(s.phase === "syncing" && s.syncStatus === "syncing", "sync_started → syncing");

s = reduceXeroConnection(s, { type: "sync_succeeded" });
assert(s.phase === "connected" && s.syncError === null, "sync_succeeded → connected");

s = reduceXeroConnection(s, { type: "sync_started" });
s = reduceXeroConnection(s, { type: "sync_failed", error: "Xero API /Reports/ProfitAndLoss → 429" });
assert(s.phase === "error" && s.syncStatus === "error", "sync_failed → error");
assert(s.syncError?.includes("429"), "error message kept");

s = reduceXeroConnection(s, { type: "disconnected" });
assert(s.phase === "disconnected" && s.syncError === null, "disconnect clears error");

const denied = reduceXeroConnection(initialXeroConnectionState(), {
  type: "oauth_failed",
  reason: "access_denied",
});
assert(denied.phase === "disconnected", "oauth_failed stays disconnected");
assert(denied.syncError === "access_denied", "oauth_failed records reason");

const lonely = reduceXeroConnection(initialXeroConnectionState(), { type: "sync_started" });
assert(lonely.phase === "disconnected", "cannot sync before connect");

assert(xeroStateFromStored({ present: false }).phase === "disconnected", "no row");
assert(xeroStateFromStored({ present: true, syncStatus: "idle" }).phase === "connected", "idle row");
assert(
  xeroStateFromStored({ present: true, syncStatus: "syncing" }).phase === "syncing",
  "syncing row",
);
assert(
  xeroStateFromStored({ present: true, syncStatus: "error", syncError: "boom" }).syncError ===
    "boom",
  "error row",
);

assert(sanitizeXeroReturnPath("/app", clientId) === "/app", "owner return");
assert(
  sanitizeXeroReturnPath(`/clients/${clientId}`, clientId) === `/clients/${clientId}`,
  "studio return",
);
assert(sanitizeXeroReturnPath("https://evil.test", clientId) === `/clients/${clientId}`, "reject open redirect");
assert(sanitizeXeroReturnPath("/clients/not-this-one", clientId) === `/clients/${clientId}`, "reject other client");
assert(sanitizeXeroReturnPath(undefined, clientId) === `/clients/${clientId}`, "default studio");

const now = Date.parse("2026-09-21T12:00:00Z");
assert(xeroOauthStateIsFresh(new Date(now - 2 * 60 * 1000).toISOString(), now), "2 min is fresh");
assert(!xeroOauthStateIsFresh(new Date(now - 11 * 60 * 1000).toISOString(), now), "11 min is stale");
assert(!xeroOauthStateIsFresh("not-a-date", now), "bad date is stale");

const cb = readFileSync(resolve("src/routes/api/xero/callback.ts"), "utf8");
assert(cb.includes("xeroOauthStateIsFresh"), "callback enforces 10-minute state TTL");
assert(cb.includes("sanitizeXeroReturnPath"), "callback sanitizes return path");
assert(cb.includes("fetchXeroConnections"), "callback loads tenant via connections");
assert(!cb.includes("console.log"), "callback does not log loosely");

const mig = readFileSync(resolve("supabase/migrations/20260921120000_xero_tables.sql"), "utf8");
assert(mig.includes("CREATE TABLE IF NOT EXISTS public.xero_connections"), "connections table");
assert(mig.includes("CREATE TABLE IF NOT EXISTS public.xero_sync_data"), "sync cache table");
assert(mig.includes("ENABLE ROW LEVEL SECURITY"), "RLS on");
assert(!/CREATE POLICY/i.test(mig), "deny-all like QBO — no public policies");

console.log("xero-state-test: ok");
