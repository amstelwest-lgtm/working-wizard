/**
 * Cold-load shell checks (billing gate, practice role, brand hydrate) must not
 * hold a blank page. Server routes still enforce billing when the shell opens.
 */

import { resolveFirmBootMarket } from "@/lib/pricing/market-resolution";

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

const AUTH_READY_MARK = "auth-ready";
const FIRST_CONTENT_MARK = "first-content";
let bootTimingLogged = false;
/** Path of the first usable shell. A later market read must not change the route bucket. */
let bootPathname: string | null = null;

function performanceMarks(): Performance | null {
  try {
    if (typeof performance === "undefined" || typeof performance.mark !== "function") return null;
    if (typeof performance.getEntriesByName !== "function") return null;
    return performance;
  } catch {
    return null;
  }
}

/** Signed-in auth has finished. Once per page load. No ids or emails. */
export function markAuthReady(): void {
  const marks = performanceMarks();
  if (!marks || marks.getEntriesByName(AUTH_READY_MARK).length > 0) return;
  marks.mark(AUTH_READY_MARK);
}

/** Stored country only. A missing or unreadable firm market is unknown. */
export function bootMarketLabel(raw: unknown): "za" | "us" | "unknown" {
  return resolveFirmBootMarket(raw);
}

/**
 * The shell left its skeleton. One `[boot-timing]` line per page load.
 * `ms` is that moment, measured from navigation start: the `first-content`
 * mark's offset from the time origin. Auth-ready is marked for the timeline,
 * and a market that arrives later does not move `ms`.
 * `route` is a bucket. `market` is za, us, or unknown.
 *
 * Pass `marketReady: false` while the firm country is still loading. The shell
 * time is recorded and the line waits. It still fires once, when the country
 * is za or us, or when the caller says the read has settled.
 */
export function markBootContent(
  pathname: string,
  market: "za" | "us" | "unknown",
  marketReady = true,
): void {
  if (bootTimingLogged) return;
  const marks = performanceMarks();
  if (!marks) return;
  if (marks.getEntriesByName(AUTH_READY_MARK).length === 0) marks.mark(AUTH_READY_MARK);
  if (marks.getEntriesByName(FIRST_CONTENT_MARK).length === 0) marks.mark(FIRST_CONTENT_MARK);
  if (bootPathname == null) bootPathname = pathname;
  if (!marketReady && market === "unknown") return;
  const content = marks.getEntriesByName(FIRST_CONTENT_MARK)[0];
  if (!content) return;
  bootTimingLogged = true;
  console.info("[boot-timing]", {
    ms: Math.max(0, Math.round(content.startTime)),
    market,
    route: bootRouteBucket(bootPathname),
  });
}

export function resetBootTimingForTests(): void {
  bootTimingLogged = false;
  bootPathname = null;
  const marks = performanceMarks();
  marks?.clearMarks?.(AUTH_READY_MARK);
  marks?.clearMarks?.(FIRST_CONTENT_MARK);
}
