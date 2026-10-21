/**
 * Sign in with Apple sits beside Google and reuses the same OAuth hop.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/apple-auth-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { humanizeOAuthError } from "../src/lib/google-auth";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const apple = readFileSync(resolve("src/lib/apple-auth.ts"), "utf8");
assert(apple.includes('provider: "apple"'), "uses the Apple provider");
assert(apple.includes("scopes: APPLE_OAUTH_SCOPES"), "requests the Apple scope constant");
assert(apple.includes('APPLE_OAUTH_SCOPES = "name email"'), "scopes are name and email only");
assert(apple.includes("prepareSocialSignIn"), "reuses the shared door and invite hop");
assert(!apple.includes("access_type"), "does not send Google query params");
assert(!apple.includes("prompt:"), "does not send a Google prompt");
assert(!/BEGIN PRIVATE KEY|APPLE_SECRET|Services ID/.test(apple), "no Apple secret in source");

const button = readFileSync(resolve("src/components/apple-sign-in-button.tsx"), "utf8");
assert(button.includes('label = "Sign in with Apple"'), "default label is the HIG phrase");
assert(button.includes("startAppleSignIn"), "button starts Apple sign-in");

const stack = readFileSync(resolve("src/components/google-sign-in-button.tsx"), "utf8");
assert(
  stack.indexOf("<AppleSignInButton") < stack.indexOf("<GoogleSignInButton"),
  "Apple is rendered above Google",
);
assert(
  stack.includes('googleLabel.replaceAll("Google", "Apple")'),
  "the Apple label follows the Google label",
);

const surfaces = [
  "src/routes/auth.tsx",
  "src/routes/join.$token.tsx",
  "src/components/staff-invite-landing.tsx",
  "src/components/owner-invite-signin-overlay.tsx",
  "src/components/owner-invite-signup-panel.tsx",
  "src/components/landing/register-form.tsx",
  "src/components/landing/sign-in-modal.tsx",
];
for (const file of surfaces) {
  const src = readFileSync(resolve(file), "utf8");
  assert(src.includes("AccountProviderButtons"), `${file} offers Apple beside Google`);
  assert(!src.includes("GoogleSignInButton"), `${file} does not render Google on its own`);
}

assert(
  humanizeOAuthError("Unsupported provider: provider is not enabled", "Apple").includes(
    "Apple provider",
  ),
  "a disabled Apple provider names Apple",
);
assert(
  humanizeOAuthError("The user canceled the authorization attempt.", "Apple") ===
    "Apple sign-in was cancelled.",
  "Apple cancel",
);

const callback = readFileSync(resolve("src/routes/auth_.callback.tsx"), "utf8");
assert(callback.includes("OAUTH_SIGN_IN_INCOMPLETE"), "callback uses the shared incomplete message");
assert(!callback.includes("Google sign-in did not complete"), "callback is not Google-only");

const java = readFileSync(
  resolve("mobile/android/app/src/main/java/com/milonfinance/app/MilonExternalUrls.java"),
  "utf8",
);
const swift = readFileSync(resolve("mobile/ios/App/App/MilonShellPlugin.swift"), "utf8");
for (const host of ["appleid.apple.com", "idmsa.apple.com"]) {
  assert(java.includes(`"${host}"`), `Android opens ${host} outside the WebView`);
  assert(swift.includes(`"${host}"`), `iOS opens ${host} outside the WebView`);
}

console.log("apple-auth-test: ok");
