/**
 * Cold-load shell checks (billing gate, practice role, brand hydrate) must not
 * hold a blank page. Server routes still enforce billing when the shell opens.
 */

/** How long a cold load may show a spinner before the shell opens anyway. */
export const SHELL_GATE_TIMEOUT_MS = 8_000;

/**
 * Hard stop for one owner or client boot, measured from auth.
 * Completed boot reads reset the idle window. They do not move this.
 */
export const SHELL_BOOT_CEILING_MS = 12_000;

export function shellGateRemaining(
  startedAtMs: number,
  nowMs: number,
  timeoutMs = SHELL_GATE_TIMEOUT_MS,
): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return timeoutMs;
  return Math.max(0, timeoutMs - (nowMs - startedAtMs));
}

export type ShellGateRace<T> =
  | { status: "value"; value: T }
  | { status: "timeout" };

/**
 * Resolves when `check` settles, or with status "timeout" after `timeoutMs`.
 * `check` keeps running: a late owner redirect can still fire.
 * A rejection resolves as timeout so a thrown check cannot hold the shell.
 */
export function raceShellGate<T>(check: Promise<T>, timeoutMs: number): Promise<ShellGateRace<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ShellGateRace<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs);
    check.then(
      (value) => finish({ status: "value", value }),
      () => finish({ status: "timeout" }),
    );
  });
}

/** Page-load bucket. No ids, emails, or names. */
export function bootRouteBucket(pathname: string): "practice" | "client" | "owner" | "other" {
  const path = (pathname.split(/[?#]/)[0] ?? "").replace(/\/$/, "") || "/";
  if (path === "/app" || path.startsWith("/app/")) return "owner";
  if (/^\/clients\/.+/.test(path)) return "client";
  return /^\/(dashboard|practice|clients|reports)(\/|$)/.test(path) ? "practice" : "other";
}
