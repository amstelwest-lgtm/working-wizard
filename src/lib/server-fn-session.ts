/**
 * Server functions (`/_serverFn/*`) 401 when the bearer token is missing or
 * expired. The client page fires getXeroStatus, getQboStatus,
 * listClientReviewSignoffs, and listBudgetMonthActuals as soon as it mounts.
 * AuthProvider can already show a signed-in user while getSession() still
 * returns null, or while the stored access token is past `exp`.
 * Wait for the local session, refresh once if it is stale, and let the caller
 * retry the function once. No toast.
 */
import type { Session, SupabaseClient } from "@supabase/supabase-js";

export function isServerFnUnauthorized(error: unknown): boolean {
  if (error == null || error === false) return false;
  if (
    typeof error === "object" &&
    error &&
    "status" in error &&
    (error as { status?: unknown }).status === 401
  ) {
    return true;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : String(error);
  return /\b401\b|Unauthorized: No authorization header|Unauthorized: Invalid token|Not authenticated/i.test(
    message,
  );
}

/** True when the JWT `exp` is missing-or-past, with a few seconds of skew. */
export function accessTokenExpired(token: string, nowMs = Date.now(), skewMs = 30_000): boolean {
  try {
    const part = token.split(".")[1];
    if (!part) return false;
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
    if (typeof json.exp !== "number") return false;
    return json.exp * 1000 <= nowMs + skewMs;
  } catch {
    return false;
  }
}

type AuthLike = Pick<SupabaseClient, "auth">;

function waitForAccessToken(auth: AuthLike["auth"], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.unsubscribe();
      resolve(token);
    };
    const { data: subscription } = auth.onAuthStateChange((_event, session) => {
      const token = session?.access_token;
      if (token) finish(token);
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * Local session token for the server-fn bearer header.
 * One refresh when the stored token is expired. One wait when the session
 * has not been restored yet.
 */
export async function ensureFreshAccessToken(
  supabase: AuthLike,
  opts?: { forceRefresh?: boolean; waitMs?: number },
): Promise<string | null> {
  const first = await supabase.auth.getSession();
  let session: Session | null = first.data.session;
  if (!session?.access_token) {
    const waited = await waitForAccessToken(supabase.auth, opts?.waitMs ?? 2_000);
    if (!waited) return null;
    const again = await supabase.auth.getSession();
    session = again.data.session ?? session;
    if (!session?.access_token) return waited;
  }
  const stale = opts?.forceRefresh || accessTokenExpired(session.access_token);
  if (!stale) return session.access_token;
  const refreshed = await supabase.auth.refreshSession();
  return refreshed.data.session?.access_token ?? session.access_token;
}

/** Run a server function. On a 401, refresh once and try the same call again. */
export async function callAuthedServerFn<T>(supabase: AuthLike, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isServerFnUnauthorized(error)) throw error;
    const token = await ensureFreshAccessToken(supabase, { forceRefresh: true });
    if (!token) throw error;
    return await run();
  }
}
