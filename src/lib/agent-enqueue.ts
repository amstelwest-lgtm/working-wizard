/**
 * Server-side enqueue after a ledger sync. Failures are logged and swallowed
 * so a sync still returns the same payload when the agent tables are absent.
 */
import { clientActivityMs } from "./agent-bus.ts";

export function priorActivityIso(input: {
  createdAt: string | null;
  lastLoginAt: string | null;
  previousBooksAt: string | null;
}): string | null {
  const createdAtMs = input.createdAt ? Date.parse(input.createdAt) : NaN;
  if (!Number.isFinite(createdAtMs)) return null;
  const lastLoginAtMs = input.lastLoginAt ? Date.parse(input.lastLoginAt) : null;
  const previousBooksAtMs = input.previousBooksAt ? Date.parse(input.previousBooksAt) : null;
  return new Date(
    clientActivityMs({
      createdAtMs,
      lastLoginAtMs: Number.isFinite(lastLoginAtMs) ? lastLoginAtMs : null,
      previousBooksAtMs: Number.isFinite(previousBooksAtMs) ? previousBooksAtMs : null,
    }),
  ).toISOString();
}

type RpcResult = { error: { message?: string } | null };

export async function enqueueAgentEventSafe(
  db: unknown,
  input: {
    clientId: string;
    trigger: "sync" | "upload";
    activityAt: string | null;
    inputs: string;
  },
): Promise<void> {
  const rpc = (db as { rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult> })
    .rpc;
  if (typeof rpc !== "function") return;
  try {
    const { error } = await rpc.call(db, "enqueue_agent_event", {
      p_client_id: input.clientId,
      p_trigger: input.trigger,
      p_activity_at: input.activityAt,
      p_inputs: input.inputs,
    });
    if (error?.message) console.warn("enqueue_agent_event", error.message);
  } catch (err) {
    console.warn("enqueue_agent_event", err instanceof Error ? err.message : "failed");
  }
}
