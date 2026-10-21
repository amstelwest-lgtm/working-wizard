/**
 * Auth reads that gate a query or a server function must settle.
 * A stuck getSession holds the auth lock; callers do not wait past the deadline.
 */

import { settleWithin } from "@/lib/bounded-load";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";

/**
 * The in-flight session restore. settleWithin does not cancel `getSession`,
 * and that read holds the auth lock for the whole refresh. Aborting this
 * controller rejects the refresh fetch so the lock can release at the deadline.
 * Cleared when the read settles, so later PostgREST calls are not aborted.
 */
let restoreController: AbortController | null = null;

export function sessionRestoreSignal(): AbortSignal | null {
  return restoreController?.signal ?? null;
}

function armSessionRestore(): AbortController {
  const controller = new AbortController();
  restoreController = controller;
  return controller;
}

function releaseSessionRestore(controller: AbortController): void {
  if (restoreController === controller) restoreController = null;
}

type SessionRead = {
  data: { session: { access_token?: string } | null };
};

/** Bearer token for a server function, or null once the deadline passes. */
export async function accessTokenWithin(
  read: () => Promise<SessionRead>,
  timeoutMs = SHELL_GATE_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const settled = await settleWithin(read(), timeoutMs);
    if (settled.status !== "value") return null;
    return settled.value.data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function restoreSession<T>(
  read: () => Promise<T>,
  timeoutMs = SHELL_GATE_TIMEOUT_MS,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const controller = armSessionRestore();
  const work = read();
  try {
    const settled = await settleWithin(work, timeoutMs);
    if (settled.status === "timeout") {
      controller.abort();
      void Promise.resolve(work).finally(() => releaseSessionRestore(controller));
      return { ok: false };
    }
    releaseSessionRestore(controller);
    if (settled.status !== "value") return { ok: false };
    return { ok: true, value: settled.value };
  } catch {
    releaseSessionRestore(controller);
    return { ok: false };
  }
}
