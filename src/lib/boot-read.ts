/**
 * One bounded read for owner and accountant boot.
 *
 * Each attempt aborts at BOOT_READ_TIMEOUT_MS. A critical read may run once
 * more after a network failure or an abort. The second result is final.
 *
 * Only an idempotent select belongs here. A write or an RPC with side
 * effects must not be passed in, and this module never issues one.
 *
 * The abort signal is handed to the query builder for the HTTP fetch.
 * It is not applied around the auth lock, so a stalled data read cannot
 * hold a session read. This module does not acquire that lock.
 */

export const BOOT_READ_TIMEOUT_MS = 4_000;

let timeoutOverride: number | null = null;

/** Page smoke uses a short bound. Pass null to restore BOOT_READ_TIMEOUT_MS. */
export function setBootReadTimeoutMsForTests(ms: number | null): void {
  timeoutOverride = ms;
}

export function bootReadTimeoutMs(): number {
  return timeoutOverride ?? BOOT_READ_TIMEOUT_MS;
}

export type BootRead<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown; retryable: boolean };

function failureText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (error && typeof error === "object" && "message" in error) {
    const row = error as { name?: unknown; message?: unknown };
    return `${String(row.name ?? "")} ${String(row.message ?? "")}`;
  }
  return "";
}

/**
 * Network failure, abort, or timeout. Permission and schema errors are not
 * retryable: the caller keeps the settled result and its own fallback.
 */
export function isRetryableBootFailure(error: unknown): boolean {
  const text = failureText(error).toLowerCase();
  if (!text.trim()) return false;
  return (
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("network request failed") ||
    text.includes("aborterror") ||
    text.includes("the operation was aborted") ||
    text.includes("this operation was aborted") ||
    text.includes("timed out") ||
    text.includes("timeout")
  );
}

function postgrestError(value: unknown): unknown | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  const error = (value as { error?: unknown }).error;
  return error ? error : null;
}

let retryCount = 0;
/**
 * The critical read's one retry has failed. The shell must show the
 * recoverable load state. The 8s backstop must not take that screen.
 */
let criticalRetryFailed = false;
const retryListeners = new Set<() => void>();

function notifyRetry(): void {
  for (const listener of [...retryListeners]) listener();
}

function beginRetry(): void {
  retryCount += 1;
  notifyRetry();
}

function endRetry(): void {
  retryCount = Math.max(0, retryCount - 1);
  notifyRetry();
}

/** True while a critical read is on its single retry. */
export function bootRetryInFlight(): boolean {
  return retryCount > 0;
}

/**
 * True after a critical read's single retry failed with a network error
 * or an abort. Cleared when the next critical read starts (Retry).
 */
export function bootCriticalRetryFailed(): boolean {
  return criticalRetryFailed;
}

export function subscribeBootRetry(listener: () => void): () => void {
  retryListeners.add(listener);
  return () => {
    retryListeners.delete(listener);
  };
}

/**
 * The 8s shell backstop may fire only when a critical retry is not in flight
 * and that retry has not already failed. `backstopAtMs` is the original
 * deadline. Starting a retry does not move it. A failed retry does not
 * release it: the caller shows "Couldn't load" instead.
 */
export function shellBackstopDue(nowMs: number, backstopAtMs: number): boolean {
  if (bootRetryInFlight()) return false;
  if (criticalRetryFailed) return false;
  return nowMs >= backstopAtMs;
}

export function resetBootReadForTests(): void {
  retryCount = 0;
  criticalRetryFailed = false;
  timeoutOverride = null;
}

async function oneAttempt<T>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number,
): Promise<BootRead<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error("Boot read timed out");
        err.name = "TimeoutError";
        reject(err);
      }, timeoutMs);
      Promise.resolve(run(controller.signal)).then(resolve, reject);
    });
    const error = postgrestError(value);
    if (error && isRetryableBootFailure(error)) {
      return { ok: false, error, retryable: true };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error, retryable: isRetryableBootFailure(error) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Run `run` once. When `critical` is set, a retryable failure runs once more.
 * A non-critical failure is returned as-is and must not fail the boot.
 * A settled non-retryable result (schema, permission) is `{ ok: true, value }`
 * so the caller can keep its existing fallback.
 */
export async function bootSelect<T>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  opts: { critical: boolean; timeoutMs?: number },
): Promise<BootRead<T>> {
  const timeoutMs = opts.timeoutMs ?? bootReadTimeoutMs();
  if (opts.critical && criticalRetryFailed) {
    criticalRetryFailed = false;
    notifyRetry();
  }
  const first = await oneAttempt(run, timeoutMs);
  if (first.ok || !opts.critical || !first.retryable) return first;
  beginRetry();
  try {
    const second = await oneAttempt(run, timeoutMs);
    if (!second.ok && second.retryable) criticalRetryFailed = true;
    return second;
  } finally {
    endRetry();
  }
}
