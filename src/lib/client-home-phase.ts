/**
 * Accountant client Home. The three agent cards paint while the row is
 * still in flight, and a hung read becomes an error instead of a spinner.
 * The tax card uses the stored country only.
 */

export type ClientHomePhase = "loading" | "error" | "missing" | "ready";

export const CLIENT_HOME_CHECKING = "Checking this client.";
export const CLIENT_HOME_LOAD_ERROR = "Couldn't load this client. Refresh to try again.";
export const CLIENT_HOME_NOTHING = "Nothing on file yet.";

export function clientHomePhase(input: {
  loading: boolean;
  timedOut: boolean;
  hasClient: boolean;
}): ClientHomePhase {
  if (input.hasClient) return "ready";
  if (input.timedOut) return "error";
  if (input.loading) return "loading";
  return "missing";
}

/**
 * A new tab keeps the loading state until the session user is on the page.
 * An empty row before that is not "Client not found".
 */
export function clientAccessGate(input: {
  authLoading: boolean;
  sessionUserId: string | null;
  loading: boolean;
  timedOut: boolean;
  hasClient: boolean;
}): ClientHomePhase {
  if (input.authLoading || !input.sessionUserId) return "loading";
  return clientHomePhase({
    loading: input.loading,
    timedOut: input.timedOut,
    hasClient: input.hasClient,
  });
}

/** The team stays on screen for a slow or failed row. A missing client does not. */
export function clientAgentCardsVisible(phase: ClientHomePhase): boolean {
  return phase === "loading" || phase === "error" || phase === "ready";
}
