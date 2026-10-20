/**
 * Two tabs refreshing one token more than 10s apart must stay signed in.
 * A null auth event must not send /clients to /auth.
 * AQA 1020E: signup, then signed out with no click while 2–3 tabs were open.
 * Run: pnpm test:session-refresh-bounce
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decideAuthStateChange,
  resolveConfirmedSignOut,
  shouldRedirectToAuth,
} from "../src/lib/auth-session-guard.ts";
import {
  createRefreshCoordinator,
  type RefreshBus,
  type RefreshMsg,
} from "../src/integrations/supabase/refresh-flight.ts";
import { REFRESH_TOKEN_REUSE_INTERVAL_MS } from "../src/integrations/supabase/tab-auth.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

function createHub() {
  const subs = new Set<(msg: RefreshMsg, from: string) => void>();
  return {
    busFor(tabId: string): RefreshBus {
      return {
        post(msg) {
          for (const fn of [...subs]) fn(msg, tabId);
        },
        subscribe(fn) {
          const handler = (msg: RefreshMsg, from: string) => {
            if (from !== tabId) fn(msg);
          };
          subs.add(handler);
          return () => subs.delete(handler);
        },
      };
    },
  };
}

const successor = {
  access_token: "new-access",
  refresh_token: "new-refresh",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: "user-1" },
};

let clock = 1_700_000_000_000;
const storage = new MemoryStorage();
const hub = createHub();
let fetches = 0;
const fetchImpl = async () => {
  fetches += 1;
  return new Response(JSON.stringify(successor), { status: 200 });
};
const localLock = async <T>(_name: string, fn: () => Promise<T>) => fn();
const tab = (tabId: string) =>
  createRefreshCoordinator({
    tabId,
    bus: hub.busFor(tabId),
    storage,
    now: () => clock,
    claimWindowMs: 20,
    followWaitMs: 300,
    lock: localLock,
  });

const first = await tab("tab-a").refresh("shared-refresh-token", fetchImpl);
const firstBody = (await first.json()) as { refresh_token: string; user: { id: string } };
assert(first.ok && firstBody.refresh_token === "new-refresh", "the first tab receives the refreshed session");
assert(fetches === 1, "the first tab is the only network refresh");

clock += REFRESH_TOKEN_REUSE_INTERVAL_MS + 1_000;
const second = await tab("tab-b").refresh("shared-refresh-token", fetchImpl);
const secondBody = (await second.json()) as { refresh_token: string; user: { id: string } };
assert(fetches === 1, "a second tab more than 10s later does not refresh the same token");
assert(secondBody.user.id === "user-1", "the second tab stays on the same user");
assert(
  shouldRedirectToAuth({ loading: false, hasUser: true, restoreFailed: false }) === false,
  "a kept session does not navigate to /auth",
);

fetches = 0;
const shared = new MemoryStorage();
const raceHub = createHub();
const raceFetch = async () => {
  fetches += 1;
  return new Response(JSON.stringify(successor), { status: 200 });
};
const racer = (tabId: string) =>
  createRefreshCoordinator({
    tabId,
    bus: raceHub.busFor(tabId),
    storage: shared,
    now: () => clock,
    claimWindowMs: 20,
    followWaitMs: 300,
    lock: localLock,
  });
await Promise.all([
  racer("tab-a").refresh("race-token", raceFetch),
  racer("tab-b").refresh("race-token", raceFetch),
]);
assert(fetches === 1, "two tabs that refresh together still post one grant");

assert(decideAuthStateChange("INITIAL_SESSION", null) === "keep", "a null initial session does not clear the user");
assert(
  decideAuthStateChange("TOKEN_REFRESHED", null) === "keep",
  "a null refresh event does not clear the user",
);
assert(
  decideAuthStateChange("SIGNED_OUT", null) === "confirm-signed-out",
  "SIGNED_OUT is confirmed with a getSession retry",
);
assert(
  decideAuthStateChange("TOKEN_REFRESHED", { user: { id: "user-1" } }) === "set",
  "a refreshed session is applied",
);
assert(
  resolveConfirmedSignOut({ hadSession: true, intentional: false, retryHasUser: true }) === "keep",
  "a retry that still has a session keeps the user",
);
assert(
  resolveConfirmedSignOut({ hadSession: true, intentional: false, retryHasUser: false }) === "panel",
  "a confirmed loss shows the restore panel",
);
assert(
  shouldRedirectToAuth({ loading: false, hasUser: false, restoreFailed: true }) === false,
  "the restore panel does not navigate to /auth",
);
assert(
  resolveConfirmedSignOut({ hadSession: true, intentional: true, retryHasUser: false }) === "signed-out",
  "a deliberate sign-out still ends the session",
);

const read = (path: string) => readFileSync(resolve(path), "utf8");
const auth = read("src/hooks/use-auth.tsx");
const gate = read("src/routes/_authenticated.gate.tsx");
const app = read("src/routes/app.tsx");
const board = read("src/components/practice-board.tsx");
const client = read("src/integrations/supabase/client.ts");
assert(auth.includes("decideAuthStateChange"), "use-auth filters null sessions");
assert(!auth.includes("onAuthStateChange((_event, s)"), "use-auth does not apply every null session");
assert(auth.includes("SessionRestorePanel"), "a lost session still shows the restore panel");
assert(gate.includes("shouldRedirectToAuth"), "the accountant shell does not redirect while the panel is up");
assert(app.includes("shouldRedirectToAuth"), "the owner shell uses the same guard");
assert(board.includes("restoreFailed"), "the practice board does not leave a lost session");
assert(client.includes("coordinatedAuthFetch"), "refresh grants go through the single-tab coordinator");

console.log("session-refresh-bounce-test: ok");
