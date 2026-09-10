/**
 * Auth reliability regressions — Google owner invite (#138, f19e693) and
 * per-tab session isolation (#140, when merged).
 *
 * Run:  pnpm test:auth-reliability
 * CI:   included in pnpm test:ci
 *
 * DB-backed invite redeem flows live in pnpm test:invited-member (manual).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  googleOAuthRedirectTo,
  inferGoogleIntentFromRoles,
} from "../src/lib/google-auth";
import {
  ownerInviteFromCallbackSearch,
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

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function skip(msg: string) {
  console.log(`SKIP  ${msg}`);
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

// Pre-redeem: practice-only identity must not be inferred while invite is in flight.
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
assert(indexSrc.includes("peekPendingOwnerInvite"), "landing respects a Google-stashed invite");

// ── 2) Portal force is session-scoped (main today; pairs with #140 per-tab) ─
console.log("\n── Portal force session scope (main + #140) ──");

const sessionStore = new MemoryStorage();
const localStore = new MemoryStorage();
const g = globalThis as unknown as { window: { sessionStorage: Storage; localStorage: Storage } };
const prevWindow = (globalThis as { window?: unknown }).window;
g.window = { sessionStorage: sessionStore, localStorage: localStore };

forcePortal("owner");
assert(sessionStore.getItem(PORTAL_FORCE_KEY) === "owner", "forcePortal writes milon_force_portal to sessionStorage");
assert(localStore.getItem(PORTAL_FORCE_KEY) === null, "forcePortal does not share the one-shot door via localStorage");
assert(peekForcePortal() === "owner", "peekForcePortal reads the session-scoped force flag");
clearForcePortal();
assert(peekForcePortal() === null, "clearForcePortal clears only this tab's force flag");

if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
else (globalThis as { window: unknown }).window = prevWindow;

// ── 3) Per-tab Supabase auth (#140 — conditional on tab-auth.ts) ────────────
console.log("\n── Per-tab auth isolation (#140) ──");

const tabAuthPath = resolve("src/integrations/supabase/tab-auth.ts");
const clientSrc = readFileSync(resolve("src/integrations/supabase/client.ts"), "utf8");
const authHookSrc = readFileSync(resolve("src/hooks/use-auth.tsx"), "utf8");

assert(
  callbackSrc.includes("consumePendingOwnerInvite") && callbackSrc.includes("doAcceptOwnerInvite"),
  "Google callback invite redeem is independent of auth storage backend",
);

if (existsSync(tabAuthPath)) {
  const {
    adoptSharedAuthSession,
    supabaseAuthStorageKey,
    tabAuthStorage,
    withoutAuthBroadcast,
  } = await import("../src/integrations/supabase/tab-auth");

  assert(
    supabaseAuthStorageKey("https://abcdefgh.supabase.co") === "sb-abcdefgh-auth-token",
    "storage key matches supabase-js default",
  );

  const local = new MemoryStorage();
  const session = new MemoryStorage();
  g.window = { localStorage: local, sessionStorage: session };
  assert(tabAuthStorage() === session, "auth storage is this tab's sessionStorage");

  const key = "sb-proj-auth-token";
  local.setItem(key, '{"access_token":"shared"}');
  local.setItem(`${key}-code-verifier`, "pkce");
  adoptSharedAuthSession(key);
  assert(session.getItem(key) === '{"access_token":"shared"}', "tab adopts shared session once");
  assert(local.getItem(key) === null, "shared localStorage session is removed for other tabs");
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
  assert(FakeChannel.opened === 0, "createClient must not open GoTrue auth BroadcastChannel");
  new FakeChannel("after");
  assert(FakeChannel.opened === 1, "BroadcastChannel constructor is restored after createClient");
  if (prevBc) gBc.BroadcastChannel = prevBc;
  else delete gBc.BroadcastChannel;

  assert(clientSrc.includes("tabAuthStorage()"), "browser client persists auth in sessionStorage");
  assert(clientSrc.includes("withoutAuthBroadcast"), "browser client suppresses auth BroadcastChannel");
  assert(clientSrc.includes("adoptSharedAuthSession"), "browser client migrates legacy localStorage once");
  assert(
    !/storage:\s*typeof window !== 'undefined' \? localStorage/.test(clientSrc),
    "must not persist the session in shared localStorage",
  );
  assert(authHookSrc.includes('signOut({ scope: "local" })'), "tab sign-out must not revoke other tabs globally");
} else {
  skip("per-tab unit tests — src/integrations/supabase/tab-auth.ts not on main yet (PR #140)");
  skip("sessionStorage auth persistence + BroadcastChannel suppression — enable after #140 merges");
  if (authHookSrc.includes('signOut({ scope: "local" })')) {
    assert(true, "signOut local scope present");
  } else {
    skip('use-auth signOut({ scope: "local" }) — requires #140 (main uses global signOut today)');
  }
  if (clientSrc.includes("tabAuthStorage()")) {
    assert(true, "sessionStorage client wiring present");
  } else {
    skip("supabase client sessionStorage wiring — requires #140 (main uses shared localStorage today)");
  }
}

console.log("\nauth-reliability-test: ok");
