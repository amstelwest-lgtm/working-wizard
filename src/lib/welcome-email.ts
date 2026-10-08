/**
 * Signup welcome email. Plain copy, one send per user.
 * Firm owners get the trial line. Spark (business owners) do not.
 * Invited staff and client-owner invite accepts are not welcomed here.
 */

import { FIRM_TRIAL_SENTENCE } from "@/lib/stripe-plans";

export const WELCOME_EMAIL_SUBJECT = "Welcome to Milōn";
export const WELCOME_SIGN_OFF = "The MILŌN Team";
export const WELCOME_NEXT_STEP =
  "Connect QuickBooks or Xero, or upload your latest income statement, and Milōn will score the figures and suggest next moves.";

export const WELCOME_MAX_ATTEMPTS = 3;
export const WELCOME_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Signup call sites and the server share this window. Older accounts are not mailed. */
export const WELCOME_FRESH_WINDOW_MS = 30 * 60 * 1000;

export type WelcomeAudience = "firm_owner" | "business_owner";

export type WelcomeCandidate = {
  userId: string;
  email: string;
  fullName: string | null;
  createdAt: string | null;
  signupType: string | null;
  inviteClientId: string | null;
  inviteOutcome: string | null;
  ownsFirm: boolean;
  firmMembershipRole: string | null;
  ownsClient: boolean;
  sentAt: string | null;
  attempts: number;
  lastAttemptAt: string | null;
};

export type WelcomeSkipReason =
  | "no_email"
  | "not_fresh"
  | "invited"
  | "invited_staff"
  | "not_eligible"
  | "already_sent"
  | "max_attempts"
  | "cooldown"
  | "lost_race";

export function welcomeIdempotencyKey(userId: string): string {
  return `welcome-email/${userId}`.slice(0, 256);
}

export function welcomeAppPath(audience: WelcomeAudience): "/dashboard" | "/app" {
  return audience === "firm_owner" ? "/dashboard" : "/app";
}

/** First given name, or null when we should not invent one. */
export function welcomeFirstName(fullName: string | null | undefined): string | null {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed || trimmed.includes("@")) return null;
  const token = trimmed.split(/\s+/)[0]?.replace(/[.,]+$/g, "") ?? "";
  if (!token || token.includes("@")) return null;
  if (/^[A-Za-z]\.?$/.test(token)) return null;
  return token;
}

export function isFreshSignup(
  createdAt: string | null | undefined,
  now: Date,
  windowMs = WELCOME_FRESH_WINDOW_MS,
): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  const age = now.getTime() - created;
  return age > -120_000 && age < windowMs;
}

/**
 * Call the welcome sender only for a brand-new firm owner or business owner.
 * Owner-invite accepts and staff joining an existing firm already got mail.
 */
export function signupWelcomeTrigger(input: {
  fresh: boolean;
  ownerInvite: boolean;
  staffJoin: boolean;
}): boolean {
  return input.fresh && !input.ownerInvite && !input.staffJoin;
}

export function classifyWelcomeRecipient(
  c: Pick<
    WelcomeCandidate,
    | "signupType"
    | "inviteClientId"
    | "inviteOutcome"
    | "ownsFirm"
    | "firmMembershipRole"
    | "ownsClient"
  >,
):
  | { send: true; audience: WelcomeAudience }
  | { send: false; reason: "invited" | "invited_staff" | "not_eligible" } {
  const inviteId = (c.inviteClientId ?? "").trim();
  const outcome = (c.inviteOutcome ?? "").trim();
  if (inviteId || outcome) return { send: false, reason: "invited" };

  const role = (c.firmMembershipRole ?? "").trim().toLowerCase();
  if (role && role !== "owner" && !c.ownsFirm) return { send: false, reason: "invited_staff" };

  if (c.signupType === "accountant") return { send: true, audience: "firm_owner" };
  if (c.ownsFirm && !c.ownsClient) return { send: true, audience: "firm_owner" };
  if (c.ownsClient) return { send: true, audience: "business_owner" };
  if (c.ownsFirm) return { send: true, audience: "firm_owner" };
  if (c.signupType === "customer") return { send: true, audience: "business_owner" };
  return { send: false, reason: "not_eligible" };
}

export function welcomeAttemptGate(
  state: Pick<WelcomeCandidate, "sentAt" | "attempts" | "lastAttemptAt">,
  now: Date,
): "send" | "already_sent" | "max_attempts" | "cooldown" {
  if (state.sentAt) return "already_sent";
  if (state.attempts >= WELCOME_MAX_ATTEMPTS) return "max_attempts";
  if (state.attempts > 0 && state.lastAttemptAt) {
    const last = Date.parse(state.lastAttemptAt);
    if (Number.isFinite(last) && now.getTime() - last < WELCOME_RETRY_COOLDOWN_MS)
      return "cooldown";
  }
  return "send";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderWelcomeEmail(input: {
  fullName: string | null;
  audience: WelcomeAudience;
  appUrl: string;
}): { subject: string; html: string; text: string } {
  const first = welcomeFirstName(input.fullName);
  const hello = first ? `Welcome, ${first}.` : "Welcome.";
  const trial = input.audience === "firm_owner" ? FIRM_TRIAL_SENTENCE : null;
  const text = [
    hello,
    "",
    WELCOME_NEXT_STEP,
    "",
    ...(trial ? [trial, ""] : []),
    `Open Milōn: ${input.appUrl}`,
    "",
    WELCOME_SIGN_OFF,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5">
  <p>${escapeHtml(hello)}</p>
  <p>${escapeHtml(WELCOME_NEXT_STEP)}</p>
  ${trial ? `<p>${escapeHtml(trial)}</p>` : ""}
  <p><a href="${escapeHtml(input.appUrl)}" style="display:inline-block;background:#ac8400;color:#1b1300;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Open Milōn</a></p>
  <p style="color:#94a3b8;font-size:12px">${escapeHtml(WELCOME_SIGN_OFF)}</p>
  </body></html>`;
  return { subject: WELCOME_EMAIL_SUBJECT, html, text };
}

export function welcomeFailureLog(error: string): { status: string; message: string } {
  const trimmed = error.trim().slice(0, 500);
  const resend = /^Resend (\d+)\b/.exec(trimmed);
  if (resend) return { status: resend[1], message: trimmed };
  if (/timed out|timeout|TimeoutError|AbortError/i.test(trimmed)) {
    return { status: "timeout", message: trimmed };
  }
  return { status: "error", message: trimmed || "Email send failed" };
}

export type WelcomeDeliveryResult = {
  outcome: "sent" | "skipped" | "failed";
  reason: string;
};

/**
 * Decide, claim, send, stamp. A throwing mailer becomes `{ outcome: "failed" }`.
 * Callers that finish signup must still return success when this fails.
 */
export async function runWelcomeDelivery(input: {
  candidate: WelcomeCandidate;
  now: Date;
  appUrlFor: (audience: WelcomeAudience) => string;
  claimAttempt: () => Promise<boolean>;
  markSent: (sentAt: string) => Promise<void>;
  send: (mail: {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  onFailure?: (info: { status: string; message: string }) => void;
}): Promise<WelcomeDeliveryResult> {
  const report =
    input.onFailure ??
    ((info: { status: string; message: string }) => {
      console.error("[welcome-email] send failed", info);
    });

  const email = input.candidate.email.trim();
  if (!email || !email.includes("@")) return { outcome: "skipped", reason: "no_email" };
  if (!isFreshSignup(input.candidate.createdAt, input.now)) {
    return { outcome: "skipped", reason: "not_fresh" };
  }

  const who = classifyWelcomeRecipient(input.candidate);
  if (!who.send) return { outcome: "skipped", reason: who.reason };

  const gate = welcomeAttemptGate(input.candidate, input.now);
  if (gate !== "send") return { outcome: "skipped", reason: gate };

  const claimed = await input.claimAttempt();
  if (!claimed) return { outcome: "skipped", reason: "lost_race" };

  const mail = renderWelcomeEmail({
    fullName: input.candidate.fullName,
    audience: who.audience,
    appUrl: input.appUrlFor(who.audience),
  });

  try {
    const result = await input.send({
      to: email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: welcomeIdempotencyKey(input.candidate.userId),
    });
    if (!result.ok) {
      report(welcomeFailureLog(result.error));
      return { outcome: "failed", reason: result.error };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report(welcomeFailureLog(message));
    return { outcome: "failed", reason: message };
  }

  try {
    await input.markSent(input.now.toISOString());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report(welcomeFailureLog(message));
  }
  return { outcome: "sent", reason: "sent" };
}

/** Signup keeps going when the welcome send throws, times out, or returns an error. */
export async function welcomeWithoutBlockingSignup(send: () => Promise<unknown>): Promise<void> {
  try {
    await send();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[welcome-email] send failed", welcomeFailureLog(message));
  }
}
