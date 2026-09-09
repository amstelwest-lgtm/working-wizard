/**
 * Per-tab Supabase auth isolation.
 * Run: pnpm test:tab-auth
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  adoptSharedAuthSession,
  supabaseAuthStorageKey,
  tabAuthStorage,
  withoutAuthBroadcast,
} from "../src/integrations/supabase/tab-auth";

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

assert(
  supabaseAuthStorageKey("https://abcdefgh.supabase.co") === "sb-abcdefgh-auth-token",
  "storage key matches supabase-js default",
);
assert(supabaseAuthStorageKey("not a url") === "sb-auth-token", "invalid URL falls back");

const local = new MemoryStorage();
const session = new MemoryStorage();
const g = globalThis as unknown as {
  window: { localStorage: Storage; sessionStorage: Storage };
};
const prevWindow = (globalThis as { window?: unknown }).window;
g.window = { localStorage: local, sessionStorage: session };

assert(tabAuthStorage() === session, "auth storage is this tab's sessionStorage");

const key = "sb-proj-auth-token";
local.setItem(key, '{"access_token":"shared"}');
local.setItem(`${key}-code-verifier`, "pkce");
adoptSharedAuthSession(key);
assert(session.getItem(key) === '{"access_token":"shared"}', "tab adopts shared session");
assert(session.getItem(`${key}-code-verifier`) === "pkce", "tab adopts PKCE verifier");
assert(local.getItem(key) === null, "shared session is removed so a second tab cannot inherit it");
assert(local.getItem(`${key}-code-verifier`) === null, "shared PKCE verifier is removed");

session.setItem(key, '{"access_token":"mine"}');
local.setItem(key, '{"access_token":"stale"}');
adoptSharedAuthSession(key);
assert(session.getItem(key) === '{"access_token":"mine"}', "does not overwrite this tab's session");
assert(local.getItem(key) === null, "stale shared copy is still cleared");

if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
else (globalThis as { window: unknown }).window = prevWindow;

class FakeChannel {
  static opened = 0;
  name: string;
  constructor(name: string) {
    this.name = name;
    FakeChannel.opened += 1;
  }
  addEventListener() {}
  postMessage() {}
  close() {}
}
const { createClient } = await import("@supabase/supabase-js");
const gBc = globalThis as { BroadcastChannel?: typeof BroadcastChannel };
const prevBc = gBc.BroadcastChannel;
gBc.BroadcastChannel = FakeChannel as unknown as typeof BroadcastChannel;
FakeChannel.opened = 0;
withoutAuthBroadcast(() =>
  createClient("https://abcdefgh.supabase.co", "anon-key", {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: new MemoryStorage(),
      storageKey: "sb-abcdefgh-auth-token",
    },
  }),
);
assert(FakeChannel.opened === 0, "supabase-js createClient must not open an auth BroadcastChannel");
new FakeChannel("after");
assert(FakeChannel.opened === 1, "BroadcastChannel is restored after createClient");
if (prevBc) gBc.BroadcastChannel = prevBc;
else delete gBc.BroadcastChannel;

const clientSrc = readFileSync(resolve("src/integrations/supabase/client.ts"), "utf8");
assert(clientSrc.includes("tabAuthStorage()"), "browser client persists auth in sessionStorage");
assert(
  clientSrc.includes("withoutAuthBroadcast"),
  "browser client does not open the auth BroadcastChannel",
);
assert(clientSrc.includes("adoptSharedAuthSession"), "one-time migrate from shared localStorage");
assert(
  !/storage:\s*typeof window !== 'undefined' \? localStorage/.test(clientSrc),
  "must not persist the session in shared localStorage",
);

const authSrc = readFileSync(resolve("src/hooks/use-auth.tsx"), "utf8");
assert(authSrc.includes('signOut({ scope: "local" })'), "tab sign-out must not revoke other tabs");

const callbackSrc = readFileSync(resolve("src/routes/auth_.callback.tsx"), "utf8");
assert(
  callbackSrc.includes("consumePendingOwnerInvite") && callbackSrc.includes("doAcceptOwnerInvite"),
  "Google callback still redeems a stashed owner invite",
);

console.log("tab-auth-test: ok");
