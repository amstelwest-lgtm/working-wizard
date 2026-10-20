/**
 * Passwordless email sign-in never creates a user, stays neutral, and the
 * callback accepts the magic-link token.
 * Run: pnpm test:email-sign-in
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMAIL_SIGN_IN_CODE_INSTEAD,
  EMAIL_SIGN_IN_RATE_LIMIT,
  EMAIL_SIGN_IN_SENT,
  EMAIL_SIGN_IN_TAP_LINK,
  emailCodeFallbackEnabled,
  emailSignInHidesAccount,
  emailSignInNotice,
  emailSignInOtpArgs,
  emailSignInRedirectTo,
  parseEmailSignInCallback,
} from "../src/lib/email-sign-in.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

const sent = emailSignInOtpArgs(
  "ada@firm.example",
  "https://www.milonfinance.com/auth/callback?door=accountant",
);
assert(sent.options.shouldCreateUser === false, "shouldCreateUser is false");
assert(sent.email === "ada@firm.example", "email is trimmed into the otp call");
assert(
  sent.options.emailRedirectTo.includes("/auth/callback"),
  "the redirect stays on the auth callback",
);

const padded = emailSignInOtpArgs(
  "  ada@firm.example  ",
  emailSignInRedirectTo("https://www.milonfinance.com", "owner"),
);
assert(padded.options.shouldCreateUser === false, "shouldCreateUser stays false for every call");
assert(padded.email === "ada@firm.example", "surrounding space is trimmed");
assert(
  padded.options.emailRedirectTo === "https://www.milonfinance.com/auth/callback?door=owner",
  "owner links return to the callback with the owner door",
);
assert(
  emailSignInRedirectTo("https://www.milonfinance.com/", "accountant", "/ops") ===
    "https://www.milonfinance.com/auth/callback?door=accountant&next=%2Fops",
  "a same-origin next is kept on the callback",
);
assert(
  !emailSignInRedirectTo(
    "https://www.milonfinance.com",
    "accountant",
    "https://evil.example",
  ).includes("evil"),
  "an off-site next is dropped",
);

assert(emailSignInNotice(null).message === EMAIL_SIGN_IN_SENT, "a send uses the neutral sentence");
assert(emailSignInNotice(null).offerCode === true, "a send offers the code fallback");
assert(
  emailSignInNotice({ code: "user_not_found", message: "User not found" }).message ===
    EMAIL_SIGN_IN_SENT,
  "a missing account uses the same sentence",
);
assert(
  emailSignInNotice({ message: "Signups not allowed for otp" }).message === EMAIL_SIGN_IN_SENT,
  "a refused signup does not reveal that the account is missing",
);
assert(
  emailSignInHidesAccount({ code: "otp_disabled", message: "Signups not allowed" }),
  "otp disabled is hidden",
);
assert(
  emailSignInNotice({
    code: "over_email_send_rate_limit",
    message: "email rate limit exceeded",
    status: 429,
  }).message === EMAIL_SIGN_IN_RATE_LIMIT,
  "a rate limit gets a friendly message",
);
assert(
  emailSignInNotice({ code: "over_email_send_rate_limit", status: 429 }).offerCode === false,
  "a rate limit does not pretend a code is waiting",
);
assert(
  !emailSignInNotice({ code: "user_not_found", message: "User not found" })
    .message.toLowerCase()
    .includes("not found"),
  "the notice does not say the account is missing",
);

const token = parseEmailSignInCallback("?token_hash=abc123&type=email&door=owner", "");
assert(token?.method === "verifyOtp", "a token_hash link is verifyOtp");
assert(token?.method === "verifyOtp" && token.tokenHash === "abc123", "the token is kept");
assert(token?.method === "verifyOtp" && token.otpType === "email", "email type is verifyOtp email");
assert(token?.method === "verifyOtp" && token.door === "owner", "the owner door survives the link");

const magic = parseEmailSignInCallback("?token_hash=abc&type=magiclink&door=accountant", "");
assert(
  magic?.method === "verifyOtp" && magic.otpType === "magiclink",
  "magiclink type stays magiclink",
);
assert(
  magic?.method === "verifyOtp" && magic.door === "accountant",
  "the accountant door survives the link",
);

const pkce = parseEmailSignInCallback("?door=accountant&code=pkce-code", "");
assert(pkce?.method === "exchangeCodeForSession", "a PKCE code is exchangeCodeForSession");
assert(pkce?.method === "exchangeCodeForSession" && pkce.code === "pkce-code", "the code is kept");

const implicit = parseEmailSignInCallback(
  "?door=owner",
  "#access_token=tok&refresh_token=ref&type=magiclink",
);
assert(implicit?.method === "getSession", "an implicit magic link is picked up from the session");
assert(
  parseEmailSignInCallback("?code=google-code", "") === null,
  "a Google code is not an email sign-in",
);
assert(
  parseEmailSignInCallback("?code=google-code&invite=tok", "#access_token=x") === null,
  "a Google hash without an email door is not an email sign-in",
);

assert(emailCodeFallbackEnabled() === true, "the default client flow accepts the 6-digit code");
assert(emailCodeFallbackEnabled("pkce") === true, "PKCE still accepts verifyOtp email");
assert(emailCodeFallbackEnabled("implicit") === true, "implicit accepts verifyOtp email");

const client = read("src/integrations/supabase/client.ts");
const authAt = client.indexOf("auth:");
const authBlock = client.slice(authAt, client.indexOf("})", authAt));
assert(!/flowType\s*:/.test(authBlock), "the browser client does not override flowType");

const lib = read("src/lib/email-sign-in.ts");
assert(lib.includes("shouldCreateUser: false"), "the otp helper hard-codes shouldCreateUser false");
assert(!lib.includes("shouldCreateUser: true"), "the helper never creates users");
assert(lib.includes("signInWithOtp(args)"), "signInWithOtp receives the helper args");
assert(lib.includes("emailSignInOtpArgs"), "those args come from emailSignInOtpArgs");
assert(lib.includes('type: "email"'), "the 6-digit fallback uses verifyOtp type email");
assert(lib.includes(EMAIL_SIGN_IN_SENT), "the helper owns the neutral sentence");

const otpFiles = [
  "src/lib/email-sign-in.ts",
  "src/components/verify-email-banner.tsx",
  "src/routes/auth_.callback.tsx",
];
for (const file of otpFiles) {
  const text = read(file);
  let at = 0;
  while ((at = text.indexOf("signInWithOtp(", at)) !== -1) {
    const window = text.slice(Math.max(0, at - 250), at + 400);
    assert(
      window.includes("shouldCreateUser: false") || window.includes("emailSignInOtpArgs"),
      `${file} passes shouldCreateUser false into signInWithOtp`,
    );
    at += "signInWithOtp(".length;
  }
}

const callback = read("src/routes/auth_.callback.tsx");
assert(callback.includes("parseEmailSignInCallback"), "the callback recognises an email return");
assert(callback.includes("verifyOtp"), "the callback verifies a token_hash");
assert(callback.includes("exchangeCodeForSession"), "the callback exchanges a PKCE code");
assert(
  callback.includes("destinationAfterEmailSignIn"),
  "the callback uses the shared post-login helper",
);
assert(callback.includes("restoreEmailCodeVerifier"), "a new tab can still finish PKCE");

const entry = read("src/components/email-sign-in-option.tsx");
const authPage = read("src/routes/auth.tsx");
const modal = read("src/components/landing/sign-in-modal.tsx");
assert(entry.includes("Email me a sign-in link"), "the control is labelled as a sign-in link");
assert(entry.includes("EMAIL_SIGN_IN_TAP_LINK"), "after a send, the link is the instruction");
assert(
  EMAIL_SIGN_IN_TAP_LINK === "Check your email and tap the link.",
  "the link instruction is the primary sentence",
);
assert(entry.includes("<details"), "the 6-digit form stays collapsed");
assert(entry.includes("EMAIL_SIGN_IN_CODE_INSTEAD"), "the code is a secondary disclosure");
assert(
  EMAIL_SIGN_IN_CODE_INSTEAD === "Have a 6-digit code instead?",
  "the disclosure asks for a code instead of the link",
);
assert(
  entry.indexOf("EMAIL_SIGN_IN_CODE_INSTEAD") < entry.indexOf("Enter the 6-digit code"),
  "the disclosure comes before the code field",
);
assert(entry.includes("Enter the 6-digit code"), "the code fallback is labelled once opened");
assert(
  entry.includes(EMAIL_SIGN_IN_SENT) || entry.includes("notice"),
  "the control shows the helper notice",
);
assert(authPage.includes("EmailSignInOption"), "/auth offers the email link");
assert(authPage.includes('door="accountant"'), "/auth sends the accountant door");
assert(modal.includes("EmailSignInOption"), "the shared sign-in modal offers the email link");
assert(modal.includes('door="owner"'), "the owner modal sends the owner door");
assert(
  read("src/components/landing/landing-sign-in-session.tsx").includes("onEmailSignedIn"),
  "marketing sign-in lands a code",
);
assert(read("src/routes/index.tsx").includes("onEmailSignedIn"), "homepage sign-in lands a code");

console.log("email-sign-in-test: ok");
