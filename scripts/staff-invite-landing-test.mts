/**
 * New staff can create an account on /access/:token without opening a firm.
 * Run: pnpm test:staff-invite
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { googleOAuthRedirectTo } from "../src/lib/google-auth";
import { accessTokenFromNext } from "../src/lib/practice-access";
import {
  STAFF_INVITE_INVALID_MESSAGE,
  callbackNextParam,
  staffInviteCallbackPath,
  staffInviteEmailRedirectTo,
  staffInvitePhase,
  staffInviteSignOutLabel,
} from "../src/lib/staff-invite-landing";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const invited = "nia@benaccountants.co.za";

assert(
  staffInvitePhase({
    expired: false,
    used: false,
    accountExists: false,
    signedInEmail: null,
    invitedEmail: invited,
  }) === "create",
  "a new address is offered account creation",
);
assert(
  staffInvitePhase({
    expired: false,
    used: false,
    accountExists: true,
    signedInEmail: null,
    invitedEmail: invited,
  }) === "signin",
  "an existing address keeps sign in to accept",
);
assert(
  staffInvitePhase({
    expired: false,
    used: false,
    accountExists: false,
    signedInEmail: invited,
    invitedEmail: invited,
  }) === "auto_accept",
  "the invited session auto-accepts",
);
assert(
  staffInvitePhase({
    expired: false,
    used: false,
    accountExists: true,
    signedInEmail: "other@example.com",
    invitedEmail: invited,
  }) === "mismatch",
  "a different signed-in email does not accept",
);
assert(
  staffInvitePhase({
    expired: true,
    used: false,
    accountExists: false,
    signedInEmail: null,
    invitedEmail: invited,
  }) === "invalid",
  "an expired staff invite is invalid",
);
assert(
  staffInvitePhase({
    expired: true,
    used: true,
    accountExists: false,
    signedInEmail: invited,
    invitedEmail: invited,
  }) === "invalid",
  "a revoked tombstone (expired) wins over a signed-in session",
);
assert(
  staffInvitePhase({
    expired: false,
    used: true,
    accountExists: true,
    signedInEmail: null,
    invitedEmail: invited,
  }) === "used",
  "an accepted link stays used",
);
assert(
  STAFF_INVITE_INVALID_MESSAGE ===
    "This invite is no longer valid. Ask your firm admin to send a new one.",
  "invalid copy asks the firm admin for a new invite",
);
assert(
  staffInviteSignOutLabel(invited) === `Sign out and use ${invited}`,
  "mismatch offers sign out and use the invited email",
);

const token = "abc123def456";
const callbackPath = staffInviteCallbackPath(token);
assert(callbackPath.startsWith("/auth/callback?next="), "confirmation returns through the auth callback");
const next = callbackNextParam(callbackPath.slice(callbackPath.indexOf("?")));
assert(next === `/access/${token}`, "next param preserves the access token");
assert(accessTokenFromNext(next) === token, "the callback can read the staff token back out");
assert(
  staffInviteEmailRedirectTo("https://www.milonfinance.com", token) ===
    `https://www.milonfinance.com${callbackPath}`,
  "email confirmation redirect keeps the same next path",
);
assert(callbackNextParam("?next=https://evil.example") === undefined, "off-site next is ignored");
assert(callbackNextParam("?next=//evil.example") === undefined, "protocol-relative next is ignored");
assert(callbackNextParam("?next=/billing/start") === undefined, "staff confirmation cannot resume checkout");

assert(
  googleOAuthRedirectTo("https://www.milonfinance.com", { next: `/access/${token}` }) ===
    `https://www.milonfinance.com/auth/callback?next=${encodeURIComponent(`/access/${token}`)}`,
  "Google return URL carries the staff invite",
);
assert(
  googleOAuthRedirectTo("https://milonfinance.com") === "https://milonfinance.com/auth/callback",
  "Google redirect without a hop is unchanged",
);

const page = readFileSync(resolve("src/routes/access.$token.tsx"), "utf8");
const landing = readFileSync(resolve("src/components/staff-invite-landing.tsx"), "utf8");
const callback = readFileSync(resolve("src/routes/auth_.callback.tsx"), "utf8");
const google = readFileSync(resolve("src/lib/google-auth.ts"), "utf8");
const email = readFileSync(resolve("src/lib/practice-access-email.ts"), "utf8");

assert(page.includes("redeemAccessToken"), "acceptance still uses redeemAccessToken");
assert(page.includes('signup_type: "staff"'), "staff signup is not a firm signup");
assert(!page.includes("ensure_practice_firm"), "the access page does not create a firm");
assert(!page.includes("Create firm"), "the access page has no create-firm path");
assert(page.includes("staffInviteEmailRedirectTo"), "signup preserves the token on the confirmation redirect");
assert(landing.includes("Create your account"), "new staff see create your account");
assert(landing.includes("Sign in to accept"), "existing accounts see sign in to accept");
assert(landing.includes("readOnly"), "the invited email field is locked");
assert(landing.includes("staffInviteSignOutLabel"), "mismatch can sign out and use the invited email");
assert(landing.includes("STAFF_INVITE_INVALID_MESSAGE"), "revoked and expired invites share one message");
assert(!landing.includes("Solo"), "staff landing has no plan copy");
assert(!/trial|card on file|Create firm/i.test(landing), "staff landing has no trial, card, or firm-signup copy");
assert(callback.includes("callbackNextParam"), "callback reads next from the confirmation URL");
assert(
  callback.indexOf('to: "/access/$token"') < callback.indexOf("ensure_practice_firm"),
  "returning from email or Google does not create a firm before the invite page",
);
assert(
  callback.indexOf("pendingInvite?.token") < callback.indexOf('to: "/access/$token"'),
  "owner invite still redeems before the staff access hop",
);
const googleStart = google.slice(google.indexOf("export async function startGoogleSignIn"));
assert(
  googleStart.indexOf('next?.startsWith("/access/")') < googleStart.indexOf("peekPendingCheckout"),
  "a staff Google hop does not attach a stashed firm plan",
);
const staffEmail = email.slice(email.indexOf("export function firmInviteEmail"));
assert(!staffEmail.includes("already approved"), "staff invite email dropped the owner sentence");
assert(!staffEmail.includes("business owner"), "staff invite email has no owner-portal sentence");
assert(
  staffEmail.includes("Open the link to create your account with this email address; it takes a minute."),
  "staff invite email tells the new hire what to do",
);
assert(email.includes("from: `Milōn <${fromAddr}>`"), "transactional from-address construction is unchanged");

console.log("staff-invite-landing-test: ok");
