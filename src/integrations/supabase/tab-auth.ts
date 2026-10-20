import { processLock } from "@supabase/auth-js";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";
import { createSharedAuthStorage, shareAuthToken } from "@/lib/stored-auth-session";
import { createRefreshCoordinator, refreshTokenFromRequest, type RefreshBus } from "./refresh-flight";

/**
 * Share the Supabase session across tabs, and keep the refresh single-flight.
 *
 * GoTrue's BroadcastChannel is still suppressed. That channel applied
 * SIGNED_IN / SIGNED_OUT from one tab onto every other tab, which is why
 * signing in as one account replaced the session everywhere.
 *
 * The auth token itself lives in localStorage. A new tab (Ctrl+T, middle-click)
 * has empty sessionStorage, so a session that existed only there looked like
 * a sign-out. Reading the token does not take the refresh lock. The PKCE
 * verifier stays in sessionStorage for the tab that started the login.
 */

/** Matches supabase-js default: `sb-<project-ref>-auth-token`. */
export function supabaseAuthStorageKey(supabaseUrl: string): string {
  try {
    const host = new URL(supabaseUrl).hostname;
    const ref = host.split(".")[0];
    if (ref) return `sb-${ref}-auth-token`;
  } catch {
    /* invalid URL */
  }
  return "sb-auth-token";
}

export function tabAuthStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return createSharedAuthStorage(window.localStorage, window.sessionStorage);
  } catch {
    return undefined;
  }
}

/**
 * Copy the newest auth token into localStorage and this tab's sessionStorage.
 * A new tab reads localStorage. The shared token is not removed.
 */
export function shareAuthSession(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    shareAuthToken(window.localStorage, window.sessionStorage, storageKey);
  } catch {
    /* private mode / blocked storage */
  }
}

/** @deprecated Use shareAuthSession. Kept so older call sites still publish. */
export function adoptSharedAuthSession(storageKey: string): void {
  shareAuthSession(storageKey);
}

/**
 * GoTrue allows a second refresh of the same session when it lands inside
 * `security.refresh_token_reuse_interval`. Supabase's hosted default is 10
 * seconds. Inside that window the server returns the current refresh token
 * and does not call LogoutSession. A gap at or past the window, with rotation
 * on, revokes the session.
 *
 * auth-js 2.74 posts `/token?grant_type=refresh_token` once per caller
 * (`_refreshAccessToken`). Per-tab processLock does not cross tabs, so two
 * tabs can refresh one token. A gap at or past the reuse window revokes it.
 * coordinatedAuthFetch lets one tab post that grant and the others reuse the
 * successor. This client does not change the server interval.
 */
export const REFRESH_TOKEN_REUSE_INTERVAL_MS = 10_000;

/** True when two refreshes of one session are still inside the reuse window. */
export function concurrentRefreshKeepsSession(
  gapMs: number,
  intervalMs = REFRESH_TOKEN_REUSE_INTERVAL_MS,
): boolean {
  return Number.isFinite(gapMs) && gapMs >= 0 && gapMs < intervalMs;
}

/**
 * Per-tab in-memory lock. `processLock` keeps its queue in this JavaScript
 * realm, so another tab does not wait on it. supabase-js calls the lock with
 * acquireTimeout -1 (wait forever). Cap that wait at the shell deadline so a
 * stuck holder cannot pin a query or a server-function auth read.
 *
 * The cap is outside processLock. A positive acquireTimeout inside processLock
 * leaves the timeout promise unhandled once the lock is acquired, and a
 * negative timeout never fires. Callers that give up still leave their
 * critical section queued; it runs when the holder releases and does not
 * block the caller past the deadline.
 */
export function tabAuthLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  if (acquireTimeout === 0) return processLock(name, 0, fn);
  const wait =
    acquireTimeout < 0 ? SHELL_GATE_TIMEOUT_MS : Math.min(acquireTimeout, SHELL_GATE_TIMEOUT_MS);
  let acquired = false;
  const run = processLock(name, -1, async () => {
    acquired = true;
    return fn();
  });
  return new Promise<R>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (acquired) return;
      const err = new Error(`Acquiring process lock with name "${name}" timed out`);
      (err as { isAcquireTimeout?: boolean }).isAcquireTimeout = true;
      reject(err);
    }, wait);
    void run.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

let refreshFlight: ReturnType<typeof createRefreshCoordinator> | undefined;
let refreshBus: RefreshBus | undefined;

function browserTabId(): string {
  const key = "milon-tab-id";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return `tab-${Math.random().toString(36).slice(2)}`;
  }
}

function browserRefreshBus(): RefreshBus {
  if (refreshBus) return refreshBus;
  const channel = new BroadcastChannel("milon-auth-refresh");
  refreshBus = {
    post: (msg) => channel.postMessage(msg),
    subscribe: (fn) => {
      const handler = (event: MessageEvent) => fn(event.data as Parameters<typeof fn>[0]);
      channel.addEventListener("message", handler);
      return () => channel.removeEventListener("message", handler);
    },
  };
  return refreshBus;
}

/**
 * Wraps fetch so only one tab posts a given refresh token. Other grants pass
 * through. The channel opens on the first refresh, not during createClient,
 * so GoTrue's own BroadcastChannel stays suppressed.
 */
export function coordinatedAuthFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = refreshTokenFromRequest(input, init);
  if (!token || typeof window === "undefined") return fetch(input, init);
  if (!refreshFlight) {
    refreshFlight = createRefreshCoordinator({
      tabId: browserTabId(),
      bus: browserRefreshBus(),
      storage: window.localStorage,
      lock: (name, fn) => tabAuthLock(name, -1, fn),
    });
  }
  return refreshFlight.refresh(token, () => fetch(input, init));
}

/**
 * GoTrue constructs `new BroadcastChannel(storageKey)` whenever
 * persistSession is on. There is no public flag to disable it in supabase-js
 * 2.74, so hide the constructor for createClient() only.
 */
export function withoutAuthBroadcast<T>(create: () => T): T {
  const g = globalThis as { BroadcastChannel?: typeof BroadcastChannel };
  const Original = g.BroadcastChannel;
  if (!Original) return create();
  try {
    g.BroadcastChannel = undefined;
    return create();
  } finally {
    g.BroadcastChannel = Original;
  }
}
