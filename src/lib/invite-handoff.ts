/**
 * Client-side helpers for SME invite accept → founder board.
 * Keep this module free of React so tests can import it from vite-node.
 */
import { supabase } from "@/integrations/supabase/client";

export const PENDING_INVITE_CLIENT_KEY = "pending_invite_client_id";
export const INVITE_ACCEPT_HANDOFF_KEY = "milon_invite_accept_handoff";
/** Survives the Google OAuth round trip (sessionStorage + apex cookie). */
export const PENDING_OWNER_INVITE_KEY = "milon_pending_owner_invite";
export const PENDING_OWNER_INVITE_COOKIE = "milon_owner_invite";
const OWNER_INVITE_COOKIE_MAX_AGE_S = 15 * 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isClientUuid(value: string | null | undefined): boolean {
  return Boolean(value && UUID_RE.test(value.trim()));
}

export type PendingOwnerInvite = {
  token: string;
  clientCode: string | null;
};

/** Invite claim links: `/?invite=<token>&mode=signup`. */
export function pendingInviteTokenFromSearch(search: string): string | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const inv = params.get("invite")?.trim() ?? "";
  if (inv && params.get("mode") === "signup") return inv;
  return null;
}

export function ownerInviteLandingPath(token: string): string {
  return `/?invite=${encodeURIComponent(token)}&mode=signup`;
}

/** Read `/?invite=&mode=signup` out of a Google `next` path. */
export function ownerInviteTokenFromNext(next: string | undefined): string | null {
  if (!next || !next.startsWith("/")) return null;
  const q = next.indexOf("?");
  if (q === -1) return null;
  return pendingInviteTokenFromSearch(next.slice(q));
}

/**
 * Invite carried on `/auth/callback?invite=&cc=` (OAuth redirectTo).
 * `cc` is the client code — never `code`, which is the PKCE query param.
 */
export function ownerInviteFromCallbackSearch(search: string): PendingOwnerInvite | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const token = params.get("invite")?.trim() ?? "";
  if (!token) return null;
  const clientCode = params.get("cc")?.trim() || null;
  return { token, clientCode };
}

/**
 * Google round-trip: URL (redirectTo) wins, then storage/cookie, then `next`.
 * Merge a missing client code from storage so an origin hop that kept the
 * token but dropped `cc` still redeems.
 */
export function resolvePendingOwnerInvite(opts: {
  callbackSearch?: string;
  next?: string;
  stored?: PendingOwnerInvite | null;
}): PendingOwnerInvite | null {
  const fromUrl = opts.callbackSearch ? ownerInviteFromCallbackSearch(opts.callbackSearch) : null;
  const stored = opts.stored?.token ? opts.stored : null;
  const fromNext = ownerInviteTokenFromNext(opts.next);
  const token = fromUrl?.token || stored?.token || fromNext;
  if (!token) return null;
  const clientCode =
    fromUrl?.clientCode ||
    (stored && stored.token === token ? stored.clientCode : null) ||
    null;
  return { token, clientCode };
}

export function encodePendingOwnerInvite(value: PendingOwnerInvite): string {
  const code = value.clientCode?.trim() ?? "";
  return code ? `${value.token}|${code}` : value.token;
}

export function decodePendingOwnerInvite(raw: string | null | undefined): PendingOwnerInvite | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const bar = s.indexOf("|");
  if (bar === -1) return { token: s, clientCode: null };
  const token = s.slice(0, bar).trim();
  const clientCode = s.slice(bar + 1).trim();
  if (!token) return null;
  return { token, clientCode: clientCode || null };
}

function inviteCookieDomain(hostname: string): string | undefined {
  const h = hostname.trim().toLowerCase();
  if (!h || h === "localhost" || /^[\d.]+$/.test(h) || /^\[?[0-9a-f:]+\]?$/.test(h)) {
    return undefined;
  }
  if (!h.includes(".")) return undefined;
  return h.replace(/^www\./, "");
}

export function pendingOwnerInviteCookieString(
  value: PendingOwnerInvite | null,
  hostname: string,
  secure: boolean,
): string {
  const domain = inviteCookieDomain(hostname);
  const parts = [
    `${PENDING_OWNER_INVITE_COOKIE}=${value ? encodeURIComponent(encodePendingOwnerInvite(value)) : ""}`,
    "Path=/",
    `Max-Age=${value ? OWNER_INVITE_COOKIE_MAX_AGE_S : 0}`,
    "SameSite=Lax",
  ];
  if (domain) parts.push(`Domain=${domain}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readPendingOwnerInviteCookie(cookieHeader: string): PendingOwnerInvite | null {
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== PENDING_OWNER_INVITE_COOKIE) continue;
    return decodePendingOwnerInvite(decodeURIComponent(rest.join("=").trim()));
  }
  return null;
}

export function stashPendingOwnerInvite(token: string, clientCode?: string | null): void {
  const value: PendingOwnerInvite = { token: token.trim(), clientCode: clientCode?.trim() || null };
  if (!value.token) return;
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PENDING_OWNER_INVITE_KEY, encodePendingOwnerInvite(value));
  } catch {
    /* private mode / SSR */
  }
  try {
    document.cookie = pendingOwnerInviteCookieString(
      value,
      window.location.hostname,
      window.location.protocol === "https:",
    );
  } catch {
    /* cookies disabled */
  }
}

export function peekPendingOwnerInvite(): PendingOwnerInvite | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = decodePendingOwnerInvite(sessionStorage.getItem(PENDING_OWNER_INVITE_KEY));
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  try {
    return readPendingOwnerInviteCookie(document.cookie);
  } catch {
    return null;
  }
}

export function consumePendingOwnerInvite(): PendingOwnerInvite | null {
  const value = peekPendingOwnerInvite();
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(PENDING_OWNER_INVITE_KEY);
    } catch {
      /* ignore */
    }
    try {
      document.cookie = pendingOwnerInviteCookieString(
        null,
        window.location.hostname,
        window.location.protocol === "https:",
      );
    } catch {
      /* ignore */
    }
  }
  return value;
}

/** Prefer the just-redeemed workspace over any older client the user already owns. */
export function preferPendingInviteClient(opts: {
  pendingClientId: string | null | undefined;
  linkedClientId: string | null | undefined;
}): string | null {
  if (isClientUuid(opts.pendingClientId)) return opts.pendingClientId!.trim();
  return opts.linkedClientId?.trim() || null;
}

export function isEmailAlreadyRegistered(message: string): boolean {
  return /already (been )?registered|already exists|user already/i.test(message);
}

export function stashInviteHandoff(clientId: string | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(INVITE_ACCEPT_HANDOFF_KEY, "1");
    if (clientId && isClientUuid(clientId)) {
      localStorage.setItem(PENDING_INVITE_CLIENT_KEY, clientId.trim());
    }
  } catch {
    /* private browsing / quota */
  }
}

export function consumeInviteHandoffFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const on = sessionStorage.getItem(INVITE_ACCEPT_HANDOFF_KEY) === "1";
    if (on) sessionStorage.removeItem(INVITE_ACCEPT_HANDOFF_KEY);
    return on;
  } catch {
    return false;
  }
}

export function hasInviteHandoffFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(INVITE_ACCEPT_HANDOFF_KEY) === "1";
  } catch {
    return false;
  }
}

/** Strip `invite` / `mode=signup` so a bounce back to `/` cannot trap the form. */
export function clearInviteQueryFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("invite") && url.searchParams.get("mode") !== "signup") return;
  url.searchParams.delete("invite");
  url.searchParams.delete("mode");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next);
}

/**
 * signInWithPassword can return before React auth state updates. /app used to
 * see `user === null` and bounce back to the landing invite form.
 */
export async function waitForAuthSession(timeoutMs = 8000): Promise<void> {
  const { data: immediate } = await supabase.auth.getSession();
  if (immediate.session?.user) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscription: { unsubscribe: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (ok: boolean, err?: Error) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      try {
        subscription?.unsubscribe();
      } catch {
        /* listener may fire before the subscription handle is assigned */
      }
      if (ok) resolve();
      else reject(err ?? new Error("Sign-in timed out. Try Sign in on the landing page."));
    };

    timer = setTimeout(() => finish(false), timeoutMs);
    try {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) finish(true);
      });
      subscription = data.subscription;
      if (settled) {
        try {
          subscription.unsubscribe();
        } catch {
          /* already finished during subscribe */
        }
      }
    } catch (err) {
      finish(false, err instanceof Error ? err : new Error("Sign-in failed"));
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) finish(true);
    });
  });
}
