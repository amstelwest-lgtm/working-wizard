/**
 * Pure checks for Google OAuth helpers.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/google-auth-test.mts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  googleDisplayName,
  googleOAuthRedirectTo,
  humanizeOAuthError,
  inferGoogleIntentFromRoles,
  intentCookieDomain,
  intentCookieString,
  isFreshAuthUser,
  parseAccountantGoogleSignup,
  parseOAuthCallbackParams,
  readIntentCookie,
} from "../src/lib/google-auth";
import {
  accountantNeedsLocationPicker,
  accountantProfileStamp,
  accountantWithoutFirm,
  redirectAccountantWithoutFirm,
  clearGooglePracticeGate,
  googlePracticeFirmMarket,
  googlePracticePickerDraft,
  readGooglePracticeGate,
  stashGooglePracticeGate,
} from "../src/lib/google-practice-market";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  googleOAuthRedirectTo("https://www.milonfinance.com/") ===
    "https://www.milonfinance.com/auth/callback",
  "redirect strips trailing slash",
);
assert(
  googleOAuthRedirectTo("http://localhost:5000") === "http://localhost:5000/auth/callback",
  "redirect local",
);
assert(
  googleOAuthRedirectTo("https://milonfinance.com", {
    token: "tok123",
    clientCode: "MLN-AB12",
  }) === "https://www.milonfinance.com/auth/callback?invite=tok123&cc=MLN-AB12",
  "apex origin still carries invite + client code on www",
);
assert(
  googleOAuthRedirectTo("https://milonfinance.com", { token: "tok123" }) ===
    "https://www.milonfinance.com/auth/callback?invite=tok123",
  "apex origin still carries invite without a client code on www",
);
assert(
  googleOAuthRedirectTo("https://milonfinance.com", { join: "joinTok" }) ===
    "https://www.milonfinance.com/auth/callback?join=joinTok",
  "apex origin still carries accountant join on www",
);
assert(
  googleOAuthRedirectTo("https://milonfinance.com", {
    checkout: "solo",
    interval: "month",
    market: "us",
  }) === "https://www.milonfinance.com/auth/callback?checkout=solo&interval=month&market=us",
  "apex origin still carries paid Checkout on www",
);

assert(
  googleDisplayName({ full_name: "Thabo Nkosi" }, "thabo@x.co") === "Thabo Nkosi",
  "full_name",
);
assert(googleDisplayName({ name: "Thabo" }, "thabo@x.co") === "Thabo", "google name");
assert(googleDisplayName({}, "thabo@x.co") === "thabo", "email local-part");
assert(googleDisplayName({}, null) === "My Business", "fallback");

const now = Date.parse("2026-08-23T12:00:00.000Z");
assert(isFreshAuthUser("2026-08-23T11:58:00.000Z", now), "fresh user");
assert(!isFreshAuthUser("2026-08-23T11:50:00.000Z", now), "stale user");
assert(!isFreshAuthUser(undefined, now), "missing created_at");

const pkce = parseOAuthCallbackParams("?code=abc123", "");
assert(pkce.code === "abc123", "pkce code");
assert(!pkce.error, "pkce no error");

const denied = parseOAuthCallbackParams("?error=access_denied&error_description=User%20denied", "");
assert(denied.error === "User denied", "error_description wins");

const hashErr = parseOAuthCallbackParams("", "#error=access_denied");
assert(hashErr.error === "access_denied", "hash error");

assert(
  humanizeOAuthError("Unsupported provider: provider is not enabled").includes("not enabled"),
  "provider disabled",
);
assert(humanizeOAuthError("access_denied") === "Sign-in was cancelled.", "cancelled");
assert(
  humanizeOAuthError("access_denied", "Google") === "Google sign-in was cancelled.",
  "named provider stays on the cancel message",
);
assert(humanizeOAuthError("Nope") === "Nope", "passthrough");

// ── Door survives the Google round trip via a domain-wide cookie ─────────────
assert(intentCookieDomain("www.milonfinance.com") === "milonfinance.com", "www collapses to apex");
assert(intentCookieDomain("milonfinance.com") === "milonfinance.com", "apex stays");
assert(
  intentCookieDomain("app.milonfinance.com") === "app.milonfinance.com",
  "other subdomains host-only",
);
assert(intentCookieDomain("localhost") === undefined, "localhost: no Domain attribute");
assert(intentCookieDomain("127.0.0.1") === undefined, "IP: no Domain attribute");

const c = intentCookieString("owner", "www.milonfinance.com", true);
assert(c.startsWith("milon_google_intent=owner"), "cookie carries the door");
assert(c.includes("Domain=milonfinance.com"), "cookie spans www and apex");
assert(c.includes("Secure") && c.includes("SameSite=Lax"), "cookie is Secure + Lax on https");
assert(
  !intentCookieString("owner", "localhost", false).includes("Domain="),
  "no Domain on localhost",
);
assert(
  intentCookieString(null, "milonfinance.com", true).includes("Max-Age=0"),
  "null clears the cookie",
);

assert(readIntentCookie("a=1; milon_google_intent=owner; b=2") === "owner", "reads owner");
assert(readIntentCookie("milon_google_intent=accountant") === "accountant", "reads accountant");
assert(readIntentCookie("milon_google_intent=bogus") === null, "rejects junk");
assert(readIntentCookie("") === null, "empty header");

// ── Lost door: decide from the account, never from a remembered door ─────────
assert(
  inferGoogleIntentFromRoles({ hasClientRole: true, hasPracticeRole: true, hasFirm: true }) ===
    "owner",
  "a business workspace wins even for dual-role accounts",
);
assert(
  inferGoogleIntentFromRoles({ hasClientRole: false, hasPracticeRole: true, hasFirm: false }) ===
    "accountant",
  "practice-only → accountant",
);
assert(
  inferGoogleIntentFromRoles({ hasClientRole: false, hasPracticeRole: false, hasFirm: true }) ===
    "accountant",
  "firm without roles yet → accountant",
);
assert(
  inferGoogleIntentFromRoles({ hasClientRole: false, hasPracticeRole: false, hasFirm: false }) ===
    "owner",
  "brand-new account → owner",
);

assert(parseAccountantGoogleSignup(null) === null, "empty accountant signup draft");
assert(
  parseAccountantGoogleSignup(
    JSON.stringify({ firmName: " West & Co ", fullName: "Ana", marketCountry: "ZA" }),
  )?.firmName === "West & Co",
  "accountant Google signup draft keeps firm name",
);
assert(
  parseAccountantGoogleSignup(JSON.stringify({ firmName: "West", marketCountry: "bogus" }))
    ?.marketCountry === undefined,
  "rejects junk market on accountant Google signup draft",
);

const googleSrc = readFileSync(resolve("src/lib/google-auth.ts"), "utf8");
assert(
  !/function consumeGoogleAuthIntent[\s\S]*getPortalIntent\(\)/.test(googleSrc),
  "consumeGoogleAuthIntent must not fall back to the persisted portal intent (stale accountant door hijacked owner Google sign-ins)",
);
assert(
  googleSrc.includes("ownerInvite"),
  "startGoogleSignIn stashes an in-flight owner invite across the OAuth hop",
);
assert(
  googleSrc.includes("googleOAuthRedirectTo(browserAppOrigin(), hop)"),
  "Google OAuth redirectTo carries the invite or accountant join on an allowlisted origin",
);

// /auth (AuthPage) has no <Outlet />, so any route filed under auth.*.tsx never
// renders — AuthPage runs instead, stamps the accountant door and sends
// dual-role owners to /dashboard. Google's return and the verify landing must
// be root-level routes (auth_.*.tsx).
for (const nested of ["src/routes/auth.callback.tsx", "src/routes/auth.verified.tsx"]) {
  assert(
    !existsSync(resolve(nested)),
    `${nested} must not exist — nest-free auth_.* route required`,
  );
}
const callbackSrc = readFileSync(resolve("src/routes/auth_.callback.tsx"), "utf8");
assert(
  callbackSrc.includes('createFileRoute("/auth_/callback")'),
  "callback is a root-level route",
);
assert(
  callbackSrc.includes("resolveSignedInDestination"),
  "callback pins the door through the shared sign-in resolver",
);
assert(
  callbackSrc.includes("destinationAfterSignIn"),
  "owner-stashed Google still opens the practice workspace for a practice account",
);
assert(
  callbackSrc.indexOf('destinationAfterSignIn(landingRoles, "landing")') <
    callbackSrc.indexOf("ensure_own_client"),
  "a practice account is reclassified before ensure_own_client can mint a business seat",
);
assert(
  callbackSrc.includes("inferGoogleIntentFromRoles("),
  "callback resolves a lost door from the account's roles",
);
assert(
  !callbackSrc.includes('if (intent === "accountant") forcePortal("accountant")'),
  "callback must forcePortal for owner intent, not only accountant",
);
assert(
  callbackSrc.includes("consumePendingOwnerInvite"),
  "Google callback redeems a stashed owner invite instead of abandoning it",
);
assert(
  callbackSrc.includes("peekPendingOwnerInvite") &&
    callbackSrc.includes("resolvePendingOwnerInvite"),
  "callback reads invite from OAuth URL + storage before consuming, so a remount cannot drop it",
);
assert(
  callbackSrc.includes("doAcceptOwnerInvite"),
  "Google callback attaches the signed-in user to the invited client",
);
assert(
  callbackSrc.indexOf("pendingInvite?.token") < callbackSrc.indexOf("ensure_own_client") &&
    callbackSrc.includes("pendingInvite?.token"),
  "invite redeem runs before ensure_own_client so an existing workspace is not minted first",
);
assert(
  callbackSrc.includes("!intent && !pendingInvite?.token"),
  "existing accountant Google identity must not be inferred while an owner invite is in flight",
);
assert(
  googleSrc.includes("peekPendingCheckout"),
  "Google sign-in attaches a stashed paid plan to OAuth redirectTo",
);
assert(
  googleSrc.includes("accountantJoin"),
  "startGoogleSignIn can return an accountant to /join after Google",
);
assert(
  callbackSrc.includes('signup_type: "accountant"') ||
    callbackSrc.includes('signup_type: "accountant"'),
  "Google Create-firm stamps accountant metadata so /app does not mint an owner client",
);
assert(
  callbackSrc.includes("ensure_practice_firm"),
  "Google accountant signup provisions a practice firm",
);
assert(
  callbackSrc.includes("accountantJoinFromCallbackSearch") &&
    callbackSrc.includes('to: "/join/$token"'),
  "Google callback returns accountant invites to /join/:token",
);
assert(
  callbackSrc.indexOf("joinToken") < callbackSrc.indexOf("goOps"),
  "accountant join hop runs before generic /app or /dashboard landing",
);
assert(
  callbackSrc.includes("googlePracticeFirmMarket"),
  "Google firm create resolves a market before ensure_practice_firm",
);
assert(callbackSrc.includes("<MarketPicker"), "a missing practice market opens the country picker");
assert(
  callbackSrc.includes("p_market: marketToJson(market)"),
  "Google firm create writes the resolved market",
);
assert(
  !callbackSrc.includes("p_market: market ? marketToJson(market) : null"),
  "Google firm create does not pass a null market",
);
assert(
  !callbackSrc.includes('ensure_practice_firm", { p_name: firmName }'),
  "Google firm create does not fall back to a name-only insert",
);
assert(
  callbackSrc.includes('marketCountry === "ZA" ? "za" : "us"'),
  "fresh accountant checkout treats a missing market as not ZA",
);

const ny = { country: "US" as const, regionCode: "NY" as const };
assert(
  googlePracticeFirmMarket({
    draftCountry: "ZA",
    draftRegion: null,
    visitor: ny,
    geoCountry: "US",
  })?.country === "ZA",
  "a complete South Africa draft wins over a US visitor and US geo",
);
assert(
  googlePracticeFirmMarket({ visitor: ny, geoCountry: "ZA" })?.regionCode === "NY",
  "a saved US visitor market is kept",
);
assert(
  googlePracticeFirmMarket({ visitor: null, geoCountry: "ZA" })?.country === "ZA",
  "a South Africa edge can create a firm without the picker",
);
assert(
  googlePracticeFirmMarket({ visitor: null, geoCountry: "US" }) === null,
  "a United States edge is not a firm market until a state is chosen",
);
assert(
  googlePracticeFirmMarket({ visitor: null, geoCountry: null }) === null,
  "an unknown visitor does not become South Africa",
);
assert(
  googlePracticeFirmMarket({ visitor: null, geoCountry: "GB" }) === null,
  "another country is not a practice market",
);
assert(
  googlePracticePickerDraft({
    visitorDraft: { country: null, regionCode: null },
    geoCountry: "US",
  }).country === "US" &&
    googlePracticePickerDraft({
      visitorDraft: { country: null, regionCode: null },
      geoCountry: "US",
    }).regionCode === null,
  "US geo pre-selects the United States and still asks for a state",
);
assert(
  googlePracticePickerDraft({
    visitorDraft: { country: null, regionCode: null },
    geoCountry: "GB",
  }).country === null,
  "an unknown edge does not pre-select South Africa",
);
assert(
  googlePracticePickerDraft({
    visitorDraft: { country: null, regionCode: null },
    geoCountry: "ZA",
  }).country === "ZA",
  "ZA geo seeds the picker as South Africa",
);

const memory = new Map<string, string>();
const previousStorage = globalThis.sessionStorage;
globalThis.sessionStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
  key: (index: number) => Array.from(memory.keys())[index] ?? null,
  get length() {
    return memory.size;
  },
} as Storage;
stashGooglePracticeGate({
  userId: "user-a",
  firmName: "North Books",
  fullName: "Ada",
  next: "/dashboard",
  joinToken: "",
});
assert(
  readGooglePracticeGate("user-b") === null,
  "a practice picker stash does not apply to another user",
);
assert(readGooglePracticeGate("user-a") === null, "a mismatched user clears the stash");
stashGooglePracticeGate({
  userId: "user-a",
  firmName: "North Books",
  fullName: "Ada",
  next: "/dashboard",
  joinToken: "",
});
assert(
  readGooglePracticeGate("user-a")?.firmName === "North Books",
  "the same user keeps the practice picker stash",
);
clearGooglePracticeGate();
assert(
  readGooglePracticeGate("user-a") === null,
  "confirming the practice location clears the stash",
);
globalThis.sessionStorage = previousStorage;

const stamp = accountantProfileStamp({ firmName: "North Books", fullName: "Ada" });
assert(stamp.signup_type === "accountant", "the picker stamp is an accountant signup");
assert(stamp.firm_name === "North Books", "the picker stamp keeps the firm name");
assert(stamp.full_name === "Ada", "the picker stamp keeps the person name");
assert(
  !Object.prototype.hasOwnProperty.call(stamp, "market_country") &&
    !Object.prototype.hasOwnProperty.call(stamp, "market_region"),
  "the picker stamp does not store a market",
);
assert(
  accountantWithoutFirm({ signupType: "accountant", firmCount: 0 }),
  "an accountant with no firm still needs a practice",
);
assert(
  !accountantWithoutFirm({ signupType: "accountant", firmCount: 1 }),
  "an accountant who already has a firm is not sent back to the picker",
);
assert(
  !accountantWithoutFirm({ signupType: "customer", firmCount: 0 }),
  "an owner with no firm is not treated as an abandoned practice",
);
assert(
  accountantWithoutFirm({ firmName: "North Books", firmCount: 0 }),
  "a firm name alone marks an abandoned practice",
);
assert(
  accountantNeedsLocationPicker({ signupType: "accountant", firmCount: 0, visitor: null }),
  "abandoning the picker still needs a location when nothing was chosen",
);
assert(
  !accountantNeedsLocationPicker({ signupType: "accountant", firmCount: 0, visitor: ny }),
  "a saved visitor market can create the firm without showing the picker again",
);
assert(
  !accountantNeedsLocationPicker({ signupType: "accountant", firmCount: 1, visitor: null }),
  "an existing firm does not reopen the picker",
);
assert(
  !accountantNeedsLocationPicker({
    signupType: "accountant",
    firmCount: 0,
    marketCountry: "ZA",
    visitor: null,
  }),
  "a stored South Africa choice can create the firm",
);

const openAt = callbackSrc.indexOf("async function openPracticeLocation");
const landAt = callbackSrc.indexOf("async function landGoogleUser");
const openBody = callbackSrc.slice(openAt, landAt);
assert(openAt >= 0 && landAt > openAt, "the practice picker opener is declared before landing");
assert(
  openBody.includes("accountantProfileStamp(") &&
    openBody.indexOf("accountantProfileStamp(") < openBody.indexOf("setPracticeGate("),
  "the picker stamp is written before the picker opens",
);
assert(
  !openBody.includes("market_country") && !openBody.includes("market_region"),
  "opening the picker does not write a market onto the profile",
);
assert(
  callbackSrc.includes("practiceSignup && existingFirmCount === 0"),
  "a later visit with practice metadata and no firm still finishes location",
);
assert(
  !callbackSrc.includes("readVisitorMarket() ??"),
  "owner Google sign-in does not default a missing market to South Africa",
);
assert(
  callbackSrc.includes("p_market: readVisitorMarket()"),
  "owner Google sign-in still stores a visitor market when one was picked",
);

const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const provisionAt = appSrc.indexOf("const shouldProvisionOwner");
assert(
  provisionAt > 0 && appSrc.slice(0, provisionAt).includes("accountantWithoutFirm({"),
  "a firm-less accountant leaves /app before an owner client is created",
);
assert(
  !appSrc.includes("readVisitorMarket() ??"),
  "the owner app does not default a missing market to South Africa",
);

const gateSrc = readFileSync(resolve("src/routes/_authenticated.gate.tsx"), "utf8");
assert(
  gateSrc.includes("redirectAccountantWithoutFirm") &&
    gateSrc.includes("firmsLoaded") &&
    gateSrc.includes('to: "/auth/callback"'),
  "a firm-less accountant returns to the picker only after firms have loaded",
);
assert(
  !redirectAccountantWithoutFirm({
    firmsLoaded: false,
    signupType: "accountant",
    firmCount: 0,
  }),
  "a timed-out firm load does not redirect to the location picker",
);
assert(
  !redirectAccountantWithoutFirm({
    firmsLoaded: false,
    signupType: "accountant",
    firmName: "North Books",
    firmCount: 0,
  }),
  "a failed firm read does not redirect to the location picker",
);
assert(
  redirectAccountantWithoutFirm({
    firmsLoaded: true,
    signupType: "accountant",
    firmCount: 0,
  }),
  "a loaded accountant with no firm returns to the location picker",
);
assert(
  !redirectAccountantWithoutFirm({
    firmsLoaded: true,
    signupType: "accountant",
    firmCount: 1,
  }),
  "a loaded firm stays on the practice",
);

const profileSrc = readFileSync(resolve("src/contexts/accountant-profile.tsx"), "utf8");
assert(
  profileSrc.includes("awaitingPracticeLocation"),
  "profile hydration does not mint a firm while practice location is still unchosen",
);
const timeoutAt = profileSrc.indexOf("brand load timed out");
const timeoutEnd = profileSrc.indexOf("}, SHELL_GATE_TIMEOUT_MS);", timeoutAt);
const timeoutBody = profileSrc.slice(timeoutAt, timeoutEnd);
assert(timeoutAt > 0 && timeoutEnd > timeoutAt, "brand hydrate still times out");
assert(
  !timeoutBody.includes("setFirmsLoaded"),
  "a brand timeout does not mark the firm list loaded",
);
assert(
  profileSrc.includes("if (again.error)") &&
    profileSrc.includes("listed.error == null") &&
    profileSrc.indexOf("listed.error == null") < profileSrc.indexOf("setFirmsLoaded(true)"),
  "a failed firm read does not mark the firm list loaded",
);

const nullMarketSql = readFileSync(
  resolve("supabase/migrations/20261020130500_ensure_own_client_null_market.sql"),
  "utf8",
);
assert(
  !nullMarketSql.includes('{"country":"ZA","regionCode":null}'),
  "ensure_own_client no longer rewrites a null market to South Africa",
);
assert(
  nullMarketSql.includes(
    "CREATE OR REPLACE FUNCTION public.ensure_own_client(p_name text, p_market jsonb DEFAULT NULL)",
  ),
  "ensure_own_client keeps the (text, jsonb) signature",
);
assert(
  nullMarketSql.includes(
    "REVOKE EXECUTE ON FUNCTION public.ensure_own_client(text, jsonb) FROM PUBLIC;",
  ) &&
    nullMarketSql.includes(
      "GRANT EXECUTE ON FUNCTION public.ensure_own_client(text, jsonb) TO authenticated;",
    ),
  "ensure_own_client keeps the public revoke and authenticated grant",
);
assert(
  nullMarketSql.includes("pg_advisory_xact_lock"),
  "ensure_own_client keeps the advisory lock",
);
assert(
  nullMarketSql.includes("INSERT INTO public.clients"),
  "a missing owner market still inserts a client",
);
assert(nullMarketSql.includes("v_market"), "the insert stores the passed market, including null");
const nullMarketInsertAt = nullMarketSql.indexOf("INSERT INTO public.clients");
assert(
  nullMarketSql.indexOf("firm_id IS NULL") < nullMarketSql.indexOf("m.role = 'client_owner'") &&
    nullMarketSql.indexOf("m.role = 'client_owner'") < nullMarketInsertAt,
  "firm-unlinked lookup, then client_owner, then insert",
);
assert(
  (nullMarketSql.slice(0, nullMarketInsertAt).match(/RETURN v_client_id;/g) ?? []).length === 2,
  "both lookups return before any insert",
);
assert(
  !/insert\s+into\s+public\.client_memberships/i.test(nullMarketSql) &&
    !/insert\s+into\s+public\.user_roles/i.test(nullMarketSql),
  "return and insert still write no membership or role",
);
assert(
  !/update\s+public\.clients/i.test(nullMarketSql),
  "existing owner clients are not rewritten",
);
assert(
  !/delete\s+from\s+public\.clients/i.test(nullMarketSql),
  "existing owner clients are not deleted",
);

const authPage = readFileSync(resolve("src/routes/auth.tsx"), "utf8");
assert(authPage.includes("Continue with Google"), "Create firm offers Google sign-up");
assert(
  authPage.includes("stashAccountantGoogleSignup"),
  "Create firm Google carries firm name + market",
);
assert(
  (authPage.match(/AccountProviderButtons/g) ?? []).length >= 2,
  "Create firm and Sign in both offer Apple and Google",
);

console.log("google-auth-test: ok");
