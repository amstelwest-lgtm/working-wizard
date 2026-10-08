/**
 * Signup welcome email: copy, one send, skip invites, signup survives a throw.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/welcome-email-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIRM_TRIAL_SENTENCE } from "../src/lib/stripe-plans";
import {
  classifyWelcomeRecipient,
  renderWelcomeEmail,
  runWelcomeDelivery,
  signupWelcomeTrigger,
  WELCOME_EMAIL_SUBJECT,
  WELCOME_NEXT_STEP,
  WELCOME_SIGN_OFF,
  welcomeAppPath,
  welcomeAttemptGate,
  welcomeFailureLog,
  welcomeIdempotencyKey,
  welcomeWithoutBlockingSignup,
  type WelcomeCandidate,
} from "../src/lib/welcome-email";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const APP = "https://www.milonfinance.com";
const now = new Date("2026-10-08T12:00:00.000Z");

function candidate(over: Partial<WelcomeCandidate> = {}): WelcomeCandidate {
  return {
    userId: "user-1",
    email: "ada@example.com",
    fullName: "Ada Lovelace",
    createdAt: now.toISOString(),
    signupType: "accountant",
    inviteClientId: null,
    inviteOutcome: null,
    ownsFirm: true,
    firmMembershipRole: "owner",
    ownsClient: false,
    sentAt: null,
    attempts: 0,
    lastAttemptAt: null,
    ...over,
  };
}

assert(welcomeAppPath("firm_owner") === "/open", "firm welcome opens the smart landing");
assert(welcomeAppPath("business_owner") === "/app", "Spark welcome stays on the business board");

const firm = renderWelcomeEmail({
  fullName: "Ada Lovelace",
  audience: "firm_owner",
  appUrl: `${APP}${welcomeAppPath("firm_owner")}`,
});
const owner = renderWelcomeEmail({
  fullName: "Ada Lovelace",
  audience: "business_owner",
  appUrl: `${APP}/app`,
});
const unnamed = renderWelcomeEmail({
  fullName: null,
  audience: "business_owner",
  appUrl: `${APP}/app`,
});

assert(firm.subject === WELCOME_EMAIL_SUBJECT, "subject");
assert(firm.subject === "Welcome to Milōn", "subject spelling");
assert(firm.text.startsWith("Welcome, Ada."), "firm welcome uses the first name");
assert(firm.text.includes(WELCOME_NEXT_STEP), "firm next step");
assert(firm.text.includes(FIRM_TRIAL_SENTENCE), "firm trial line");
assert(firm.text.includes(`${APP}/open`), "firm link");
assert(!firm.text.includes("/dashboard"), "firm link is not the paywalled dashboard");
assert(firm.text.trimEnd().endsWith(WELCOME_SIGN_OFF), "firm sign-off");
assert(firm.html.includes(`href="${APP}/open"`), "firm button");
assert(firm.html.includes("Open Milōn"), "firm button label");

assert(owner.text.startsWith("Welcome, Ada."), "owner welcome");
assert(owner.text.includes(WELCOME_NEXT_STEP), "owner next step");
assert(!owner.text.includes(FIRM_TRIAL_SENTENCE), "Spark skips the trial line");
assert(!owner.text.includes("trial"), "Spark copy has no trial");
assert(owner.text.includes(`${APP}/app`), "owner link");
assert(owner.text.trimEnd().endsWith(WELCOME_SIGN_OFF), "owner sign-off");
assert(owner.html.includes(`href="${APP}/app"`), "owner button");
assert(unnamed.text.startsWith("Welcome."), "missing name stays unnamed");

for (const mail of [firm, owner, unnamed]) {
  const blob = `${mail.subject}\n${mail.text}\n${mail.html}`;
  assert(!/\bclaude\b/i.test(blob), "no model name");
  assert(!/\bocfo\b|outsourced cfo/i.test(blob), "no OCFO");
  assert(!/\btheo\b/i.test(blob), "no founder name");
  assert(!/50%|discount/i.test(blob), "no discount");
  assert(!/[$]|ZAR|USD|R\d/.test(blob), "currency-neutral");
}

assert(
  classifyWelcomeRecipient(
    candidate({
      signupType: "customer",
      ownsFirm: false,
      ownsClient: true,
      firmMembershipRole: null,
    }),
  ).send === true,
  "business owner is welcomed",
);
const staff = classifyWelcomeRecipient(
  candidate({
    signupType: "accountant",
    inviteClientId: "invite-token",
    inviteOutcome: "accountant_invite",
    ownsFirm: true,
    firmMembershipRole: "member",
  }),
);
assert(staff.send === false && staff.reason === "invited", "invited staff are skipped");
const staffRole = classifyWelcomeRecipient(
  candidate({
    signupType: "accountant",
    ownsFirm: false,
    firmMembershipRole: "member",
    ownsClient: false,
  }),
);
assert(
  staffRole.send === false && staffRole.reason === "invited_staff",
  "staff seat without a firm is skipped",
);
const ownerInvite = classifyWelcomeRecipient(
  candidate({
    signupType: "customer",
    inviteOutcome: "owner_handoff",
    ownsFirm: false,
    ownsClient: true,
    firmMembershipRole: null,
  }),
);
assert(
  ownerInvite.send === false && ownerInvite.reason === "invited",
  "client-owner invite accepts are skipped",
);

assert(
  signupWelcomeTrigger({ fresh: true, ownerInvite: false, staffJoin: false }),
  "fresh signup offers welcome",
);
assert(
  !signupWelcomeTrigger({ fresh: true, ownerInvite: true, staffJoin: false }),
  "owner invite does not",
);
assert(
  !signupWelcomeTrigger({ fresh: true, ownerInvite: false, staffJoin: true }),
  "staff join does not",
);
assert(
  !signupWelcomeTrigger({ fresh: false, ownerInvite: false, staffJoin: false }),
  "returning sign-in does not",
);

assert(welcomeFailureLog("Resend 403: domain").status === "403", "403 status is logged");
assert(welcomeFailureLog("Email send timed out").status === "timeout", "timeout status is logged");
assert(
  welcomeAttemptGate(candidate({ sentAt: now.toISOString() }), now) === "already_sent",
  "stamp blocks a resend",
);
assert(
  welcomeAttemptGate(candidate({ attempts: 3 }), now) === "max_attempts",
  "three attempts stop",
);
assert(
  welcomeAttemptGate(candidate({ attempts: 1, lastAttemptAt: now.toISOString() }), now) ===
    "cooldown",
  "a failure inside 24h does not retry",
);

type Stamp = { sentAt: string | null; attempts: number; lastAttemptAt: string | null };

async function deliver(
  base: WelcomeCandidate,
  stamp: Stamp,
  send: () => Promise<{ ok: true } | { ok: false; error: string }>,
  onFailure?: (info: { status: string; message: string }) => void,
) {
  return runWelcomeDelivery({
    candidate: { ...base, ...stamp },
    now,
    appUrlFor: (audience) => `${APP}${welcomeAppPath(audience)}`,
    claimAttempt: async () => {
      if (stamp.sentAt || stamp.attempts !== base.attempts) return false;
      stamp.attempts += 1;
      stamp.lastAttemptAt = now.toISOString();
      return true;
    },
    markSent: async (sentAt) => {
      stamp.sentAt = sentAt;
    },
    send: async (mail) => {
      assert(mail.subject === WELCOME_EMAIL_SUBJECT, "sent subject");
      assert(mail.idempotencyKey === welcomeIdempotencyKey(base.userId), "idempotency key");
      return send();
    },
    onFailure,
  });
}

const once = { sentAt: null, attempts: 0, lastAttemptAt: null };
let sends = 0;
const first = await deliver(candidate(), once, async () => {
  sends += 1;
  return { ok: true };
});
const second = await deliver(candidate(), once, async () => {
  sends += 1;
  return { ok: true };
});
assert(first.outcome === "sent", "first signup sends");
assert(
  second.outcome === "skipped" && second.reason === "already_sent",
  "second signup does not send",
);
assert(sends === 1, "mailer is called once");

const failedStamp = { sentAt: null, attempts: 0, lastAttemptAt: null };
let failedSends = 0;
const failureLogs: Array<{ status: string; message: string }> = [];
const failed = await deliver(
  candidate(),
  failedStamp,
  async () => {
    failedSends += 1;
    throw new Error("Resend 403: domain is not verified");
  },
  (info) => failureLogs.push(info),
);
const retry = await deliver(candidate(), failedStamp, async () => {
  failedSends += 1;
  return { ok: true };
});
assert(failed.outcome === "failed", "a throwing send is a failed welcome, not a thrown signup");
assert(failureLogs[0]?.status === "403", "failed send logs the Resend status");
assert(
  failureLogs[0]?.message.includes("domain is not verified") === true,
  "failed send logs the Resend message",
);
assert(
  retry.outcome === "skipped" && retry.reason === "cooldown",
  "no immediate retry after a failure",
);
assert(failedSends === 1, "the throwing send is not repeated");
assert(failedStamp.sentAt === null, "a failure does not stamp the welcome as sent");

const invited = await deliver(
  candidate({
    inviteClientId: "tok",
    inviteOutcome: "accountant_invite",
    firmMembershipRole: "member",
  }),
  { sentAt: null, attempts: 0, lastAttemptAt: null },
  async () => {
    throw new Error("invited staff must not send");
  },
);
assert(
  invited.outcome === "skipped" && invited.reason === "invited",
  "delivery skips invited staff",
);

const origError = console.error;
const logged: unknown[][] = [];
console.error = (...args: unknown[]) => {
  logged.push(args);
};
try {
  const created = { userId: "user-1", email: "ada@example.com" };
  await welcomeWithoutBlockingSignup(async () => {
    throw new Error("Resend 403: domain is not verified");
  });
  assert(
    created.userId === "user-1" && created.email === "ada@example.com",
    "signup result survives the throw",
  );
} finally {
  console.error = origError;
}
const loggedBlob = JSON.stringify(logged);
assert(loggedBlob.includes("[welcome-email] send failed"), "failure is logged");
assert(loggedBlob.includes("403"), "log includes the status");
assert(loggedBlob.includes("domain is not verified"), "log includes the message");

const authFns = readFileSync(resolve("src/lib/auth.functions.ts"), "utf8");
const adminStart = authFns.indexOf("export const adminSignUp");
const adminEnd = authFns.indexOf("export const acceptOwnerInvite");
const admin = authFns.slice(adminStart, adminEnd);
assert(admin.includes("return result"), "invite signup still returns early");
assert(
  admin.indexOf("return result") < admin.indexOf("welcomeWithoutBlockingSignup"),
  "welcome is after the invite return",
);
assert(admin.includes("sendSignupWelcomeForUser"), "server signup sends the welcome");

const callback = readFileSync(resolve("src/routes/auth_.callback.tsx"), "utf8");
assert(callback.includes("signupWelcomeTrigger"), "Google callback gates the welcome");
assert(callback.includes("staffJoin: Boolean(joinToken)"), "staff join does not get a welcome");
assert(
  callback.indexOf("if (pendingInvite?.token)") < callback.indexOf("if (offerWelcome)"),
  "owner invite returns before welcome",
);

const landing = readFileSync(resolve("src/routes/index.tsx"), "utf8");
const inviteSlice = landing.slice(landing.indexOf("Invite flow"), landing.indexOf("Firm signup"));
assert(
  !inviteSlice.includes("welcomeWithoutBlockingSignup"),
  "landing invite accept does not welcome",
);
assert(
  landing
    .slice(
      landing.indexOf("[signup] ensure_practice_firm failed"),
      landing.indexOf("[signup] ensure_practice_firm failed") + 500,
    )
    .includes("welcomeWithoutBlockingSignup"),
  "firm signup welcomes after the firm exists",
);
assert(
  landing
    .slice(
      landing.indexOf("[signup] ensure_own_client failed"),
      landing.indexOf("[signup] ensure_own_client failed") + 500,
    )
    .includes("welcomeWithoutBlockingSignup"),
  "owner signup welcomes after the business exists",
);

const authPage = readFileSync(resolve("src/routes/auth.tsx"), "utf8");
assert(
  authPage.includes("welcomeWithoutBlockingSignup(() => doSendWelcome())"),
  "accountant portal signup welcomes",
);

for (const file of [
  "src/lib/invite-member.server.ts",
  "src/lib/accountant-invite.server.ts",
  "src/lib/practice-access.functions.ts",
  "src/routes/join.$token.tsx",
]) {
  const src = readFileSync(resolve(file), "utf8");
  assert(
    !src.includes("welcome-email") && !src.includes("sendSignupWelcome"),
    `${file} does not send the welcome`,
  );
}

const server = readFileSync(resolve("src/lib/welcome-email.server.ts"), "utf8");
assert(server.includes("sendAccessEmail"), "reuses the staff-invite Resend helper");
assert(server.includes("inviteSiteUrl"), "link uses the site URL helper");
assert(!/trymilon|lighthouse/i.test(server), "does not use the outreach sender");
assert(!/from:\s*[`'"]/.test(server), "does not hard-code a from address");

const migration = readFileSync(
  resolve("supabase/migrations/20261008143000_welcome_email_sent_at.sql"),
  "utf8",
);
assert(migration.includes("welcome_email_sent_at"), "migration adds the stamp");
assert(migration.includes("welcome_email_attempts"), "migration records attempts");
assert(migration.includes("welcome_email_last_attempt_at"), "migration records the last attempt");

console.log("--- firm text ---");
console.log(firm.text);
console.log("--- owner text ---");
console.log(owner.text);
console.log("welcome-email-test: ok");
