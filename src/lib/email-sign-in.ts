/**
 * Passwordless sign-in for an account that already exists.
 * signInWithOtp must pass shouldCreateUser: false. A missing account, a
 * disabled signup, and a successful send all surface the same sentence.
 */
import { canonicalAuthOrigin } from "@/lib/app-origin";
import { explainPasswordSignInFailure } from "@/lib/password-sign-in";
import { intentCookieDomain } from "@/lib/google-auth";
import { supabaseAuthStorageKey } from "@/integrations/supabase/tab-auth";
import { stashEmailReturn } from "@/lib/auth-url-return";
import { wakeAuth } from "@/hooks/use-auth";

export const EMAIL_SIGN_IN_SENT = "If an account exists for that email, we've sent a sign-in link.";

/** Primary instruction after a send. The live template may not include a code yet. */
export const EMAIL_SIGN_IN_TAP_LINK = "Check your email and tap the link.";

/** Collapsed until the person asks. The prod template has no code until it is pasted. */
export const EMAIL_SIGN_IN_CODE_INSTEAD = "Have a 6-digit code instead?";

export const EMAIL_SIGN_IN_RATE_LIMIT = "Too many sign-in emails. Wait a minute and try again.";

export const EMAIL_SIGN_IN_FAILED = "Could not send the sign-in email. Try again.";

export const EMAIL_SIGN_IN_CODE_FAILED =
  "That code didn't work. Request a new sign-in link and try again.";

export const EMAIL_SIGN_IN_LINK_FAILED =
  "That sign-in link is invalid or has expired. Request a new one.";

export type EmailSignInDoor = "accountant" | "owner";

export type EmailOtpType = "email" | "magiclink";

/** The browser client leaves flowType unset, so GoTrue's implicit default applies. */
export function emailCodeFallbackEnabled(flowType?: string | null): boolean {
  const flow = flowType ?? "implicit";
  return flow === "implicit" || flow === "pkce";
}

export function emailSignInRedirectTo(
  origin: string,
  door: EmailSignInDoor,
  next?: string | null,
): string {
  const url = new URL("/auth/callback", `${canonicalAuthOrigin(origin)}/`);
  url.search = "";
  url.hash = "";
  url.searchParams.set("door", door);
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\") &&
    !next.includes("://")
  ) {
    url.searchParams.set("next", next);
  }
  return url.toString();
}

/**
 * Arguments for supabase.auth.signInWithOtp. shouldCreateUser is always false.
 * Callers must pass this object through unchanged.
 */
export function emailSignInOtpArgs(
  email: string,
  emailRedirectTo: string,
): {
  email: string;
  options: { shouldCreateUser: false; emailRedirectTo: string };
} {
  return {
    email: email.trim(),
    options: {
      shouldCreateUser: false,
      emailRedirectTo,
    },
  };
}

export type EmailSignInNotice = {
  kind: "sent" | "rate_limited" | "failed";
  message: string;
  /** True when the 6-digit fallback may be shown. Same UI whether or not an account exists. */
  offerCode: boolean;
};

function readCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown; error_code?: unknown }).code;
  if (typeof code === "string") return code;
  const alt = (error as { error_code?: unknown }).error_code;
  return typeof alt === "string" ? alt : "";
}

function readText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

/** Errors that would tell a stranger the address is not registered. */
export function emailSignInHidesAccount(error: unknown): boolean {
  const code = readCode(error).toLowerCase();
  if (
    code === "user_not_found" ||
    code === "otp_disabled" ||
    code === "signup_disabled" ||
    code === "email_not_confirmed"
  ) {
    return true;
  }
  return /signups not allowed|user not found|user does not exist|otp.?disabled|not allowed for otp|signups? disabled/i.test(
    readText(error),
  );
}

/** Map a signInWithOtp error. Success and a missing account share one sentence. */
export function emailSignInNotice(error: unknown): EmailSignInNotice {
  if (!error) return { kind: "sent", message: EMAIL_SIGN_IN_SENT, offerCode: true };
  const failure = explainPasswordSignInFailure(error);
  if (failure.kind === "rate_limited") {
    return { kind: "rate_limited", message: EMAIL_SIGN_IN_RATE_LIMIT, offerCode: false };
  }
  if (emailSignInHidesAccount(error)) {
    return { kind: "sent", message: EMAIL_SIGN_IN_SENT, offerCode: true };
  }
  if (failure.kind === "network") {
    return { kind: "failed", message: failure.message, offerCode: false };
  }
  return { kind: "failed", message: EMAIL_SIGN_IN_FAILED, offerCode: false };
}

export type EmailSignInCallback =
  | {
      method: "verifyOtp";
      tokenHash: string;
      otpType: EmailOtpType;
      door: EmailSignInDoor | null;
      next: string | null;
    }
  | {
      method: "exchangeCodeForSession";
      code: string;
      door: EmailSignInDoor | null;
      next: string | null;
    }
  | {
      method: "getSession";
      door: EmailSignInDoor | null;
      next: string | null;
    };

function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\") || raw.includes("://")) return null;
  return raw;
}

function readDoor(raw: string | null): EmailSignInDoor | null {
  if (raw === "accountant" || raw === "owner") return raw;
  return null;
}

/**
 * Magic-link return on /auth/callback.
 * PKCE puts `code` on the query. Implicit puts tokens in the hash.
 * `token_hash` is the verifyOtp link. A Google return has neither `door` nor an email type.
 */
export function parseEmailSignInCallback(search: string, hash: string): EmailSignInCallback | null {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const door = readDoor(q.get("door") ?? h.get("door"));
  const next = safeNext(q.get("next") ?? h.get("next"));
  const tokenHash = (q.get("token_hash") || h.get("token_hash") || "").trim();
  const typeRaw = (q.get("type") || h.get("type") || "").toLowerCase();
  const otpType: EmailOtpType | null =
    typeRaw === "magiclink" ? "magiclink" : typeRaw === "email" ? "email" : null;
  const code = (q.get("code") || h.get("code") || "").trim();
  const implicit = Boolean(h.get("access_token") || h.get("refresh_token"));
  const emailReturn = Boolean(door || tokenHash || otpType);
  if (!emailReturn) return null;
  if (tokenHash) {
    return { method: "verifyOtp", tokenHash, otpType: otpType ?? "email", door, next };
  }
  if (code && !implicit) {
    return { method: "exchangeCodeForSession", code, door, next };
  }
  return { method: "getSession", door, next };
}

const VERIFIER_COOKIE = "milon_email_cv";

function verifierInSession(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (!key || !key.endsWith("-code-verifier")) continue;
    const value = sessionStorage.getItem(key);
    if (value) return value;
  }
  return null;
}

/** PKCE only. Implicit sign-in has no verifier. A new tab can read this cookie. */
export function stashEmailCodeVerifier(): void {
  if (typeof document === "undefined") return;
  const value = verifierInSession();
  if (!value) return;
  try {
    const domain = intentCookieDomain(window.location.hostname);
    const parts = [
      `${VERIFIER_COOKIE}=${encodeURIComponent(value)}`,
      "Path=/",
      "Max-Age=600",
      "SameSite=Lax",
    ];
    if (domain) parts.push(`Domain=${domain}`);
    if (window.location.protocol === "https:") parts.push("Secure");
    document.cookie = parts.join("; ");
  } catch {
    /* cookies blocked */
  }
}

/** Copy a PKCE verifier from the email-link cookie into this tab's sessionStorage. */
export function restoreEmailCodeVerifier(): void {
  if (typeof document === "undefined" || typeof sessionStorage === "undefined") return;
  if (verifierInSession()) return;
  const raw = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${VERIFIER_COOKIE}=`));
  if (!raw) return;
  let value = "";
  try {
    value = decodeURIComponent(raw.slice(VERIFIER_COOKIE.length + 1));
  } catch {
    return;
  }
  if (!value) return;
  const url =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
    (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
  if (!url) return;
  try {
    sessionStorage.setItem(`${supabaseAuthStorageKey(url)}-code-verifier`, value);
  } catch {
    /* private mode */
  }
}

export async function requestEmailSignInLink(input: {
  email: string;
  door: EmailSignInDoor;
  origin: string;
  next?: string | null;
}): Promise<EmailSignInNotice> {
  const email = input.email.trim();
  if (!email.includes("@")) {
    return { kind: "failed", message: "Enter a valid email address.", offerCode: false };
  }
  wakeAuth();
  const redirectTo = emailSignInRedirectTo(input.origin, input.door, input.next);
  const args = emailSignInOtpArgs(email, redirectTo);
  const { supabase } = await import("@/integrations/supabase/client");
  const { error } = await supabase.auth.signInWithOtp(args);
  const notice = emailSignInNotice(error);
  if (notice.kind === "sent") {
    stashEmailCodeVerifier();
    stashEmailReturn(input.door, input.next);
  }
  return notice;
}

export async function verifyEmailSignInCode(input: {
  email: string;
  token: string;
}): Promise<
  { ok: true; userId: string; meta: Record<string, unknown> } | { ok: false; message: string }
> {
  const email = input.email.trim();
  const token = input.token.replace(/\D/g, "");
  if (!email.includes("@") || token.length !== 6) {
    return { ok: false, message: EMAIL_SIGN_IN_CODE_FAILED };
  }
  wakeAuth();
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error || !data.user) return { ok: false, message: EMAIL_SIGN_IN_CODE_FAILED };
  return {
    ok: true,
    userId: data.user.id,
    meta: (data.user.user_metadata as Record<string, unknown> | undefined) ?? {},
  };
}

/** Same resolver password sign-in uses. Accountant door → practice portal; owner door → owner home. */
export async function destinationAfterEmailSignIn(input: {
  userId: string;
  door: EmailSignInDoor | null;
  knownMeta?: Record<string, unknown> | null;
}): Promise<"/practice" | "/app"> {
  const { resolveSignedInDestination } = await import("@/lib/landing-sign-in-destination");
  return resolveSignedInDestination(input.userId, {
    door: input.door === "accountant" ? "accountant" : "landing",
    knownMeta: input.knownMeta,
  });
}
