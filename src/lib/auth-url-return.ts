/**
 * Supabase falls back to the Site URL when /auth/callback is not on the
 * redirect allowlist. The browser then opens
 * https://www.milonfinance.com/#access_token=…&refresh_token=…&type=magiclink
 * and the marketing bundle never starts the auth client, so the hash stays.
 *
 * This parser is the landing-page (and every other route) pickup. The React
 * mount strips the hash and calls setSession or exchangeCodeForSession.
 */

export const AUTH_LINK_EXPIRED = "That link has expired. Send a new one.";

export const EMAIL_RETURN_COOKIE = "milon_email_return";
const EMAIL_RETURN_MAX_AGE_S = 10 * 60;

export type AuthReturnDoor = "accountant" | "owner";

export type AuthReturnType = "magiclink" | "recovery" | "signup" | "email";

const AUTH_TYPES = new Set<AuthReturnType>(["magiclink", "recovery", "signup", "email"]);

const AUTH_PARAM_KEYS = [
  "access_token",
  "refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "provider_token",
  "provider_refresh_token",
  "type",
  "code",
  "token_hash",
  "error",
  "error_code",
  "error_description",
] as const;

export type AuthUrlSession =
  | {
      kind: "error";
      message: string;
    }
  | {
      kind: "session";
      method: "setSession";
      accessToken: string;
      refreshToken: string;
      type: AuthReturnType | null;
      door: AuthReturnDoor | null;
      next: string | null;
    }
  | {
      kind: "session";
      method: "exchangeCodeForSession";
      code: string;
      type: AuthReturnType | null;
      door: AuthReturnDoor | null;
      next: string | null;
    };

export type StoredAuthReturn = {
  door: AuthReturnDoor | null;
  next: string | null;
};

/** /auth/callback and /auth/verified already consume their own URL. */
export function shouldConsumeAuthReturn(pathname: string): boolean {
  let path = pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path !== "/auth/callback" && path !== "/auth/verified";
}

function paramsOf(raw: string, prefix: "?" | "#"): URLSearchParams {
  const text = raw.startsWith(prefix) ? raw.slice(1) : raw;
  return new URLSearchParams(text);
}

function readDoor(raw: string | null): AuthReturnDoor | null {
  if (raw === "accountant" || raw === "owner") return raw;
  return null;
}

export function safeAuthNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    value = raw;
  }
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || value.includes("://")) return null;
  return value;
}

function readType(raw: string | null): AuthReturnType | null {
  const type = (raw ?? "").toLowerCase();
  return AUTH_TYPES.has(type as AuthReturnType) ? (type as AuthReturnType) : null;
}

/**
 * Hash or query left by an implicit magic link, a PKCE code, or an expired link.
 * `stored` is the door/next cookie written when the email was requested.
 */
export function parseAuthUrlReturn(
  search: string,
  hash: string,
  stored?: StoredAuthReturn | null,
): AuthUrlSession | null {
  const q = paramsOf(search, "?");
  const h = paramsOf(hash, "#");
  const door = readDoor(q.get("door") ?? h.get("door")) ?? stored?.door ?? null;
  const next = safeAuthNext(q.get("next") ?? h.get("next")) ?? stored?.next ?? null;
  const errorText = q.get("error_description") || h.get("error_description") || q.get("error") || h.get("error");
  const accessToken = (h.get("access_token") || q.get("access_token") || "").trim();
  const refreshToken = (h.get("refresh_token") || q.get("refresh_token") || "").trim();
  const type = readType(h.get("type") || q.get("type"));
  const code = (q.get("code") || h.get("code") || "").trim();

  if (errorText && !(accessToken && refreshToken)) {
    return { kind: "error", message: AUTH_LINK_EXPIRED };
  }
  if (accessToken && refreshToken) {
    return { kind: "session", method: "setSession", accessToken, refreshToken, type, door, next };
  }
  if (isAuthCode(code)) {
    return { kind: "session", method: "exchangeCodeForSession", code, type, door, next };
  }
  return null;
}

/** PKCE codes are long. Short query values (client codes, promos) are not a session. */
function isAuthCode(code: string): boolean {
  if (code.length < 16) return false;
  if (/^MLN-/i.test(code)) return false;
  return true;
}

export function hrefWithoutAuthReturn(href: string): string {
  const url = new URL(href, "https://milonfinance.com");
  for (const key of AUTH_PARAM_KEYS) url.searchParams.delete(key);
  url.searchParams.delete("door");
  url.searchParams.delete("next");
  const hash = paramsOf(url.hash, "#");
  let hashTouched = false;
  for (const key of AUTH_PARAM_KEYS) {
    if (hash.has(key)) {
      hash.delete(key);
      hashTouched = true;
    }
  }
  if (hash.has("door")) {
    hash.delete("door");
    hashTouched = true;
  }
  if (hash.has("next")) {
    hash.delete("next");
    hashTouched = true;
  }
  url.hash = hashTouched ? (hash.toString() ? `#${hash.toString()}` : "") : url.hash;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Accountant door or a practice role opens the client list.
 * Owner door or an owner role opens /app.
 * A stored next path wins, except a recovery link which always sets a password.
 */
export function pathAfterAuthReturn(input: {
  type: AuthReturnType | null;
  door: AuthReturnDoor | null;
  next: string | null;
  roleDestination: "/practice" | "/app" | "/clients";
}): "/reset-password" | "/clients" | "/app" | string {
  if (input.type === "recovery") return "/reset-password";
  const next = safeAuthNext(input.next);
  if (next) return next;
  if (input.door === "owner") return "/app";
  if (input.door === "accountant") return "/clients";
  return input.roleDestination === "/app" ? "/app" : "/clients";
}

export function emailReturnCookieValue(door: AuthReturnDoor, next?: string | null): string {
  const params = new URLSearchParams();
  params.set("door", door);
  const safe = safeAuthNext(next);
  if (safe) params.set("next", safe);
  return params.toString();
}

export function emailReturnCookieString(
  door: AuthReturnDoor | null,
  next: string | null | undefined,
  hostname: string,
  secure: boolean,
): string {
  const domain = cookieDomain(hostname);
  const value = door ? emailReturnCookieValue(door, next) : "";
  const parts = [
    `${EMAIL_RETURN_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${door ? EMAIL_RETURN_MAX_AGE_S : 0}`,
    "SameSite=Lax",
  ];
  if (domain) parts.push(`Domain=${domain}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Same parent domain as the Google door cookie, so apex and www share the return. */
function cookieDomain(hostname: string): string | undefined {
  const h = hostname.trim().toLowerCase();
  if (!h || h === "localhost" || /^[\d.]+$/.test(h) || /^\[?[0-9a-f:]+\]?$/.test(h)) return undefined;
  if (!h.includes(".")) return undefined;
  return h.replace(/^www\./, "");
}

export function readEmailReturnCookie(cookieHeader: string): StoredAuthReturn {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${EMAIL_RETURN_COOKIE}=`)) continue;
    let raw = trimmed.slice(EMAIL_RETURN_COOKIE.length + 1);
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    const params = new URLSearchParams(raw);
    return {
      door: readDoor(params.get("door")),
      next: safeAuthNext(params.get("next")),
    };
  }
  return { door: null, next: null };
}

export function stashEmailReturn(door: AuthReturnDoor, next?: string | null): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  try {
    document.cookie = emailReturnCookieString(
      door,
      next,
      window.location.hostname,
      window.location.protocol === "https:",
    );
  } catch {
    /* cookies blocked */
  }
}

export function clearEmailReturnCookie(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  try {
    document.cookie = emailReturnCookieString(
      null,
      null,
      window.location.hostname,
      window.location.protocol === "https:",
    );
  } catch {
    /* cookies blocked */
  }
}
