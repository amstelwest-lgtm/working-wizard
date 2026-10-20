/**
 * Auth reads that gate a query or a server function must settle.
 * A stuck getSession holds the auth lock; callers do not wait past the deadline.
 */

import { settleWithin } from "@/lib/bounded-load";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";

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
  try {
    const settled = await settleWithin(read(), timeoutMs);
    if (settled.status !== "value") return { ok: false };
    return { ok: true, value: settled.value };
  } catch {
    return { ok: false };
  }
}
