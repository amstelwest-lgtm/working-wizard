/**
 * Client-side helpers for SME invite accept → founder board.
 * Keep this module free of React so tests can import it from vite-node.
 */
import { supabase } from "@/integrations/supabase/client";

export const PENDING_INVITE_CLIENT_KEY = "pending_invite_client_id";
export const INVITE_ACCEPT_HANDOFF_KEY = "milon_invite_accept_handoff";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isClientUuid(value: string | null | undefined): boolean {
  return Boolean(value && UUID_RE.test(value.trim()));
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
