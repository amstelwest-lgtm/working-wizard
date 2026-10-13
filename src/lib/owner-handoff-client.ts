import { supabase } from "@/integrations/supabase/client";
import { handoffRequestNote } from "@/lib/owner-handoff";
import { agentDisplayName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";

export type OwnerHandoffResult =
  | { ok: true; runId: string | null; status: string; dispatched: boolean }
  | { ok: false; error: string };

export async function requestOwnerHandoff(input: {
  clientId: string;
  actionItemId: string;
  agent: AgentKey;
}): Promise<OwnerHandoffResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { ok: false, error: "Not signed in." };
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) return { ok: false, error: "Supabase URL is not configured." };
  const res = await fetch(`${base}/functions/v1/owner-handoff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      clientId: input.clientId,
      actionItemId: input.actionItemId,
      agent: input.agent,
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    runId?: string;
    status?: string;
    error?: string;
    missing?: string;
  } | null;
  if (body?.missing) return { ok: false, error: body.missing };
  if (!res.ok || !body?.ok) {
    return { ok: false, error: body?.missing || body?.error || "The hand-off did not start." };
  }
  if (!body.runId) {
    return {
      ok: true,
      runId: null,
      status: body.status ?? "assigned",
      dispatched: false,
    };
  }
  return { ok: true, runId: body.runId, status: body.status ?? "queued", dispatched: true };
}

/** Persists the assignee when the runner is off. Does not insert agent_runs. */
export async function recordHandoffAssignment(input: {
  clientId: string;
  actionItemId: string;
  agent: AgentKey;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = agentDisplayName(input.agent);
  const { error } = await supabase.from("action_updates").insert({
    action_item_id: input.actionItemId,
    client_id: input.clientId,
    actor_type: "owner_app",
    actor_label: name,
    note: handoffRequestNote(name),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type ActionHandoffRun = { agent: AgentKey; status: string };

/** Newest run per action. A missing column or an empty table stays quiet. */
export async function loadActionHandoffRuns(
  actionIds: string[],
): Promise<Map<string, ActionHandoffRun>> {
  const out = new Map<string, ActionHandoffRun>();
  const ids = actionIds.filter(Boolean);
  if (!ids.length) return out;
  const { data, error } = await (
    supabase as unknown as {
      from(table: string): {
        select(columns: string): {
          in(
            column: string,
            values: string[],
          ): {
            order(
              column: string,
              options: { ascending: boolean },
            ): Promise<{
              data: unknown;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    }
  )
    .from("agent_runs")
    .select("action_item_id, agent, status, queued_at")
    .in("action_item_id", ids)
    .order("queued_at", { ascending: false });
  if (error || !Array.isArray(data)) return out;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as { action_item_id?: unknown; agent?: unknown; status?: unknown };
    const id = typeof record.action_item_id === "string" ? record.action_item_id : "";
    const agent = record.agent;
    const status = typeof record.status === "string" ? record.status : "";
    if (!id || out.has(id)) continue;
    if (agent !== "financial_manager" && agent !== "analyst" && agent !== "advisor") continue;
    out.set(id, { agent, status });
  }
  return out;
}
