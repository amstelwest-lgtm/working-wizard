/**
 * A new tab has empty sessionStorage. The signed-in token must already be in
 * localStorage, and the gate must not send /clients or /app to /auth first.
 * Run: pnpm test:new-tab-session
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shouldRedirectToAuth } from "../src/lib/auth-session-guard.ts";
import {
  createSharedAuthStorage,
  readStoredAuthSession,
  shareAuthToken,
} from "../src/lib/stored-auth-session.ts";

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

const key = "sb-proj-auth-token";
const openTab = JSON.stringify({
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_at: 1_800_000_000,
  user: { id: "user-1" },
});

const local = new MemoryStorage();
const session = new MemoryStorage();
session.setItem(key, openTab);
shareAuthToken(local, session, key);
assert(local.getItem(key) === openTab, "the open tab publishes its session to localStorage");
assert(session.getItem(key) === openTab, "the open tab keeps its own copy");

const newTabSession = new MemoryStorage();
const shared = createSharedAuthStorage(local, newTabSession);
assert(
  shared.getItem(key) === openTab,
  "a new tab reads the access token from localStorage with no refresh lock",
);
const seen = readStoredAuthSession(local, newTabSession);
assert(seen?.user?.id === "user-1", "the stored user is visible before getSession");

const newer = JSON.stringify({
  access_token: "access-2",
  refresh_token: "refresh-2",
  expires_at: 1_900_000_000,
  user: { id: "user-1" },
});
session.setItem(key, newer);
shareAuthToken(local, session, key);
assert(local.getItem(key) === newer, "a refreshed tab replaces the shared token");

local.setItem(`${key}-code-verifier`, "pkce");
shareAuthToken(local, session, key);
assert(session.getItem(`${key}-code-verifier`) === "pkce", "the PKCE verifier stays on this tab");
assert(local.getItem(`${key}-code-verifier`) === null, "the PKCE verifier is not shared");

const g = globalThis as unknown as { window?: { localStorage: Storage; sessionStorage: Storage } };
const prev = g.window;
g.window = { localStorage: local, sessionStorage: new MemoryStorage() };
assert(
  shouldRedirectToAuth({ loading: false, hasUser: false, restoreFailed: false }) === false,
  "a stored session blocks the /auth redirect before getSession resolves",
);
g.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() };
assert(
  shouldRedirectToAuth({ loading: false, hasUser: false, restoreFailed: false }) === true,
  "a visitor with no stored session still goes to /auth",
);
assert(
  shouldRedirectToAuth({ loading: false, hasUser: false, restoreFailed: true }) === false,
  "a real loss still shows the restore panel instead of redirecting",
);
if (prev === undefined) delete g.window;
else g.window = prev;

const tabAuth = readFileSync(resolve("src/integrations/supabase/tab-auth.ts"), "utf8");
const client = readFileSync(resolve("src/integrations/supabase/client.ts"), "utf8");
const auth = readFileSync(resolve("src/hooks/use-auth.tsx"), "utf8");
assert(client.includes("shareAuthSession"), "the client publishes the session before GoTrue reads it");
assert(tabAuth.includes("createSharedAuthStorage"), "GoTrue reads the shared token, not sessionStorage alone");
assert(!tabAuth.includes("shared copy is removed"), "the shared token is no longer deleted");
assert(auth.includes("useLayoutEffect"), "the stored user is applied before the gate effect");
assert(tabAuth.includes("coordinatedAuthFetch"), "refresh stays single-flight across tabs");

console.log("new-tab-session-test: ok");
