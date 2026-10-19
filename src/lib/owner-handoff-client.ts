import { supabase } from "@/integrations/supabase/client";
import { handoffComingOnline } from "@/hooks/owner-agent-ui";
import { handoffRequestNote, personAssignmentNote } from "@/lib/owner-handoff";
import {
  latestStoredAssignment,
  type AssignmentNote,
  type StoredAssignment,
} from "@/lib/open-plan-home";
import { agentDisplayName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";

export const ACTION_PLAN_REFRESH_EVENT = "milon-action-plan-refresh";

/** The hand-off that just landed, so Home can paint it before the refetch returns. */
export type ActionPlanRefreshDetail = {
  actionItemId: string;
  title: string;
  agent?: AgentKey | null;
  assigneeName?: string;
  /** Click time. An older note or run is not this hand-off. */
  since?: string;
  note?: {
    note: string;
    at: string;
    actorLabel?: string | null;
    actorType?: string | null;
  };
  /** The click's optimistic row should drop. The refetch paints the stored row. */
  failed?: boolean;
};

export type OptimisticHandoff = {
  actionItemId: string;
  title: string;
  since: string;
  agent: AgentKey | null;
  assigneeName: string;
  note: {
    note: string;
    at: string;
    actorLabel: string | null;
    actorType: string | null;
  };
};

let optimisticHandoff: OptimisticHandoff | null = null;

/** The click that has not been confirmed by a stored note yet. */
export function readOptimisticHandoff(): OptimisticHandoff | null {
  return optimisticHandoff;
}

export function clearOptimisticHandoff(actionItemId?: string): void {
  if (!actionItemId || optimisticHandoff?.actionItemId === actionItemId) optimisticHandoff = null;
}

function rememberOptimistic(next: OptimisticHandoff): void {
  optimisticHandoff = next;
}

export function dispatchActionPlanRefresh(detail?: ActionPlanRefreshDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ACTION_PLAN_REFRESH_EVENT, { detail }));
}

export type OwnerHandoffResult =
  | { ok: true; runId: string | null; status: string; dispatched: boolean; noted: boolean }
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
    noted?: boolean;
  } | null;
  if (body?.missing) return { ok: false, error: body.missing };
  if (!res.ok || !body?.ok) {
    return { ok: false, error: body?.missing || body?.error || "The hand-off did not start." };
  }
  const noted = body.noted === true;
  if (!body.runId) {
    return {
      ok: true,
      runId: null,
      status: body.status ?? "assigned",
      dispatched: false,
      noted,
    };
  }
  return { ok: true, runId: body.runId, status: body.status ?? "queued", dispatched: true, noted };
}

async function signedInActorLabel(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const fromSession = data.session?.user?.email?.split("@")[0]?.trim() ?? "";
  if (fromSession) return fromSession;
  const { data: userData } = await supabase.auth.getUser();
  const local = userData.user?.email?.split("@")[0]?.trim() ?? "";
  return local || "Accountant";
}

async function clearActionOwner(actionItemId: string): Promise<void> {
  await supabase.from("action_items").update({ owner_id: null, sent_at: null }).eq("id", actionItemId);
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
    actor_label: await signedInActorLabel(),
    note: handoffRequestNote(name),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type ActionHandoffCommit =
  | { ok: true }
  | { ok: false; error: string; comingSoon?: boolean };

/**
 * The action-plan Hand to. Writes the hand-off, then tells Home so the
 * assignee shows Working and the previous assignee drops back.
 */
export async function commitActionHandoff(input: {
  clientId: string;
  actionItemId: string;
  title: string;
  agent: AgentKey;
}): Promise<ActionHandoffCommit> {
  const since = new Date().toISOString();
  const assigneeName = agentDisplayName(input.agent);
  const actorLabel = await signedInActorLabel();
  const note = {
    note: handoffRequestNote(assigneeName),
    at: since,
    actorLabel,
    actorType: "owner_app",
  };
  const detail: ActionPlanRefreshDetail = {
    actionItemId: input.actionItemId,
    title: input.title,
    agent: input.agent,
    assigneeName,
    since,
    note,
  };
  rememberOptimistic({
    actionItemId: input.actionItemId,
    title: input.title,
    since,
    agent: input.agent,
    assigneeName,
    note,
  });
  // The card flips to Working before the function returns. A finished run settles it.
  dispatchActionPlanRefresh(detail);
  const fail = (error: string, comingSoon?: boolean): ActionHandoffCommit => {
    clearOptimisticHandoff(input.actionItemId);
    dispatchActionPlanRefresh({ ...detail, failed: true });
    return comingSoon ? { ok: false, error, comingSoon: true } : { ok: false, error };
  };
  const result = await requestOwnerHandoff({
    clientId: input.clientId,
    actionItemId: input.actionItemId,
    agent: input.agent,
  });
  if (!result.ok && handoffComingOnline(result.error)) {
    const saved = await recordHandoffAssignment(input);
    if (!saved.ok) return fail(saved.error, true);
    await clearActionOwner(input.actionItemId);
  } else if (!result.ok) {
    return fail(result.error);
  } else if (!result.noted) {
    // The deployed function has not confirmed the note yet. Write it here so
    // reload still sees the assignee. A function that returns noted does this itself.
    const saved = await recordHandoffAssignment(input);
    if (!saved.ok) return fail(saved.error);
    await clearActionOwner(input.actionItemId);
  }
  dispatchActionPlanRefresh(detail);
  return { ok: true };
}

async function writePersonAssignment(input: {
  clientId: string;
  actionItemId: string;
  personId: string;
  personName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("action_items")
    .update({ owner_id: input.personId, sent_at: null })
    .eq("id", input.actionItemId);
  if (error) return { ok: false, error: error.message };
  const { error: noteError } = await supabase.from("action_updates").insert({
    action_item_id: input.actionItemId,
    client_id: input.clientId,
    actor_type: "owner_app",
    actor_label: await signedInActorLabel(),
    note: personAssignmentNote(input.personName),
  });
  if (noteError) return { ok: false, error: noteError.message };
  return { ok: true };
}

/** A person on the Hand to menu. Does not start a bot run. The note author is the signed-in actor. */
export async function assignActionToPerson(input: {
  clientId: string;
  actionItemId: string;
  personId: string;
  personName: string;
  title?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const since = new Date().toISOString();
  const actorLabel = await signedInActorLabel();
  const note = {
    note: personAssignmentNote(input.personName),
    at: since,
    actorLabel,
    actorType: "owner_app",
  };
  const detail: ActionPlanRefreshDetail = {
    actionItemId: input.actionItemId,
    title: input.title ?? "",
    agent: null,
    assigneeName: input.personName,
    since,
    note,
  };
  rememberOptimistic({
    actionItemId: input.actionItemId,
    title: input.title ?? "",
    since,
    agent: null,
    assigneeName: input.personName,
    note,
  });
  dispatchActionPlanRefresh(detail);
  const fail = (error: string): { ok: false; error: string } => {
    clearOptimisticHandoff(input.actionItemId);
    dispatchActionPlanRefresh({ ...detail, failed: true });
    return { ok: false, error };
  };
  const server = await requestPersonAssignment(input);
  if (server.ok && server.noted) {
    dispatchActionPlanRefresh(detail);
    return { ok: true };
  }
  if (server.ok && !server.noted) {
    const saved = await writePersonAssignment(input);
    if (!saved.ok) return fail(saved.error);
  } else if (!personAssignNeedsClient(server.ok ? "" : server.error)) {
    return fail(server.ok ? "" : server.error);
  } else {
    const saved = await writePersonAssignment(input);
    if (!saved.ok) return fail(saved.error);
  }
  dispatchActionPlanRefresh(detail);
  return { ok: true };
}

function personAssignNeedsClient(error: string): boolean {
  return (
    error === "unknown_agent" ||
    error === "That is not one of the three bots." ||
    error === "client_and_action_required" ||
    error === "The hand-off did not start."
  );
}

async function requestPersonAssignment(input: {
  clientId: string;
  actionItemId: string;
  personId: string;
}): Promise<{ ok: true; noted: boolean } | { ok: false; error: string }> {
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
      personId: input.personId,
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    missing?: string;
    noted?: boolean;
  } | null;
  if (body?.missing) return { ok: false, error: body.missing };
  if (!res.ok || !body?.ok) {
    return { ok: false, error: body?.missing || body?.error || "The hand-off did not start." };
  }
  return { ok: true, noted: body.noted === true };
}

export type ActionHandoffRun = { agent: AgentKey; status: string; at: string };

export type HandoffAgentNote = { agent: AgentKey; at: string };

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
    const record = row as {
      action_item_id?: unknown;
      agent?: unknown;
      status?: unknown;
      queued_at?: unknown;
    };
    const id = typeof record.action_item_id === "string" ? record.action_item_id : "";
    const agent = record.agent;
    const status = typeof record.status === "string" ? record.status : "";
    const at = typeof record.queued_at === "string" ? record.queued_at : "";
    if (!id || out.has(id)) continue;
    if (agent !== "financial_manager" && agent !== "analyst" && agent !== "advisor") continue;
    out.set(id, { agent, status, at });
  }
  return out;
}

async function loadAssignmentNotes(actionIds: string[]): Promise<Map<string, AssignmentNote[]>> {
  const grouped = new Map<string, AssignmentNote[]>();
  const ids = actionIds.filter(Boolean);
  if (!ids.length) return grouped;
  const { data, error } = await supabase
    .from("action_updates")
    .select("action_item_id,note,created_at,actor_label,actor_type")
    .in("action_item_id", ids)
    .order("created_at", { ascending: false });
  if (error || !Array.isArray(data)) return grouped;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as {
      action_item_id?: unknown;
      note?: unknown;
      created_at?: unknown;
      actor_label?: unknown;
      actor_type?: unknown;
    };
    const id = typeof record.action_item_id === "string" ? record.action_item_id : "";
    if (!id) continue;
    const notes = grouped.get(id) ?? [];
    notes.push({
      note: typeof record.note === "string" ? record.note : null,
      at: typeof record.created_at === "string" ? record.created_at : "",
      actorLabel: typeof record.actor_label === "string" ? record.actor_label : null,
      actorType: typeof record.actor_type === "string" ? record.actor_type : null,
    });
    grouped.set(id, notes);
  }
  return grouped;
}

/** Every note on these actions, newest first. The row shows them; assignment is a separate read. */
export async function loadActionNotes(actionIds: string[]): Promise<Map<string, AssignmentNote[]>> {
  return loadAssignmentNotes(actionIds);
}

/** Newest bot or person assignment per action. Other notes stay in the log and do not hide it. */
export async function loadLatestAssignments(
  actionIds: string[],
): Promise<Map<string, StoredAssignment>> {
  const out = new Map<string, StoredAssignment>();
  const grouped = await loadAssignmentNotes(actionIds);
  for (const [id, notes] of grouped) {
    const stored = latestStoredAssignment(notes);
    if (stored) out.set(id, stored);
  }
  return out;
}

/** Newest "Handed to …" note per action, when a later person assignment has not replaced it. */
export async function loadLatestHandoffAgents(actionIds: string[]): Promise<Map<string, HandoffAgentNote>> {
  const out = new Map<string, HandoffAgentNote>();
  const assignments = await loadLatestAssignments(actionIds);
  for (const [id, stored] of assignments) {
    if (stored.kind === "bot") out.set(id, { agent: stored.agent, at: stored.at });
  }
  return out;
}
