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
  parseOAuthCallbackParams,
  readIntentCookie,
} from "../src/lib/google-auth";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  googleOAuthRedirectTo("https://milon.co.za/") === "https://milon.co.za/auth/callback",
  "redirect strips trailing slash",
);
assert(
  googleOAuthRedirectTo("http://localhost:5000") === "http://localhost:5000/auth/callback",
  "redirect local",
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
assert(humanizeOAuthError("access_denied") === "Google sign-in was cancelled.", "cancelled");
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

const googleSrc = readFileSync(resolve("src/lib/google-auth.ts"), "utf8");
assert(
  !/function consumeGoogleAuthIntent[\s\S]*getPortalIntent\(\)/.test(googleSrc),
  "consumeGoogleAuthIntent must not fall back to the persisted portal intent (stale accountant door hijacked owner Google sign-ins)",
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
  callbackSrc.includes("forcePortal(intent)"),
  "callback pins the consumed door for owner and accountant",
);
assert(
  callbackSrc.includes("inferGoogleIntentFromRoles("),
  "callback resolves a lost door from the account's roles",
);
assert(
  !callbackSrc.includes('if (intent === "accountant") forcePortal("accountant")'),
  "callback must forcePortal for owner intent, not only accountant",
);

console.log("google-auth-test: ok");
