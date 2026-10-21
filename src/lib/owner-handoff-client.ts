import { supabase } from "@/integrations/supabase/client";
import { handoffComingOnline } from "@/hooks/owner-agent-ui";
import { phaseForAction } from "@/lib/action-handoff";
import { agentActivityUnavailable } from "@/lib/milon-team-activity";
import {
  handoffRequestNote,
  moveLoadMayCache,
  personAssignmentNote,
  type MoveAssignmentRef,
} from "@/lib/owner-handoff";
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
  /** The open run was already queued. Do not add another Handed-to line. */
  reused?: boolean;
  runId?: string;
  error?: string;
  /** Set only after the hand-off write has been awaited. Listeners may drop the cache then. */
  committed?: boolean;
};

export const HANDOFF_FAILED_COPY = "Couldn't hand this over";

export type OptimisticHandoff = {
  actionItemId: string;
  title: string;
  since: string;
  agent: AgentKey | null;
  assigneeName: string;
  runId?: string | null;
  note: {
    note: string;
    at: string;
    actorLabel: string | null;
    actorType: string | null;
  } | null;
};

const optimisticHandoffs = new Map<string, OptimisticHandoff>();
const blockedSince = new Map<string, string>();
const hiddenNotes = new Map<string, string>();
const handoffErrors = new Map<string, string>();

export function resetHandoffOptimistic(): void {
  optimisticHandoffs.clear();
  blockedSince.clear();
  hiddenNotes.clear();
  handoffErrors.clear();
}

/** Clicks still on screen. One slot per action, so two cards do not share a pending hand-off. */
export function readOptimisticHandoffs(): OptimisticHandoff[] {
  return [...optimisticHandoffs.values()].filter((row) => blockedSince.get(row.actionItemId) !== row.since);
}

export function handoffPaintBlocked(actionItemId: string, since: string | undefined): boolean {
  return Boolean(since && blockedSince.get(actionItemId) === since);
}

export function optimisticNoteHidden(actionItemId: string, at: string | undefined): boolean {
  if (!at) return false;
  return hiddenNotes.get(actionItemId) === at || blockedSince.get(actionItemId) === at;
}

export function readHandoffError(actionItemId: string): string | null {
  return handoffErrors.get(actionItemId) ?? null;
}

export function clearOptimisticHandoff(actionItemId?: string): void {
  if (!actionItemId) {
    optimisticHandoffs.clear();
    return;
  }
  optimisticHandoffs.delete(actionItemId);
}

export function rememberOptimistic(next: OptimisticHandoff): void {
  blockedSince.delete(next.actionItemId);
  hiddenNotes.delete(next.actionItemId);
  handoffErrors.delete(next.actionItemId);
  optimisticHandoffs.set(next.actionItemId, next);
}

/** Drop this click and keep a later refresh from painting its note again. */
export function rejectOptimisticHandoff(actionItemId: string, since: string, message: string | null): void {
  const current = optimisticHandoffs.get(actionItemId);
  if (!current || current.since === since) optimisticHandoffs.delete(actionItemId);
  blockedSince.set(actionItemId, since);
  hiddenNotes.set(actionItemId, since);
  if (message) handoffErrors.set(actionItemId, message);
  else handoffErrors.delete(actionItemId);
}

/** A reused run keeps Working and does not grow a second Handed-to line. */
export function suppressOptimisticNote(actionItemId: string, since: string): void {
  const current = optimisticHandoffs.get(actionItemId);
  if (current?.since === since) optimisticHandoffs.set(actionItemId, { ...current, note: null });
  hiddenNotes.set(actionItemId, since);
}

export function attachOptimisticRun(actionItemId: string, since: string, runId: string): void {
  const current = optimisticHandoffs.get(actionItemId);
  if (!current || current.since !== since || blockedSince.get(actionItemId) === since) return;
  optimisticHandoffs.set(actionItemId, { ...current, runId });
}

export function stripSuppressedNotes<T extends { at: string }>(notes: Record<string, T[]>): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [id, rows] of Object.entries(notes)) {
    out[id] = rows.filter((row) => !optimisticNoteHidden(id, row.at));
  }
  return out;
}

export function dispatchActionPlanRefresh(detail?: ActionPlanRefreshDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ACTION_PLAN_REFRESH_EVENT, { detail }));
}

export type OwnerHandoffResult =
  | { ok: true; runId: string | null; status: string; dispatched: boolean; noted: boolean; reused: boolean }
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
    reused?: boolean;
  } | null;
  if (body?.missing) return { ok: false, error: body.missing };
  if (!res.ok || !body?.ok) {
    return { ok: false, error: body?.missing || body?.error || "The hand-off did not start." };
  }
  const noted = body.noted === true;
  const reused = body.reused === true;
  if (!body.runId) {
    return {
      ok: true,
      runId: null,
      status: body.status ?? "assigned",
      dispatched: false,
      noted,
      reused,
    };
  }
  return {
    ok: true,
    runId: body.runId,
    status: body.status ?? "queued",
    dispatched: true,
    noted,
    reused,
  };
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
  | { ok: true; noted: boolean }
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
  const note = {
    note: handoffRequestNote(assigneeName),
    at: since,
    actorLabel: null as string | null,
    actorType: "owner_app" as const,
  };
  const working: ActionPlanRefreshDetail = {
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
  // Handed to paints with the click time. The signed-in name fills in after.
  dispatchActionPlanRefresh(working);
  const actorLabel = await signedInActorLabel();
  note.actorLabel = actorLabel;
  const fail = (error: string, comingSoon?: boolean): ActionHandoffCommit => {
    rejectOptimisticHandoff(input.actionItemId, since, comingSoon ? null : HANDOFF_FAILED_COPY);
    dispatchActionPlanRefresh({
      ...working,
      failed: true,
      error: comingSoon ? undefined : HANDOFF_FAILED_COPY,
    });
    return comingSoon ? { ok: false, error, comingSoon: true } : { ok: false, error };
  };
  let result: Awaited<ReturnType<typeof requestOwnerHandoff>>;
  try {
    result = await requestOwnerHandoff({
      clientId: input.clientId,
      actionItemId: input.actionItemId,
      agent: input.agent,
    });
  } catch (err) {
    const message = err instanceof Error && err.message.trim() ? err.message : HANDOFF_FAILED_COPY;
    return fail(message);
  }
  if (!result.ok && handoffComingOnline(result.error)) {
    const saved = await recordHandoffAssignment(input);
    if (!saved.ok) return fail(saved.error, true);
    await clearActionOwner(input.actionItemId);
  } else if (!result.ok) {
    return fail(result.error);
  } else if (result.reused) {
    suppressOptimisticNote(input.actionItemId, since);
    if (result.runId) attachOptimisticRun(input.actionItemId, since, result.runId);
    invalidateMoveAssignments(input.clientId);
    dispatchActionPlanRefresh({
      ...working,
      reused: true,
      runId: result.runId ?? undefined,
      committed: true,
    });
    return { ok: true, noted: false };
  } else if (!result.noted) {
    // The deployed function has not confirmed the note yet. Write it here so
    // reload still sees the assignee. A function that returns noted does this itself.
    const saved = await recordHandoffAssignment(input);
    if (!saved.ok) return fail(saved.error);
    await clearActionOwner(input.actionItemId);
  } else if (result.noted) {
    rememberOptimistic({
      actionItemId: input.actionItemId,
      title: input.title,
      since,
      agent: input.agent,
      assigneeName,
      runId: result.runId,
      note,
    });
    invalidateMoveAssignments(input.clientId);
    dispatchActionPlanRefresh({
      ...working,
      note,
      runId: result.runId ?? undefined,
      committed: true,
    });
    return { ok: true, noted: true };
  }
  invalidateMoveAssignments(input.clientId);
  dispatchActionPlanRefresh({
    ...working,
    runId: result.ok ? result.runId ?? undefined : undefined,
    committed: true,
  });
  return { ok: true, noted: true };
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
    rejectOptimisticHandoff(input.actionItemId, since, null);
    dispatchActionPlanRefresh({ ...detail, failed: true });
    return { ok: false, error };
  };
  const server = await requestPersonAssignment(input);
  if (server.ok && server.noted) {
    invalidateMoveAssignments(input.clientId);
    dispatchActionPlanRefresh({ ...detail, committed: true });
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
  invalidateMoveAssignments(input.clientId);
  dispatchActionPlanRefresh({ ...detail, committed: true });
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

export type ActionHandoffRun = { id: string; agent: AgentKey; status: string; at: string };

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
    .select("id, action_item_id, agent, status, queued_at")
    .in("action_item_id", ids)
    .order("queued_at", { ascending: false });
  if (error || !Array.isArray(data)) return out;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as {
      id?: unknown;
      action_item_id?: unknown;
      agent?: unknown;
      status?: unknown;
      queued_at?: unknown;
    };
    const id = typeof record.action_item_id === "string" ? record.action_item_id : "";
    const runId = typeof record.id === "string" ? record.id : "";
    const agent = record.agent;
    const status = typeof record.status === "string" ? record.status : "";
    const at = typeof record.queued_at === "string" ? record.queued_at : "";
    if (!id || !runId || out.has(id)) continue;
    if (agent !== "financial_manager" && agent !== "analyst" && agent !== "advisor") continue;
    out.set(id, { id: runId, agent, status, at });
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

const moveAssignmentCache = new Map<string, MoveAssignmentRef[]>();
const moveAssignmentLoads = new Map<string, Promise<MoveAssignmentRef[]>>();
const moveAssignmentTokens = new Map<string, object>();
const moveAssignmentEpoch = new Map<string, number>();

/** Drop a cached Next moves read so the next load sees the note just written. */
export function invalidateMoveAssignments(clientId: string): void {
  const id = clientId.trim();
  moveAssignmentCache.delete(id);
  moveAssignmentLoads.delete(id);
  moveAssignmentTokens.delete(id);
  moveAssignmentEpoch.set(id, (moveAssignmentEpoch.get(id) ?? 0) + 1);
}

type MoveFindingRow = {
  id: string;
  run_id: string | null;
  status: string | null;
  superseded_by: unknown;
  dismissed_reason: string | null;
};

type QuietError = { message?: string; code?: string } | null;

type InOrderQuery = {
  select(columns: string): InOrderQuery;
  in(column: string, values: string[]): InOrderQuery;
  order(column: string, options: { ascending: boolean }): Promise<{ data: unknown; error: QuietError }>;
};

function quietTable(name: string): InOrderQuery {
  return (supabase as unknown as { from(relation: string): InOrderQuery }).from(name);
}

type MoveRunRow = { id: string; actionItemId: string; status: string };

/**
 * Every run for these actions, newest first, and the drafts on those runs.
 * A failed read leaves findingsReady false so the row stays Working instead of dropping the assignee.
 */
async function loadMoveActivity(actionIds: string[]): Promise<{
  runs: MoveRunRow[];
  findings: MoveFindingRow[];
  findingsReady: boolean;
}> {
  const runs: MoveRunRow[] = [];
  const ids = actionIds.filter(Boolean);
  if (!ids.length) return { runs, findings: [], findingsReady: true };
  const runsRes = await quietTable("agent_runs")
    .select("id, action_item_id, status, queued_at")
    .in("action_item_id", ids)
    .order("queued_at", { ascending: false });
  if (runsRes.error || !Array.isArray(runsRes.data)) {
    return { runs, findings: [], findingsReady: false };
  }
  for (const row of runsRes.data) {
    if (!row || typeof row !== "object") continue;
    const record = row as { id?: unknown; action_item_id?: unknown; status?: unknown };
    const actionId = typeof record.action_item_id === "string" ? record.action_item_id : "";
    const runId = typeof record.id === "string" ? record.id : "";
    const status = typeof record.status === "string" ? record.status : "";
    if (!actionId || !runId) continue;
    runs.push({ id: runId, actionItemId: actionId, status });
  }
  const runIds = runs.map((run) => run.id);
  if (!runIds.length) return { runs, findings: [], findingsReady: true };
  const findingsRes = await quietTable("agent_findings")
    .select("id, run_id, status, superseded_by, dismissed_reason, created_at")
    .in("run_id", runIds)
    .order("created_at", { ascending: false });
  if (findingsRes.error) {
    if (agentActivityUnavailable(findingsRes.error)) return { runs, findings: [], findingsReady: true };
    return { runs, findings: [], findingsReady: false };
  }
  if (!Array.isArray(findingsRes.data)) return { runs, findings: [], findingsReady: false };
  const findings: MoveFindingRow[] = [];
  for (const row of findingsRes.data) {
    if (!row || typeof row !== "object") continue;
    const record = row as {
      id?: unknown;
      run_id?: unknown;
      status?: unknown;
      superseded_by?: unknown;
      dismissed_reason?: unknown;
    };
    const id = typeof record.id === "string" ? record.id : "";
    if (!id) continue;
    findings.push({
      id,
      run_id: typeof record.run_id === "string" ? record.run_id : null,
      status: typeof record.status === "string" ? record.status : null,
      superseded_by: record.superseded_by,
      dismissed_reason: typeof record.dismissed_reason === "string" ? record.dismissed_reason : null,
    });
  }
  return { runs, findings, findingsReady: true };
}

/**
 * Open actions for this client, newest first, with the stored assignee.
 * Next moves matches these rows by move key, then by title.
 */
export async function loadClientMoveAssignments(clientId: string): Promise<MoveAssignmentRef[]> {
  const id = clientId.trim();
  if (!id) return [];
  const cached = moveAssignmentCache.get(id);
  if (cached) return cached;
  const pending = moveAssignmentLoads.get(id);
  if (pending) return pending;
  const token = {};
  const startedEpoch = moveAssignmentEpoch.get(id) ?? 0;
  moveAssignmentTokens.set(id, token);
  const load = (async (): Promise<MoveAssignmentRef[]> => {
    const { data, error } = await supabase
      .from("action_items")
      .select("id, title, source_move_key, driver_key")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error || !data) return [];
    const ids = data.map((row) => row.id).filter((value): value is string => Boolean(value));
    const assignments = await loadLatestAssignments(ids);
    const activity = await loadMoveActivity(ids);
    const rows: MoveAssignmentRef[] = data.map((row) => {
      const stored = assignments.get(row.id);
      const runs = activity.runs
        .filter((run) => run.actionItemId === row.id)
        .map((run) => ({ id: run.id, action_item_id: run.actionItemId, status: run.status }));
      const phase = phaseForAction({
        actionItemId: row.id,
        runs,
        findings: activity.findings,
        findingsReady: activity.findingsReady,
      });
      return {
        actionItemId: row.id,
        sourceMoveKey: row.source_move_key,
        driverKey: row.driver_key,
        title: row.title ?? "",
        assigneeName: stored?.name ?? null,
        assignedAt: stored?.at ?? null,
        runStatus: runs.find((run) => run.status === "queued" || run.status === "running")?.status ?? runs[0]?.status ?? null,
        draftId: phase.draftId,
        findingsReady: activity.findingsReady,
        phase: phase.phase,
        phaseLabel: phase.label,
      };
    });
    if (
      moveAssignmentTokens.get(id) === token &&
      moveLoadMayCache(startedEpoch, moveAssignmentEpoch.get(id) ?? 0)
    ) {
      moveAssignmentCache.set(id, rows);
    }
    return rows;
  })();
  moveAssignmentLoads.set(id, load);
  try {
    return await load;
  } finally {
    if (moveAssignmentLoads.get(id) === load) moveAssignmentLoads.delete(id);
  }
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
