/**
 * Pure checks for Google OAuth helpers.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/google-auth-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  googleDisplayName,
  googleOAuthRedirectTo,
  humanizeOAuthError,
  isFreshAuthUser,
  parseOAuthCallbackParams,
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

const googleSrc = readFileSync(resolve("src/lib/google-auth.ts"), "utf8");
assert(
  /function consumeGoogleAuthIntent[\s\S]*getPortalIntent\(\)/.test(googleSrc),
  "consumeGoogleAuthIntent falls back to getPortalIntent when Google session intent is missing",
);
assert(
  googleSrc.includes('getPortalIntent() ?? "owner"'),
  "consumeGoogleAuthIntent defaults to owner only after portal-intent fallback",
);

const callbackSrc = readFileSync(resolve("src/routes/auth.callback.tsx"), "utf8");
assert(callbackSrc.includes("forcePortal(intent)"), "callback pins the consumed door for owner and accountant");
assert(
  !callbackSrc.includes('if (intent === "accountant") forcePortal("accountant")'),
  "callback must forcePortal for owner intent, not only accountant",
);

console.log("google-auth-test: ok");
