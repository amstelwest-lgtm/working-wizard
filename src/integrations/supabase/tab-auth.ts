/**
 * Isolate the browser Supabase session to the current tab.
 *
 * GoTrue persists to localStorage by default and also opens a BroadcastChannel
 * named after `storageKey`. Other tabs then apply SIGNED_IN / SIGNED_OUT /
 * TOKEN_REFRESHED from that channel — even if storage is sessionStorage —
 * which is why signing in as one account replaced the session in every Milōn
 * tab on the same computer.
 *
 * sessionStorage survives refresh of this tab, is not shared with a newly
 * opened tab, and still holds the PKCE code verifier across the Google
 * redirect (same tab, same origin). Invite cookies in google-auth /
 * invite-handoff are unchanged.
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
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function moveItem(from: Storage, to: Storage, key: string): void {
  const value = from.getItem(key);
  if (value == null) return;
  if (to.getItem(key) == null) to.setItem(key, value);
  from.removeItem(key);
}

/**
 * One-time: this tab keeps the previously shared localStorage session, then
 * the shared copy is removed so a second tab cannot inherit the same refresh
 * token (rotation in one tab would revoke the other).
 */
export function adoptSharedAuthSession(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    const local = window.localStorage;
    const session = window.sessionStorage;
    moveItem(local, session, storageKey);
    moveItem(local, session, `${storageKey}-code-verifier`);
  } catch {
    /* private mode / blocked storage */
  }
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
