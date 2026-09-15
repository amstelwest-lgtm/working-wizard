import { supabase } from "@/integrations/supabase/client";
import { setPortalIntent, type PortalIntent } from "@/lib/user-roles";

export const GOOGLE_CALLBACK_PATH = "/auth/callback";
export const GOOGLE_INTENT_KEY = "milon_google_auth_intent";
export const GOOGLE_NEXT_KEY = "milon_google_auth_next";

export type GoogleAuthIntent = PortalIntent;

export const GOOGLE_ACCOUNTANT_SIGNUP_KEY = "milon_google_accountant_signup";

export type AccountantGoogleSignupDraft = {
  firmName: string;
  fullName?: string;
  marketCountry?: "ZA" | "US";
  marketRegion?: string | null;
};

export type GoogleOAuthHop = {
  /** Owner-invite token (never `code` — that is PKCE). */
  token?: string;
  clientCode?: string | null;
  /** Owner→accountant join token. Distinct from `invite`. */
  join?: string;
  /** Paid-plan Checkout to resume after Google (`orbit` / `constellation`). */
  checkout?: string;
  market?: string;
};

export function googleOAuthRedirectTo(origin: string, hop?: GoogleOAuthHop): string {
  const base = `${origin.replace(/\/$/, "")}${GOOGLE_CALLBACK_PATH}`;
  const q = new URLSearchParams();
  const token = hop?.token?.trim();
  if (token) {
    q.set("invite", token);
    const cc = hop?.clientCode?.trim();
    if (cc) q.set("cc", cc);
  }
  const join = hop?.join?.trim();
  if (join) q.set("join", join);
  const checkout = hop?.checkout?.trim();
  if (checkout) {
    q.set("checkout", checkout);
    const market = hop.market?.trim();
    if (market) q.set("market", market);
  }
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

export function parseAccountantGoogleSignup(raw: string | null | undefined): AccountantGoogleSignupDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AccountantGoogleSignupDraft;
    if (!parsed || typeof parsed !== "object") return null;
    const firmName = typeof parsed.firmName === "string" ? parsed.firmName.trim() : "";
    const fullName = typeof parsed.fullName === "string" ? parsed.fullName.trim() : "";
    const marketCountry =
      parsed.marketCountry === "ZA" || parsed.marketCountry === "US" ? parsed.marketCountry : undefined;
    const marketRegion =
      typeof parsed.marketRegion === "string" ? parsed.marketRegion : (parsed.marketRegion ?? null);
    return {
      firmName,
      ...(fullName ? { fullName } : {}),
      ...(marketCountry ? { marketCountry, marketRegion: marketRegion ?? null } : {}),
    };
  } catch {
    return null;
  }
}

export function stashAccountantGoogleSignup(draft: AccountantGoogleSignupDraft): void {
  try {
    sessionStorage.setItem(GOOGLE_ACCOUNTANT_SIGNUP_KEY, JSON.stringify(draft));
  } catch {
    /* private mode / SSR */
  }
}

export function consumeAccountantGoogleSignup(): AccountantGoogleSignupDraft | null {
  try {
    const raw = sessionStorage.getItem(GOOGLE_ACCOUNTANT_SIGNUP_KEY);
    sessionStorage.removeItem(GOOGLE_ACCOUNTANT_SIGNUP_KEY);
    return parseAccountantGoogleSignup(raw);
  } catch {
    return null;
  }
}

export function googleDisplayName(
  meta: Record<string, unknown> | null | undefined,
  email?: string | null,
): string {
  const full = typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  const name = typeof meta?.name === "string" ? meta.name.trim() : "";
  const fromEmail = email?.split("@")[0]?.trim() ?? "";
  return full || name || fromEmail || "My Business";
}

export function isFreshAuthUser(
  createdAt: string | undefined,
  nowMs = Date.now(),
  windowMs = 5 * 60 * 1000,
): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && nowMs - t < windowMs;
}

export function parseOAuthCallbackParams(
  search: string,
  hash: string,
): { code?: string; error?: string } {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const error =
    q.get("error_description") || q.get("error") || h.get("error_description") || h.get("error");
  const code = q.get("code") || h.get("code");
  return {
    ...(code ? { code } : {}),
    ...(error ? { error } : {}),
  };
}

export function humanizeOAuthError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("not enabled") || s.includes("unsupported provider")) {
    return "Google sign-in is not enabled yet. Turn on the Google provider in Supabase Auth.";
  }
  if (s.includes("access_denied") || s.includes("user cancelled") || s.includes("denied")) {
    return "Google sign-in was cancelled.";
  }
  if (s.includes("already registered") || s.includes("identity is already linked")) {
    return "This email already has a Milōn password account. Sign in with email instead.";
  }
  return raw;
}

/**
 * The door (owner / accountant) must survive the round trip through Google.
 * sessionStorage alone does not: if the user clicks on www.example.com and
 * Vercel canonicalises the callback to example.com (or the reverse), the
 * callback runs on a different origin with empty storage. A cookie scoped to
 * the registrable host survives that hop. (Never fall back to the persisted
 * "last door" in localStorage — a stale `accountant` from an earlier /auth
 * visit was hijacking owner Google sign-ins and landing them on /dashboard.)
 */
export const GOOGLE_INTENT_COOKIE = "milon_google_intent";
const INTENT_COOKIE_MAX_AGE_S = 15 * 60;

/** `www.milonfinance.com` → `milonfinance.com`; localhost / IPs → undefined (host-only cookie). */
export function intentCookieDomain(hostname: string): string | undefined {
  const h = hostname.trim().toLowerCase();
  if (!h || h === "localhost" || /^[\d.]+$/.test(h) || /^\[?[0-9a-f:]+\]?$/.test(h)) {
    return undefined;
  }
  if (!h.includes(".")) return undefined;
  return h.replace(/^www\./, "");
}

export function intentCookieString(
  intent: GoogleAuthIntent | null,
  hostname: string,
  secure: boolean,
): string {
  const domain = intentCookieDomain(hostname);
  const parts = [
    `${GOOGLE_INTENT_COOKIE}=${intent ?? ""}`,
    "Path=/",
    `Max-Age=${intent ? INTENT_COOKIE_MAX_AGE_S : 0}`,
    "SameSite=Lax",
  ];
  if (domain) parts.push(`Domain=${domain}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readIntentCookie(cookieHeader: string): GoogleAuthIntent | null {
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== GOOGLE_INTENT_COOKIE) continue;
    const v = rest.join("=").trim();
    if (v === "owner" || v === "accountant") return v;
  }
  return null;
}

function writeIntentCookie(intent: GoogleAuthIntent | null): void {
  try {
    document.cookie = intentCookieString(
      intent,
      window.location.hostname,
      window.location.protocol === "https:",
    );
  } catch {
    /* SSR / cookies disabled */
  }
}

export function stashGoogleAuthIntent(intent: GoogleAuthIntent, next?: string): void {
  setPortalIntent(intent);
  writeIntentCookie(intent);
  try {
    sessionStorage.setItem(GOOGLE_INTENT_KEY, intent);
    if (next && next.startsWith("/")) sessionStorage.setItem(GOOGLE_NEXT_KEY, next);
    else sessionStorage.removeItem(GOOGLE_NEXT_KEY);
  } catch {
    /* private mode / SSR */
  }
}

/**
 * Returns the door the user actually clicked, or null when nothing survived
 * the round trip. Callers must then decide from the account's real roles
 * (inferGoogleIntentFromRoles) — never from a remembered door.
 */
export function consumeGoogleAuthIntent(): { intent: GoogleAuthIntent | null; next?: string } {
  let intent: GoogleAuthIntent | null = null;
  let next: string | undefined;
  try {
    const stored = sessionStorage.getItem(GOOGLE_INTENT_KEY);
    if (stored === "accountant" || stored === "owner") intent = stored;
    const n = sessionStorage.getItem(GOOGLE_NEXT_KEY);
    if (n && n.startsWith("/")) next = n;
    sessionStorage.removeItem(GOOGLE_INTENT_KEY);
    sessionStorage.removeItem(GOOGLE_NEXT_KEY);
  } catch {
    /* ignore */
  }
  if (!intent) {
    try {
      intent = readIntentCookie(document.cookie);
    } catch {
      /* ignore */
    }
  }
  writeIntentCookie(null);
  if (intent) setPortalIntent(intent);
  return { intent, next };
}

/**
 * When the door was lost in transit, the account itself is the tiebreak:
 * a business workspace means owner; only a practice role or firm means
 * accountant; a brand-new account defaults to owner (the landing page is the
 * only Google button a stranger can reach).
 */
export function inferGoogleIntentFromRoles(d: {
  hasClientRole: boolean;
  hasPracticeRole: boolean;
  hasFirm: boolean;
}): GoogleAuthIntent {
  if (d.hasClientRole) return "owner";
  if (d.hasPracticeRole || d.hasFirm) return "accountant";
  return "owner";
}

export async function startGoogleSignIn(opts: {
  intent: GoogleAuthIntent;
  next?: string;
  /** Owner-invite in flight — survive the OAuth hop and redeem after Google. */
  ownerInvite?: { token: string; clientCode?: string | null };
  /** Owner→accountant invite — return to /join/:token after Google. */
  accountantJoin?: { token: string };
}): Promise<{ error?: string }> {
  let next = opts.next;
  const hop: GoogleOAuthHop = {};
  if (opts.ownerInvite?.token) {
    const { stashPendingOwnerInvite, ownerInviteLandingPath } = await import("@/lib/invite-handoff");
    stashPendingOwnerInvite(opts.ownerInvite.token, opts.ownerInvite.clientCode);
    if (!next) next = ownerInviteLandingPath(opts.ownerInvite.token);
    hop.token = opts.ownerInvite.token;
    hop.clientCode = opts.ownerInvite.clientCode;
  } else if (opts.accountantJoin?.token) {
    const { accountantInviteLandingPath } = await import("@/lib/accountant-invite");
    hop.join = opts.accountantJoin.token.trim();
    if (!next) next = accountantInviteLandingPath(hop.join);
  } else {
    const { peekPendingCheckout, billingStartPath } = await import("@/lib/pending-checkout");
    const pending = peekPendingCheckout();
    if (pending) {
      hop.checkout = pending.plan;
      hop.market = pending.market;
      if (!next) next = billingStartPath(pending);
    }
  }
  stashGoogleAuthIntent(opts.intent, next);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: googleOAuthRedirectTo(window.location.origin, hop),
      queryParams: {
        access_type: "offline",
        prompt: "select_account",
      },
    },
  });
  if (error) return { error: humanizeOAuthError(error.message) };
  return {};
}

export async function establishSessionFromOAuthCallback(): Promise<{ error?: string }> {
  const parsed = parseOAuthCallbackParams(window.location.search, window.location.hash);
  if (parsed.error) return { error: humanizeOAuthError(parsed.error) };

  if (parsed.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (error) return { error: humanizeOAuthError(error.message) };
    return {};
  }

  for (let i = 0; i < 12; i++) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return {};
    await new Promise((r) => setTimeout(r, 80));
  }
  return { error: "Google sign-in did not complete. Please try again." };
}
