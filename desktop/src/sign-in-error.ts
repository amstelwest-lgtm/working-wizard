export const SIGN_IN_TIMEOUT_MS = 15_000;

const UNREACHABLE = "Can't reach Milōn. Check your connection and try again.";
const WRONG_PASSWORD = "Wrong email or password.";
const MISCONFIGURED = "This app is missing its Milōn sign-in configuration.";

export type SignInFailure = {
  message?: string;
  name?: string;
  status?: number;
  code?: string;
};

/** True when the baked public URL and anon key look like a real Supabase client config. */
export function desktopAuthConfigOk(url: string, anonKey: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (!parsed.hostname.endsWith(".supabase.co")) return false;
    if (parsed.username !== "" || parsed.password !== "") return false;
  } catch {
    return false;
  }
  const parts = anonKey.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      role?: unknown;
      exp?: unknown;
    };
    return payload.role === "anon" && typeof payload.exp === "number" && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

/** Plain copy for the sign-in form. Never returns the raw server text. */
export function signInUserMessage(failure: SignInFailure | null | undefined): string {
  const code = failure?.code ?? "";
  const name = failure?.name ?? "";
  const message = failure?.message ?? "";
  if (code === "config") return MISCONFIGURED;
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) return WRONG_PASSWORD;
  if (code === "email_not_confirmed") return "Confirm your email, then sign in.";
  if (/encrypt/i.test(message)) return "This PC can't encrypt the Milōn session. The password was not saved.";
  if (
    name === "AuthRetryableFetchError" ||
    name === "AbortError" ||
    failure?.status === 0 ||
    (typeof failure?.status === "number" && failure.status >= 500) ||
    /abort|timeout|network|fetch|enotfound|econn|socket/i.test(message)
  ) {
    return UNREACHABLE;
  }
  if (!failure) return UNREACHABLE;
  return "Could not sign in.";
}

function safeName(value: string): string {
  return /^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(value) ? value : "Error";
}

function safeCode(value: string): string {
  return /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : "";
}

/** One console line for a failed password grant. Name and code only. */
export function redactedSignInFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  let code = "";
  if (error && typeof error === "object" && "code" in error) {
    const value = (error as { code?: unknown }).code;
    if (typeof value === "string" || typeof value === "number") code = String(value);
  }
  return `[milon-desktop] sign-in name=${safeName(name)} code=${safeCode(code)}`;
}
