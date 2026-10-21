/**
 * One bounded read for owner and accountant boot.
 *
 * A critical select aborts the first attempt at BOOT_READ_TIMEOUT_MS. If
 * that attempt is still open at BOOT_READ_HEDGE_MS, a second identical
 * select starts and may run until BOOT_READ_RETRY_TIMEOUT_MS. Whichever
 * attempt returns first wins, and the other is aborted. A retryable
 * failure before the hedge starts the second attempt immediately. There
 * is no third try. Neither attempt is allowed to run past the shell
 * ceiling: each timeout is the time left, and the hedge does not start
 * in the last 500ms.
 *
 * Only an idempotent select belongs here. A write or an RPC with side
 * effects must not be passed in, and this module never issues one.
 *
 * The abort signal is handed to the query builder for the HTTP fetch.
 * It is not applied around the auth lock, so a stalled data read cannot
 * hold a session read. This module does not acquire that lock.
 */

import { SHELL_BOOT_CEILING_MS, SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";

export const BOOT_READ_TIMEOUT_MS = 4_000;
/** Start the second select while the first is still in flight. */
export const BOOT_READ_HEDGE_MS = 2_500;
/** The second select may outlive the first. It is still capped at the ceiling. */
export const BOOT_READ_RETRY_TIMEOUT_MS = 6_000;
/** A hedge this close to the ceiling would only add a request that cannot finish. */
const BOOT_HEDGE_MIN_REMAINING_MS = 500;

let timeoutOverride: number | null = null;

/** Page smoke uses a short bound. Pass null to restore BOOT_READ_TIMEOUT_MS. */
export function setBootReadTimeoutMsForTests(ms: number | null): void {
  timeoutOverride = ms;
}

export function bootReadTimeoutMs(): number {
  return timeoutOverride ?? BOOT_READ_TIMEOUT_MS;
}

function scaled(partMs: number, firstTimeoutMs: number): number {
  if (firstTimeoutMs === BOOT_READ_TIMEOUT_MS) return partMs;
  return Math.max(1, Math.round((partMs * firstTimeoutMs) / BOOT_READ_TIMEOUT_MS));
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
 * recoverable load state. The backstop must not take that screen.
 */
let criticalRetryFailed = false;
const retryListeners = new Set<() => void>();
const progressListeners = new Set<() => void>();

function notifyRetry(): void {
  for (const listener of [...retryListeners]) listener();
}

function notifyProgress(): void {
  for (const listener of [...progressListeners]) listener();
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

/** Fires once each time a bootSelect settles, including a failed one. */
export function subscribeBootProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

/**
 * The idle deadline waits while a critical retry is in flight or has
 * already failed, so that screen stays "Couldn't load". The ceiling does
 * not wait. `backstopAtMs` moves forward when a boot read completes.
 * `ceilingAtMs` does not move.
 */
export function shellBackstopDue(
  nowMs: number,
  backstopAtMs: number,
  ceilingAtMs?: number,
): boolean {
  if (ceilingAtMs !== undefined && nowMs >= ceilingAtMs) return true;
  if (bootRetryInFlight()) return false;
  if (criticalRetryFailed) return false;
  return nowMs >= backstopAtMs;
}

let idleOverride: number | null = null;
let ceilingOverride: number | null = null;

/** Page smoke shortens the idle window or the ceiling. Pass null to restore both. */
export function setShellBackstopForTests(
  opts: { idleMs?: number; ceilingMs?: number } | null,
): void {
  idleOverride = opts?.idleMs ?? null;
  ceilingOverride = opts?.ceilingMs ?? null;
}

function shellIdleMs(): number {
  return idleOverride ?? SHELL_GATE_TIMEOUT_MS;
}

function shellCeilingMs(): number {
  return ceilingOverride ?? SHELL_BOOT_CEILING_MS;
}

/** Absolute deadline set by the armed shell backstop. Reads cap themselves to it. */
let bootCeilingAt: number | null = null;
const liveAbandons = new Set<() => void>();

function msUntilCeiling(now = Date.now()): number | null {
  if (bootCeilingAt == null) return null;
  return bootCeilingAt - now;
}

function cappedAttemptMs(wantedMs: number): number {
  const left = msUntilCeiling();
  if (left == null) return wantedMs;
  return Math.max(0, Math.min(wantedMs, left));
}

function hedgeFits(): boolean {
  const left = msUntilCeiling();
  if (left == null) return true;
  return left >= BOOT_HEDGE_MIN_REMAINING_MS;
}

function abortInFlightBootReads(): void {
  for (const abandon of [...liveAbandons]) abandon();
}

function hostTimers(): {
  set: (fn: () => void, ms: number) => number;
  clear: (id: number) => void;
} {
  const host = typeof window !== "undefined" ? window : globalThis;
  return {
    set: (fn, ms) => host.setTimeout(fn, ms) as unknown as number,
    clear: (id) => host.clearTimeout(id),
  };
}

/**
 * Arm the owner and accountant shell backstop. The idle window resets
 * when a boot read completes, so a chain of steady sub-4s reads does not
 * trip it. The ceiling stays put, measured from this call (after auth).
 * Idle waits for an in-flight retry. The ceiling does not: it aborts
 * in-flight boot reads and tells the caller to show "Couldn't load".
 */
export function bindShellBackstop(onDue: (reason: "idle" | "ceiling") => void): () => void {
  const timers = hostTimers();
  const started = Date.now();
  const ceilingAt = started + shellCeilingMs();
  const previousCeiling = bootCeilingAt;
  bootCeilingAt = ceilingAt;
  let idleAt = started + shellIdleMs();
  let timer = 0;
  let stopped = false;
  let fired = false;
  const arm = () => {
    timers.clear(timer);
    if (stopped || fired) return;
    const now = Date.now();
    if (!shellBackstopDue(now, idleAt, ceilingAt)) {
      // A retry holds the idle window. It must not drop the ceiling timer.
      const held = bootRetryInFlight() || bootCriticalRetryFailed();
      const next = held ? ceilingAt : Math.min(idleAt, ceilingAt);
      timer = timers.set(arm, Math.max(0, next - Date.now()));
      return;
    }
    fired = true;
    const reason = now >= ceilingAt ? "ceiling" : "idle";
    if (reason === "ceiling") abortInFlightBootReads();
    onDue(reason);
  };
  arm();
  const unsubRetry = subscribeBootRetry(arm);
  const unsubProgress = subscribeBootProgress(() => {
    idleAt = Date.now() + shellIdleMs();
    arm();
  });
  return () => {
    stopped = true;
    if (bootCeilingAt === ceilingAt) bootCeilingAt = previousCeiling;
    timers.clear(timer);
    unsubRetry();
    unsubProgress();
  };
}

export function resetBootReadForTests(): void {
  retryCount = 0;
  criticalRetryFailed = false;
  timeoutOverride = null;
  idleOverride = null;
  ceilingOverride = null;
  bootCeilingAt = null;
  liveAbandons.clear();
}

type Attempt<T> = {
  promise: Promise<BootRead<T>>;
  cancel: () => void;
};

function startAttempt<T>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number,
): Attempt<T> {
  const budget = cappedAttemptMs(timeoutMs);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let abandon = () => {};
  const promise = new Promise<BootRead<T>>((resolve) => {
    const finish = (result: BootRead<T>) => {
      if (settled) return;
      settled = true;
      liveAbandons.delete(abandon);
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };
    abandon = () => {
      controller.abort();
      const err = new Error("Boot read timed out");
      err.name = "TimeoutError";
      finish({ ok: false, error: err, retryable: true });
    };
    timer = setTimeout(abandon, budget);
    Promise.resolve(run(controller.signal)).then(
      (value) => {
        const error = postgrestError(value);
        if (error && isRetryableBootFailure(error)) {
          finish({ ok: false, error, retryable: true });
          return;
        }
        finish({ ok: true, value });
      },
      (error) => finish({ ok: false, error, retryable: isRetryableBootFailure(error) }),
    );
  });
  liveAbandons.add(abandon);
  return {
    promise,
    cancel: () => {
      liveAbandons.delete(abandon);
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    },
  };
}

/**
 * First attempt, plus one overlapping retry. The winner resolves this
 * promise. The loser's later result is ignored.
 */
function criticalSelect<T>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number,
): Promise<BootRead<T>> {
  const retryMs = scaled(BOOT_READ_RETRY_TIMEOUT_MS, timeoutMs);
  const hedgeMs = scaled(BOOT_READ_HEDGE_MS, timeoutMs);
  return new Promise((resolve) => {
    let done = false;
    let retryOpen = false;
    let first: Attempt<T> | null = null;
    let second: Attempt<T> | null = null;
    let failures = 0;
    let started = 0;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    const close = (result: BootRead<T>, failed = false) => {
      if (done) return;
      done = true;
      if (failed) criticalRetryFailed = true;
      if (hedgeTimer !== undefined) clearTimeout(hedgeTimer);
      first?.cancel();
      second?.cancel();
      if (retryOpen) {
        retryOpen = false;
        endRetry();
      }
      resolve(result);
    };

    const onAttempt = (result: BootRead<T>) => {
      if (done) return;
      if (result.ok || !result.retryable) {
        close(result);
        return;
      }
      failures += 1;
      if (!second) {
        if (hedgeTimer !== undefined) clearTimeout(hedgeTimer);
        if (startSecond()) return;
        close(result, true);
        return;
      }
      if (failures < started) return;
      close(result, true);
    };

    const startSecond = (): boolean => {
      if (done || second || !hedgeFits()) return false;
      second = startAttempt(run, retryMs);
      started += 1;
      retryOpen = true;
      beginRetry();
      void second.promise.then(onAttempt);
      return true;
    };

    first = startAttempt(run, timeoutMs);
    started = 1;
    void first.promise.then(onAttempt);
    hedgeTimer = setTimeout(startSecond, hedgeMs);
  });
}

/**
 * Run `run` once. When `critical` is set, one overlapping retry covers a
 * network failure or an abort. A non-critical failure is returned as-is
 * and must not fail the boot. A settled non-retryable result (schema,
 * permission) is `{ ok: true, value }` so the caller can keep its
 * existing fallback.
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
  try {
    if (!opts.critical) return await startAttempt(run, timeoutMs).promise;
    return await criticalSelect(run, timeoutMs);
  } finally {
    notifyProgress();
  }
}
