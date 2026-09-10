/**
 * Auth reliability regressions — Google owner invite (#138, f19e693) and
 * per-tab session isolation (#140, when merged).
 *
 * Run:  pnpm test:auth-reliability
 * CI:   included in pnpm test:ci
 *
 * Live smoke (manual, two real tabs): scripts/auth-reliability-smoke.md
 * DB-backed invite redeem: pnpm test:invited-member (not in CI)
 *
 * ── Per-tab spec helpers below mirror #140's src/integrations/supabase/tab-auth.ts
 * so unit tests pass on main before that file lands. When tab-auth.ts exists,
 * the same cases also run against the production module (must match spec).
 *
 * #140 callouts (production — not in this PR):
 *   • signOut({ scope: "local" }) in use-auth.tsx — intentional; global revoke
 *     would invalidate refresh tokens for every tab signed in as that email.
 *   • withoutAuthBroadcast() monkeypatch — hides BroadcastChannel only during
 *     createClient(); lives in tab-auth.ts, wired from client.ts. Fragile on
 *     supabase-js upgrades (pinned 2.74.0); no public broadcast:false in 2.74.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  googleOAuthRedirectTo,
  inferGoogleIntentFromRoles,
} from "../src/lib/google-auth";
import {
  ownerInviteFromCallbackSearch,
  pendingOwnerInviteCookieString,
  readPendingOwnerInviteCookie,
  resolvePendingOwnerInvite,
} from "../src/lib/invite-handoff";
import {
  PORTAL_FORCE_KEY,
  clearForcePortal,
  decideOwnerAppBounce,
  decidePostLoginPath,
  forcePortal,
  ownerBoardRole,
  peekForcePortal,
  summarizeRoles,
  type PortalRouteDecision,
} from "../src/lib/user-roles";

const SUPABASE_JS_VERSION = "2.74.0";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function skip(name: string, reason: string) {
  console.log(`SKIP  ${name}: ${reason}`);
}

function d(partial: Partial<PortalRouteDecision>): PortalRouteDecision {
  return {
    hasPracticeRole: false,
    hasClientRole: false,
    hasFirm: false,
    intent: null,
    force: null,
    practiceSignup: false,
    ...partial,
  };
}

/** Mirrors auth_.callback: pending owner invite always replace-navigates to /app. */
function googleCallbackLanding(hasPendingInvite: boolean, postLogin: "/app" | "/dashboard"): "/app" | "/dashboard" {
  return hasPendingInvite ? "/app" : postLogin;
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

// ── Per-tab spec (mirrors #140 tab-auth.ts — runs on main before that file lands) ──

function specSupabaseAuthStorageKey(supabaseUrl: string): string {
  try {
    const host = new URL(supabaseUrl).hostname;
    const ref = host.split(".")[0];
    if (ref) return `sb-${ref}-auth-token`;
  } catch {
    /* invalid URL */
  }
  return "sb-auth-token";
}

function specTabAuthStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function specMoveItem(from: Storage, to: Storage, key: string): void {
  const value = from.getItem(key);
  if (value == null) return;
  if (to.getItem(key) == null) to.setItem(key, value);
  from.removeItem(key);
}

function specAdoptSharedAuthSession(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    const local = window.localStorage;
    const session = window.sessionStorage;
    specMoveItem(local, session, storageKey);
    specMoveItem(local, session, `${storageKey}-code-verifier`);
  } catch {
    /* private mode / blocked storage */
  }
}

function specWithoutAuthBroadcast<T>(create: () => T): T {
  const g = globalThis as { BroadcastChannel?: typeof BroadcastChannel };
  const Original = g.BroadcastChannel;
  if (!Original) return create();
  try {
    g.BroadcastChannel = undefined;
    return create();
  } finally {
    g.BroadcastChannel = Original;
  }
}

type TabAuthModule = {
  supabaseAuthStorageKey: (url: string) => string;
  tabAuthStorage: () => Storage | undefined;
  adoptSharedAuthSession: (key: string) => void;
  withoutAuthBroadcast: <T>(create: () => T) => T;
};

async function runTabAuthUnitTests(label: string, mod: TabAuthModule) {
  assert(
    mod.supabaseAuthStorageKey("https://abcdefgh.supabase.co") === "sb-abcdefgh-auth-token",
    `${label}: storage key matches supabase-js default`,
  );
  assert(mod.supabaseAuthStorageKey("not a url") === "sb-auth-token", `${label}: invalid URL falls back`);

  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const g = globalThis as unknown as { window: { localStorage: Storage; sessionStorage: Storage } };
  const prevWindow = (globalThis as { window?: unknown }).window;
  g.window = { localStorage: local, sessionStorage: session };

  assert(mod.tabAuthStorage() === session, `${label}: auth storage is sessionStorage`);

  const key = "sb-proj-auth-token";
  local.setItem(key, '{"access_token":"shared"}');
  local.setItem(`${key}-code-verifier`, "pkce");
  mod.adoptSharedAuthSession(key);
  assert(session.getItem(key) === '{"access_token":"shared"}', `${label}: tab adopts shared session once`);
  assert(local.getItem(key) === null, `${label}: shared localStorage session removed`);
  assert(local.getItem(`${key}-code-verifier`) === null, `${label}: shared PKCE verifier removed`);

  session.setItem(key, '{"access_token":"mine"}');
  local.setItem(key, '{"access_token":"stale"}');
  mod.adoptSharedAuthSession(key);
  assert(session.getItem(key) === '{"access_token":"mine"}', `${label}: does not overwrite tab session`);
  assert(local.getItem(key) === null, `${label}: stale shared copy cleared`);

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
  const gBc = globalThis as { BroadcastChannel?: typeof BroadcastChannel };
  const prevBc = gBc.BroadcastChannel;
  gBc.BroadcastChannel = FakeChannel as unknown as typeof BroadcastChannel;
  FakeChannel.opened = 0;
  const { createClient } = await import("@supabase/supabase-js");
  mod.withoutAuthBroadcast(() =>
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
  assert(FakeChannel.opened === 0, `${label}: createClient must not open GoTrue auth BroadcastChannel`);
  new FakeChannel("after");
  assert(FakeChannel.opened === 1, `${label}: BroadcastChannel restored after createClient`);
  if (prevBc) gBc.BroadcastChannel = prevBc;
  else delete gBc.BroadcastChannel;
}

// ── 1) Google invite survives OAuth and opens the owner board (#138) ────────
console.log("\n── Google invite → owner seat → /app (#138) ──");

assert(
  googleOAuthRedirectTo("https://milonfinance.com", { token: "tok", clientCode: "MLN-1" }) ===
    "https://milonfinance.com/auth/callback?invite=tok&cc=MLN-1",
  "OAuth redirectTo carries invite + client code beside PKCE",
);
assert(
  ownerInviteFromCallbackSearch("?code=pkce&invite=tok&cc=MLN-1")?.token === "tok",
  "callback URL keeps invite next to the PKCE code param",
);
assert(
  resolvePendingOwnerInvite({
    callbackSearch: "?code=pkce",
    stored: { token: "tok", clientCode: "MLN-1" },
  })?.token === "tok",
  "stashed invite survives when Google returns only ?code= (origin hop)",
);
assert(
  resolvePendingOwnerInvite({
    callbackSearch: "?code=pkce",
    next: "/?invite=fromnext&mode=signup",
    stored: null,
  })?.token === "fromnext",
  "Google next path is the last-resort invite source",
);
{
  const cookie = pendingOwnerInviteCookieString(
    { token: "tok123", clientCode: "MLN-1" },
    "www.milonfinance.com",
    true,
  );
  assert(cookie.includes("milon_owner_invite="), "owner invite cookie name for OAuth hop");
  assert(cookie.includes("Domain=milonfinance.com"), "invite cookie spans www/apex");
  assert(readPendingOwnerInviteCookie(cookie)?.token === "tok123", "invite cookie round-trips token");
}

const dualAfterRedeem = summarizeRoles(["firm_admin", "client_owner"]);
assert(
  inferGoogleIntentFromRoles({
    hasClientRole: dualAfterRedeem.hasClientRole,
    hasPracticeRole: dualAfterRedeem.hasPracticeRole,
    hasFirm: true,
  }) === "owner",
  "dual-role after owner redeem infers owner (not practice console)",
);
assert(
  ownerBoardRole({
    roles: dualAfterRedeem.roles,
    force: "owner",
    intent: "owner",
  }) === "client_owner",
  "owner board uses client_owner seat, not firm_admin, for same-email accountant",
);
assert(
  decidePostLoginPath({ ...d(dualAfterRedeem), force: "owner" }) === "/app",
  "owner-door force lands on /app for dual-role invite redeem",
);
assert(
  decideOwnerAppBounce({ ...d(dualAfterRedeem), force: "owner", actingAsClient: false }) === false,
  "/app does not bounce a just-redeemed owner invite back to /dashboard",
);
assert(
  googleCallbackLanding(true, decidePostLoginPath({ ...d(dualAfterRedeem), force: "accountant" })) === "/app",
  "pending invite short-circuits callback navigation to /app even with stale accountant force",
);

const practiceOnly = d({ hasPracticeRole: true, hasFirm: true, practiceSignup: true });
assert(
  decidePostLoginPath({ ...practiceOnly, force: "accountant" }) === "/dashboard",
  "without invite, accountant Google on dual-capable account still opens practice portal",
);
assert(
  googleCallbackLanding(
    false,
    decidePostLoginPath({ ...practiceOnly, force: "accountant" }),
  ) === "/dashboard",
  "no invite → accountant door still routes to /dashboard (regression guard)",
);

const callbackSrc = readFileSync(resolve("src/routes/auth_.callback.tsx"), "utf8");
assert(callbackSrc.includes("if (pendingInvite?.token)"), "callback branches on pending owner invite");
assert(callbackSrc.includes('forcePortal("owner")'), "invite branch pins owner door before redeem");
assert(callbackSrc.includes("doAcceptOwnerInvite"), "callback redeems owner invite server-side");
assert(callbackSrc.includes('navigate({ to: "/app", replace: true })'), "invite success lands on /app");
assert(
  callbackSrc.indexOf("pendingInvite?.token") < callbackSrc.indexOf("ensure_own_client"),
  "invite redeem runs before ensure_own_client (no stray personal workspace)",
);
assert(
  callbackSrc.includes("!intent && !pendingInvite?.token"),
  "role inference is skipped while an owner invite is in flight",
);

const indexSrc = readFileSync(resolve("src/routes/index.tsx"), "utf8");
assert(indexSrc.includes("ownerInvite=") && indexSrc.includes("Continue with Google"), "landing Google keeps owner invite");
assert(indexSrc.includes("peekPendingOwnerInvite"), "landing respects a Google-stashed owner invite");

// ── 2) Portal force is session-scoped (main today; pairs with #140 per-tab) ─
console.log("\n── Portal force session scope (main + #140) ──");

const sessionStore = new MemoryStorage();
const localStore = new MemoryStorage();
const gWin = globalThis as unknown as { window: { sessionStorage: Storage; localStorage: Storage } };
const prevWindow = (globalThis as { window?: unknown }).window;
gWin.window = { sessionStorage: sessionStore, localStorage: localStore };

forcePortal("owner");
assert(sessionStore.getItem(PORTAL_FORCE_KEY) === "owner", "forcePortal writes milon_force_portal to sessionStorage");
assert(localStore.getItem(PORTAL_FORCE_KEY) === null, "forcePortal does not share the one-shot door via localStorage");
assert(peekForcePortal() === "owner", "peekForcePortal reads the session-scoped force flag");
clearForcePortal();
assert(peekForcePortal() === null, "clearForcePortal clears only this tab's force flag");

if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
else (globalThis as { window: unknown }).window = prevWindow;

// ── 3) Per-tab Supabase auth (#140 spec always; production wiring when merged) ─
console.log("\n── Per-tab auth isolation (#140) ──");

const tabAuthPath = resolve("src/integrations/supabase/tab-auth.ts");
const clientSrc = readFileSync(resolve("src/integrations/supabase/client.ts"), "utf8");
const authHookSrc = readFileSync(resolve("src/hooks/use-auth.tsx"), "utf8");
const pkgJson = readFileSync(resolve("package.json"), "utf8");
assert(pkgJson.includes(`"@supabase/supabase-js": "${SUPABASE_JS_VERSION}"`), `supabase-js pinned at ${SUPABASE_JS_VERSION}`);

assert(
  callbackSrc.includes("consumePendingOwnerInvite") && callbackSrc.includes("doAcceptOwnerInvite"),
  "Google callback invite redeem is independent of auth storage backend",
);

await runTabAuthUnitTests("tab-auth-spec", {
  supabaseAuthStorageKey: specSupabaseAuthStorageKey,
  tabAuthStorage: specTabAuthStorage,
  adoptSharedAuthSession: specAdoptSharedAuthSession,
  withoutAuthBroadcast: specWithoutAuthBroadcast,
});

if (existsSync(tabAuthPath)) {
  const prod = await import("../src/integrations/supabase/tab-auth");
  await runTabAuthUnitTests("tab-auth-prod", {
    supabaseAuthStorageKey: prod.supabaseAuthStorageKey,
    tabAuthStorage: prod.tabAuthStorage,
    adoptSharedAuthSession: prod.adoptSharedAuthSession,
    withoutAuthBroadcast: prod.withoutAuthBroadcast,
  });

  assert(clientSrc.includes("tabAuthStorage()"), "#140: browser client persists auth in sessionStorage");
  assert(clientSrc.includes("withoutAuthBroadcast"), "#140: client suppresses auth BroadcastChannel during createClient");
  assert(clientSrc.includes("adoptSharedAuthSession"), "#140: client migrates legacy localStorage once");
  assert(
    !/storage:\s*typeof window !== 'undefined' \? localStorage/.test(clientSrc),
    "#140: must not persist session in shared localStorage",
  );
  assert(
    authHookSrc.includes('signOut({ scope: "local" })'),
    "#140: tab sign-out uses local scope (no server revoke)",
  );
  assert(
    readFileSync(tabAuthPath, "utf8").includes("withoutAuthBroadcast"),
    "#140: BroadcastChannel monkeypatch lives in tab-auth.ts",
  );
} else {
  skip(
    "140_wiring_client_sessionStorage",
    "src/integrations/supabase/tab-auth.ts not on main — lands with PR #140",
  );
  skip(
    "140_wiring_withoutAuthBroadcast",
    "BroadcastChannel patch wired from client.ts via tab-auth.ts — PR #140",
  );
  skip(
    "140_wiring_signOut_local_scope",
    'use-auth.tsx signOut({ scope: "local" }) — PR #140 (main uses global signOut)',
  );
  skip("140_wiring_tab_auth_prod_parity", "production tab-auth module tests — PR #140");

  assert(
    clientSrc.includes("localStorage"),
    "main baseline: shared localStorage auth (regression context until #140)",
  );
  assert(
    !clientSrc.includes("withoutAuthBroadcast"),
    "main baseline: no BroadcastChannel patch yet",
  );
}

console.log("\nauth-reliability-test: ok");
