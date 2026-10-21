/**
 * A null session from onAuthStateChange is not a sign-out.
 * GoTrue emits one for INITIAL_SESSION before storage is read, and a refresh
 * that loses a race can report an empty session without the user signing out.
 */
import { readStoredAuthSession } from "@/lib/stored-auth-session";

export type AuthStateDecision = "set" | "keep" | "confirm-signed-out";

export function decideAuthStateChange(
  event: string,
  session: { user?: { id?: string | null } | null } | null,
): AuthStateDecision {
  if (session?.user?.id) return "set";
  if (event === "SIGNED_OUT") return "confirm-signed-out";
  return "keep";
}

/** After one getSession retry. A real loss shows the restore panel. */
export function resolveConfirmedSignOut(input: {
  hadSession: boolean;
  intentional: boolean;
  retryHasUser: boolean;
}): "keep" | "panel" | "signed-out" {
  if (input.retryHasUser) return "keep";
  if (input.intentional || !input.hadSession) return "signed-out";
  return "panel";
}

/**
 * Accountant /auth redirect and the owner shell's "leave the app" check.
 * A lost session (restore panel) does not navigate.
 */
function browserStillHasStoredUser(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(
      readStoredAuthSession(window.localStorage, window.sessionStorage)?.user?.id,
    );
  } catch {
    return false;
  }
}

export function shouldRedirectToAuth(input: {
  loading: boolean;
  hasUser: boolean;
  restoreFailed: boolean;
}): boolean {
  if (input.restoreFailed || input.loading || input.hasUser) return false;
  // A new tab's getSession can still be in flight. The stored access token is
  // enough to stay on /clients or /app. Refresh is a separate single-flight.
  if (browserStillHasStoredUser()) return false;
  return true;
}
