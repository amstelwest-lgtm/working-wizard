/**
 * The Supabase session is shared across tabs via localStorage.
 * sessionStorage alone is empty in a new tab (Ctrl+T, middle-click), so that
 * tab looked signed out. The PKCE verifier stays on the tab that started login.
 */

export type StoredAuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user?: { id?: string | null } | null;
};

/** `sb-<project-ref>-auth-token`, not the per-tab code verifier. */
export function isSharedAuthTokenKey(key: string): boolean {
  return key.startsWith("sb-") && key.endsWith("-auth-token");
}

export function parseStoredAuthSession(raw: string | null): StoredAuthSession | null {
  if (!raw || raw === "null") return null;
  try {
    const parsed = JSON.parse(raw) as StoredAuthSession;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.access_token !== "string" || !parsed.access_token) return null;
    if (typeof parsed.refresh_token !== "string" || !parsed.refresh_token) return null;
    const id = parsed.user?.id;
    if (typeof id !== "string" || !id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function expiresAt(session: StoredAuthSession | null): number {
  const value = Number(session?.expires_at);
  return Number.isFinite(value) ? value : 0;
}

/** Newest stored session across localStorage and this tab's sessionStorage. */
export function readStoredAuthSession(
  local: Storage | undefined,
  session: Storage | undefined,
): StoredAuthSession | null {
  let best: StoredAuthSession | null = null;
  for (const store of [local, session]) {
    if (!store) continue;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !isSharedAuthTokenKey(key)) continue;
      const parsed = parseStoredAuthSession(store.getItem(key));
      if (!parsed) continue;
      if (!best || expiresAt(parsed) >= expiresAt(best)) best = parsed;
    }
  }
  return best;
}

/**
 * Publish this tab's session into localStorage and mirror the shared copy
 * back. Does not delete the shared token. A legacy PKCE verifier in
 * localStorage moves onto this tab and is removed from the shared store.
 */
export function shareAuthToken(local: Storage, session: Storage, storageKey: string): void {
  const localRaw = local.getItem(storageKey);
  const sessionRaw = session.getItem(storageKey);
  const localParsed = parseStoredAuthSession(localRaw);
  const sessionParsed = parseStoredAuthSession(sessionRaw);
  const chosen =
    sessionParsed && localParsed
      ? expiresAt(sessionParsed) > expiresAt(localParsed)
        ? sessionRaw
        : localRaw
      : sessionParsed
        ? sessionRaw
        : localParsed
          ? localRaw
          : null;
  if (chosen) {
    local.setItem(storageKey, chosen);
    session.setItem(storageKey, chosen);
  }
  const verifierKey = `${storageKey}-code-verifier`;
  if (!session.getItem(verifierKey)) {
    const sharedVerifier = local.getItem(verifierKey);
    if (sharedVerifier) session.setItem(verifierKey, sharedVerifier);
  }
  local.removeItem(verifierKey);
}

/**
 * GoTrue storage. The auth token is read from localStorage first so a new tab
 * does not wait on another tab's refresh lock. Writes mirror into
 * sessionStorage. The code verifier is sessionStorage only.
 */
export function createSharedAuthStorage(local: Storage, session: Storage): Storage {
  return {
    get length() {
      return local.length;
    },
    clear() {
      /* GoTrue removes the auth key. Never wipe the rest of localStorage. */
    },
    key(index: number) {
      return local.key(index);
    },
    getItem(key: string) {
      if (isSharedAuthTokenKey(key)) return local.getItem(key) ?? session.getItem(key);
      return session.getItem(key);
    },
    setItem(key: string, value: string) {
      if (!isSharedAuthTokenKey(key)) {
        session.setItem(key, value);
        return;
      }
      local.setItem(key, value);
      try {
        session.setItem(key, value);
      } catch {
        /* private mode */
      }
    },
    removeItem(key: string) {
      if (isSharedAuthTokenKey(key)) {
        local.removeItem(key);
        try {
          session.removeItem(key);
        } catch {
          /* private mode */
        }
        return;
      }
      session.removeItem(key);
    },
  };
}
