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

function isTimeout(failure: SignInFailure): boolean {
  const code = failure.code ?? "";
  const name = failure.name ?? "";
  const message = failure.message ?? "";
  return (
    code === "timeout" ||
    code === "renderer_timeout" ||
    name === "AbortError" ||
    name === "TimeoutError" ||
    /abort|timeout|deadline/i.test(message)
  );
}

/** Keep error text that is safe to show. Drops addresses, URLs, tokens, and digit-bearing secrets. */
export function redactPublic(value: string): string {
  const cleaned = value
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, " ")
    .replace(/https?:\/\/([^/\s?#]+)[^\s]*/gi, " ")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ")
    .replace(/[^A-Za-z0-9:._ -]/g, " ");
  const words = cleaned.split(/\s+/).filter((word) => {
    if (!/^[A-Za-z][A-Za-z0-9:._-]{0,48}$/.test(word)) return false;
    if (/\d/.test(word)) return false;
    return !/secret|password|token|apikey|bearer|eyj/i.test(word);
  });
  return words.join(" ").slice(0, 120);
}

function causeLabel(failure: SignInFailure): string {
  if (typeof failure.status === "number" && failure.status > 0) return `HTTP ${failure.status}`;
  const message = redactPublic(failure.message ?? "");
  const name = failure.name ? safeName(failure.name) : "";
  if (name && message) return `${name}: ${message}`.slice(0, 140);
  if (message) return message;
  if (name) return name;
  return "network";
}

/** Fields off a thrown auth or fetch error. Status is omitted when the throw has none. */
export function signInFailureFromThrown(error: unknown): SignInFailure | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { name?: unknown; message?: unknown; status?: unknown; code?: unknown };
  const failure: SignInFailure = {};
  if (typeof record.name === "string") failure.name = record.name;
  if (typeof record.message === "string") failure.message = record.message;
  if (typeof record.status === "number") failure.status = record.status;
  if (typeof record.code === "string" || typeof record.code === "number") failure.code = String(record.code);
  return failure;
}

/**
 * Plain copy for the sign-in form. The parenthetical is timeout, an HTTP status,
 * or the error name and a redacted message. Never the raw server body.
 */
export function signInUserMessage(failure: SignInFailure | null | undefined): string {
  const code = failure?.code ?? "";
  const message = failure?.message ?? "";
  if (code === "config") return MISCONFIGURED;
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) return `${WRONG_PASSWORD} (auth)`;
  if (code === "email_not_confirmed") return "Confirm your email, then sign in. (auth)";
  if (/encrypt/i.test(message)) return "This PC can't encrypt the Milōn session. The password was not saved.";
  if (!failure) return `${UNREACHABLE} (network)`;
  if (isTimeout(failure)) return `${UNREACHABLE} (timeout)`;
  const status = failure.status;
  if (typeof status === "number" && status >= 400 && status < 500) return `Could not sign in. (HTTP ${status})`;
  return `${UNREACHABLE} (${causeLabel(failure)})`;
}

function safeName(value: string): string {
  return /^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(value) ? value : "Error";
}

function safeCode(value: string): string {
  return /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : "";
}

export function supabaseHost(url: string): string {
  try {
    const host = new URL(url).host;
    return /^[A-Za-z0-9.-]{1,253}$/.test(host) ? host : "";
  } catch {
    return "";
  }
}

/** One log line: host, name, code, status, and a redacted message. No key, email, or query. */
export function redactedSignInFailure(error: unknown, host = ""): string {
  const failure = signInFailureFromThrown(error);
  const name = safeName(failure?.name || (error instanceof Error ? error.name : "Error"));
  const code = safeCode(failure?.code ?? "");
  const status = typeof failure?.status === "number" && failure.status > 0 ? String(failure.status) : "";
  const message = redactPublic(failure?.message || (error instanceof Error ? error.message : ""));
  const safeHost = /^[A-Za-z0-9.-]{1,253}$/.test(host) ? host : "";
  return `[milon-desktop] sign-in host=${safeHost} name=${name} code=${code} status=${status} message=${message}`;
}
