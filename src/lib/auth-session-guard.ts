/**
 * A null session from onAuthStateChange is not a sign-out.
 * GoTrue emits one for INITIAL_SESSION before storage is read, and a refresh
 * that loses a race can report an empty session without the user signing out.
 */

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
export function shouldRedirectToAuth(input: {
  loading: boolean;
  hasUser: boolean;
  restoreFailed: boolean;
}): boolean {
  if (input.restoreFailed || input.loading || input.hasUser) return false;
  return true;
}
