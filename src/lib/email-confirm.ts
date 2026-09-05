/**
 * Email-confirmation landing: exchange the Supabase link, then send the
 * user to the board they signed up for — never dump them onto /app or
 * /dashboard while the session is still being established.
 */
import { supabase } from "@/integrations/supabase/client";
import { parseMarketSelection, type MarketSelection } from "@/lib/market";
import { isPracticeSignupMeta } from "@/lib/user-roles";

export const EMAIL_CONFIRM_PATH = "/confirm";

export type EmailConfirmParams = {
  code?: string;
  tokenHash?: string;
  type?: string;
  error?: string;
};

export function parseEmailConfirmParams(search: string, hash: string): EmailConfirmParams {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const error =
    q.get("error_description") || q.get("error") || h.get("error_description") || h.get("error");
  const code = q.get("code") || h.get("code") || undefined;
  const tokenHash = q.get("token_hash") || h.get("token_hash") || undefined;
  const type = q.get("type") || h.get("type") || undefined;
  return {
    ...(code ? { code } : {}),
    ...(tokenHash ? { tokenHash } : {}),
    ...(type ? { type } : {}),
    ...(error ? { error } : {}),
  };
}

export function hasAuthRedirectParams(search: string, hash: string): boolean {
  const p = parseEmailConfirmParams(search, hash);
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return Boolean(p.code || p.tokenHash || p.error || p.type || h.get("access_token"));
}

/** Paths that already consume the auth redirect themselves. */
const AUTH_CONSUMERS = new Set([EMAIL_CONFIRM_PATH, "/auth/callback", "/reset-password"]);

export function shouldForwardToConfirm(pathname: string, search: string, hash: string): boolean {
  if (AUTH_CONSUMERS.has(pathname)) return false;
  return hasAuthRedirectParams(search, hash);
}

export function confirmUrlFromLocation(
  origin: string,
  search: string,
  hash: string,
): string {
  return `${origin.replace(/\/$/, "")}${EMAIL_CONFIRM_PATH}${search}${hash}`;
}

export function humanizeConfirmError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("expired") || s.includes("otp_expired")) {
    return "This confirmation link has expired. Request a new one from the sign-in page.";
  }
  if (s.includes("already") || s.includes("verified")) {
    return "This email is already confirmed. Sign in to open your workspace.";
  }
  if (s.includes("invalid") || s.includes("otp_disabled") || s.includes("token")) {
    return "This confirmation link is invalid or has already been used.";
  }
  return raw;
}

export function destinationAfterConfirm(
  meta: Record<string, unknown> | null | undefined,
  type?: string,
): "/app" | "/dashboard" | "/reset-password" {
  if (type === "recovery") return "/reset-password";
  if (isPracticeSignupMeta(meta)) return "/dashboard";
  return "/app";
}

export function marketFromSignupMeta(
  meta: Record<string, unknown> | null | undefined,
): MarketSelection | null {
  if (!meta) return null;
  return parseMarketSelection({
    country: meta.market_country,
    regionCode: meta.market_region ?? null,
  });
}

export function ownerDisplayName(
  meta: Record<string, unknown> | null | undefined,
  email?: string | null,
): string {
  const business = typeof meta?.business_name === "string" ? meta.business_name.trim() : "";
  const full = typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  const name = typeof meta?.name === "string" ? meta.name.trim() : "";
  return business || full || name || email?.split("@")[0]?.trim() || "My Business";
}

export async function establishSessionFromEmailRedirect(): Promise<{
  error?: string;
  type?: string;
}> {
  const parsed = parseEmailConfirmParams(window.location.search, window.location.hash);
  if (parsed.error) return { error: humanizeConfirmError(parsed.error), type: parsed.type };

  if (parsed.tokenHash && parsed.type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: parsed.tokenHash,
      type: parsed.type as "signup" | "invite" | "magiclink" | "recovery" | "email",
    });
    if (error) return { error: humanizeConfirmError(error.message), type: parsed.type };
    return { type: parsed.type };
  }

  if (parsed.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (error) return { error: humanizeConfirmError(error.message), type: parsed.type };
    return { type: parsed.type };
  }

  for (let i = 0; i < 16; i++) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return { type: parsed.type };
    await new Promise((r) => setTimeout(r, 80));
  }
  return {
    error: "We couldn't confirm this link. It may have expired — request a new one from the sign-in page.",
    type: parsed.type,
  };
}
