import { supabase } from "@/integrations/supabase/client";
import { setPortalIntent, type PortalIntent } from "@/lib/user-roles";

export const GOOGLE_CALLBACK_PATH = "/auth/callback";
export const GOOGLE_INTENT_KEY = "milon_google_auth_intent";
export const GOOGLE_NEXT_KEY = "milon_google_auth_next";

export type GoogleAuthIntent = PortalIntent;

export function googleOAuthRedirectTo(origin: string): string {
  return `${origin.replace(/\/$/, "")}${GOOGLE_CALLBACK_PATH}`;
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

export function stashGoogleAuthIntent(intent: GoogleAuthIntent, next?: string): void {
  setPortalIntent(intent);
  try {
    sessionStorage.setItem(GOOGLE_INTENT_KEY, intent);
    if (next && next.startsWith("/")) sessionStorage.setItem(GOOGLE_NEXT_KEY, next);
    else sessionStorage.removeItem(GOOGLE_NEXT_KEY);
  } catch {
    /* private mode / SSR */
  }
}

export function consumeGoogleAuthIntent(): { intent: GoogleAuthIntent; next?: string } {
  let intent: GoogleAuthIntent = "owner";
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
  setPortalIntent(intent);
  return { intent, next };
}

export async function startGoogleSignIn(opts: {
  intent: GoogleAuthIntent;
  next?: string;
}): Promise<{ error?: string }> {
  stashGoogleAuthIntent(opts.intent, opts.next);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: googleOAuthRedirectTo(window.location.origin),
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
