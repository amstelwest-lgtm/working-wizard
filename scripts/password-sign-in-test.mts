/**
 * Password sign-in failures stay on the form.
 *
 * `signInWithPassword` returns `{ error }` for POST /token 400 invalid_credentials.
 * It does not throw. Throwing that into a toast of the raw GoTrue string, then
 * clearing the busy flag, leaves the form looking idle.
 *
 * Run: pnpm test:password-sign-in
 * CI:  included in pnpm test:ci
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMAIL_NOT_CONFIRMED_MESSAGE,
  GENERIC_SIGN_IN_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  NETWORK_SIGN_IN_MESSAGE,
  RATE_LIMITED_MESSAGE,
  explainPasswordSignInFailure,
  passwordGrantFailure,
} from "../src/lib/password-sign-in";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

class AuthRetryableFetchError extends Error {
  status = 0;
  constructor(message: string) {
    super(message);
    this.name = "AuthRetryableFetchError";
  }
}

const invalid = explainPasswordSignInFailure({
  name: "AuthApiError",
  message: "Invalid login credentials",
  status: 400,
  code: "invalid_credentials",
});
assert(invalid.kind === "invalid_credentials", "code invalid_credentials");
assert(invalid.message === INVALID_CREDENTIALS_MESSAGE, "wrong password copy");
assert(
  invalid.message === "Email or password is incorrect.",
  "inline copy is Email or password is incorrect.",
);

assert(
  explainPasswordSignInFailure(new Error("Invalid login credentials")).kind ===
    "invalid_credentials",
  "legacy message without a code is still a wrong password",
);

const plainBody = passwordGrantFailure({
  error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 },
});
assert(plainBody?.kind === "invalid_credentials", "{ error } return is not dropped");
assert(
  !(plainBody && plainBody.message === "Invalid login credentials"),
  "raw GoTrue string is not shown",
);
assert(passwordGrantFailure({ error: null }) === null, "success grant is not a failure");
assert(passwordGrantFailure(undefined) === null, "missing result is not a failure");
assert(passwordGrantFailure({}) === null, "missing error property is not a failure");

const unconfirmed = explainPasswordSignInFailure({
  code: "email_not_confirmed",
  message: "Email not confirmed",
  status: 400,
});
assert(unconfirmed.kind === "email_not_confirmed", "email not confirmed kind");
assert(unconfirmed.message === EMAIL_NOT_CONFIRMED_MESSAGE, "email not confirmed copy");

const limited = explainPasswordSignInFailure({
  code: "over_request_rate_limit",
  message: "Request rate limit reached",
  status: 429,
});
assert(limited.kind === "rate_limited", "rate limit kind");
assert(limited.message === RATE_LIMITED_MESSAGE, "rate limit copy");
assert(
  explainPasswordSignInFailure({ status: 429, message: "Too many requests" }).kind ===
    "rate_limited",
  "HTTP 429 is rate limited",
);

const offline = explainPasswordSignInFailure(new AuthRetryableFetchError("Failed to fetch"));
assert(offline.kind === "network", "retryable fetch is a network failure");
assert(offline.message === NETWORK_SIGN_IN_MESSAGE, "network copy");
assert(
  explainPasswordSignInFailure(new TypeError("Failed to fetch")).kind === "network",
  "TypeError fetch is a network failure",
);

const other = explainPasswordSignInFailure(new Error("Enter a valid email address."));
assert(other.kind === "other", "validation copy stays other");
assert(other.message === "Enter a valid email address.", "other keeps a short human message");
assert(
  explainPasswordSignInFailure({ message: "" }).message === GENERIC_SIGN_IN_MESSAGE,
  "empty error gets a generic message",
);

const root = resolve(".");
const auth = readFileSync(resolve(root, "src/routes/auth.tsx"), "utf8");
const owner = [
  readFileSync(resolve(root, "src/routes/index.tsx"), "utf8"),
  readFileSync(resolve(root, "src/components/landing/sign-in-modal.tsx"), "utf8"),
].join("\n");
const overlay = readFileSync(
  resolve(root, "src/components/owner-invite-signin-overlay.tsx"),
  "utf8",
);
const join = readFileSync(resolve(root, "src/routes/join.$token.tsx"), "utf8");

assert(auth.includes("passwordGrantFailure"), "practice sign-in reads { error }");
assert(
  auth.includes("setSignInFailure(failure)"),
  "practice sign-in keeps the failure on the form",
);
assert(auth.includes("Signing in…"), "practice button has a loading label");
assert(auth.includes("aria-busy={busy}"), "practice button exposes busy");
assert(auth.includes("disabled={busy"), "practice button is disabled while pending");
assert(auth.includes("submitLock.current"), "practice sign-in blocks a double submit");
assert(
  (auth.match(/setSignInFailure\(null\)/g) ?? []).length >= 2,
  "editing email or password clears the practice error",
);
assert(auth.includes("PasswordResetRequest"), "forgot password opens the reset flow");
assert(auth.includes("onForgotPassword={openPasswordReset}"), "reset link sits on the error");
const grantAt = auth.indexOf("passwordGrantFailure");
const landAt = auth.indexOf('landAfterAccountantAuth(signInData.user.id, "signin")');
assert(
  grantAt !== -1 && landAt !== -1 && grantAt < landAt,
  "failure returns before the dashboard landing",
);
assert(auth.includes("clearPendingCheckout"), "plain sign-in still clears a stashed plan");
assert(auth.includes("decideAccountantAuthLanding"), "plain sign-in still uses the #271 landing");

assert(owner.includes("explainPasswordSignInFailure"), "owner sign-in maps the grant error");
assert(owner.includes("clearOwnerSignInError"), "owner sign-in clears errors on edit");
assert(owner.includes("PasswordSignInAlert"), "owner modal shows the inline error");
assert(owner.includes("aria-busy={siBusy}"), "owner button exposes busy");
assert(owner.includes("siSubmitLock.current"), "owner sign-in blocks a double submit");
assert(owner.includes('tone="landing"'), "business-owner modal uses the shared alert");

assert(overlay.includes("PasswordSignInAlert"), "invite modal shows the inline error");
assert(overlay.includes("PasswordResetRequest"), "invite modal opens the reset flow");
assert(overlay.includes("aria-busy={siBusy}"), "invite modal button exposes busy");

assert(join.includes("passwordGrantFailure"), "join sign-in reads { error }");
assert(join.includes("PasswordSignInAlert"), "join sign-in shows the inline error");
assert(join.includes("Signing in…"), "join sign-in button has a loading label");

console.log("password-sign-in ok");
