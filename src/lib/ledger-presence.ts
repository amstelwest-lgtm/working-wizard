import type { ConnectionRowFact } from "@/lib/connection-status-deadline";

export type LedgerProvider = "xero" | "qbo" | "sage";

/** Service-role existence only. No tokens, names, or other columns. */
export type LedgerPresence = {
  xero: boolean;
  qbo: boolean;
  sage: boolean;
};

export type LedgerPresenceDecision = {
  status: 200 | 401 | 403 | 503;
  body: LedgerPresence | null;
};

/**
 * An empty count is "absent" only for a signed-in firm member, after the
 * service role has actually read the tables. A 0-row result from an
 * unauthenticated or non-member call (what RLS returns with no policy) is
 * not a decision: 401/403, and the client stays unknown.
 */
export function decideLedgerPresence(input: {
  userId: string | null;
  member: boolean;
  counts: { xero: number; qbo: number; sage: number } | null;
}): LedgerPresenceDecision {
  if (!input.userId) return { status: 401, body: null };
  if (!input.member) return { status: 403, body: null };
  if (!input.counts) return { status: 503, body: null };
  return {
    status: 200,
    body: {
      xero: input.counts.xero > 0,
      qbo: input.counts.qbo > 0,
      sage: input.counts.sage > 0,
    },
  };
}

export function httpStatusOf(err: unknown): number {
  if (err instanceof Response) return err.status;
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return 0;
}

/** Non-200, including 401 and 403, is unknown. Never treat that as absent. */
export function rowFactFromPresenceResponse(
  input: { status: number; body: LedgerPresence | null },
  provider: LedgerProvider,
): ConnectionRowFact {
  if (input.status !== 200 || !input.body) return "unknown";
  const value = input.body[provider];
  if (typeof value !== "boolean") return "unknown";
  return value ? "present" : "absent";
}
