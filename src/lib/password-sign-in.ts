/**
 * Password grant failures from `signInWithPassword`.
 *
 * GoTrue answers a wrong password with HTTP 400 `{ code: "invalid_credentials" }`
 * and the client returns `{ data: { user: null, session: null }, error }`.
 * It does not throw. A handler that only catches exceptions, or that toasts
 * `error.message` and then clears the button, leaves the form looking idle.
 */

export const INVALID_CREDENTIALS_MESSAGE = "Email or password is incorrect.";

export const EMAIL_NOT_CONFIRMED_MESSAGE =
  "Confirm your email before signing in. Open the link we sent you, then try again.";

export const RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Wait a moment and try again.";

export const NETWORK_SIGN_IN_MESSAGE =
  "We couldn't reach the sign-in service. Check your connection and try again.";

export const GENERIC_SIGN_IN_MESSAGE = "Couldn't sign in. Try again.";

export type PasswordSignInFailureKind =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "network"
  | "other";

export type PasswordSignInFailure = {
  kind: PasswordSignInFailureKind;
  message: string;
};

function readString(error: unknown, key: string): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>).status;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return (
    readString(error, "message") ||
    readString(error, "msg") ||
    readString(error, "error_description") ||
    readString(error, "error")
  );
}

/** Map a thrown error or a returned `{ error }` value to copy for the form. */
export function explainPasswordSignInFailure(error: unknown): PasswordSignInFailure {
  const code = readString(error, "code") || readString(error, "error_code");
  const message = readMessage(error);
  const status = readStatus(error);
  const name = error instanceof Error ? error.name : readString(error, "name");

  if (
    code === "invalid_credentials" ||
    /invalid login credentials/i.test(message) ||
    /invalid_credentials/i.test(message)
  ) {
    return { kind: "invalid_credentials", message: INVALID_CREDENTIALS_MESSAGE };
  }

  if (
    code === "email_not_confirmed" ||
    /email not confirmed/i.test(message) ||
    /not confirmed/i.test(message)
  ) {
    return { kind: "email_not_confirmed", message: EMAIL_NOT_CONFIRMED_MESSAGE };
  }

  if (
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    status === 429 ||
    /rate limit/i.test(message) ||
    /too many requests/i.test(message)
  ) {
    return { kind: "rate_limited", message: RATE_LIMITED_MESSAGE };
  }

  if (
    name === "AuthRetryableFetchError" ||
    status === 0 ||
    error instanceof TypeError ||
    /failed to fetch/i.test(message) ||
    /networkerror/i.test(message) ||
    /network request failed/i.test(message) ||
    /load failed/i.test(message) ||
    /fetch failed/i.test(message)
  ) {
    return { kind: "network", message: NETWORK_SIGN_IN_MESSAGE };
  }

  const readable = message.trim();
  return {
    kind: "other",
    message: readable && readable.length <= 180 ? readable : GENERIC_SIGN_IN_MESSAGE,
  };
}

/**
 * Read the `{ error }` return from `signInWithPassword`.
 * `null` means the grant succeeded (the caller must still check `data`).
 */
export function passwordGrantFailure(
  result: { error?: unknown } | null | undefined,
): PasswordSignInFailure | null {
  if (!result?.error) return null;
  return explainPasswordSignInFailure(result.error);
}
