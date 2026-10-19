/**
 * Home and the action plan read the same open rows.
 * Each row keeps its own assignee. A bot card shows Working only while
 * that bot has a stored, not-finished hand-off on at least one row.
 */
import { agentKeyFromAssignee } from "@/lib/action-handoff";
import type { AgentKey } from "@/lib/milon-team-feed";
import { handoffAssigneeName, personAssignmentName } from "@/lib/owner-handoff";

const ACTIVE = new Set(["queued", "running"]);

export type OpenPlanHomeRow = {
  id: string;
  title: string;
};

export type OpenPlanHandoffNote = {
  agent: AgentKey;
  at: string;
};

export type OpenPlanHandoffRun = {
  agent: AgentKey;
  status: string;
  at?: string;
};

export type HandedHomeAction = {
  id: string;
  title: string;
  agent: AgentKey;
  /**
   * Queued or running while this assignment is open.
   * A finished run keeps its status so Home does not paint it as a new hand-off.
   */
  run: { agent: AgentKey; status: string } | null;
};

function stamp(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Date.parse(value);
  return Number.isNaN(n) ? 0 : n;
}

/** Titles in plan order. Blank titles drop out. Duplicates stay once. */
export function openPlanTitles(rows: readonly { title?: string | null }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const title = row.title?.trim() ?? "";
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push(title);
  }
  return out;
}

/**
 * The open action that belongs on an agent card.
 * The newest hand-off wins, including over an older run that is still queued.
 * The Financial Manager keeps the unassigned cash line, so a hand-off to that bot
 * does not move the card.
 */
export function handedHomeAction(
  rows: readonly OpenPlanHomeRow[],
  notes: ReadonlyMap<string, OpenPlanHandoffNote>,
  runs: ReadonlyMap<string, OpenPlanHandoffRun>,
): HandedHomeAction | null {
  type Candidate = HandedHomeAction & { at: number; active: boolean };
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const title = row.title.trim();
    if (!row.id || !title) continue;
    const note = notes.get(row.id) ?? null;
    const run = runs.get(row.id) ?? null;
    // A newer note for a different bot is the assignment. The previous bot's run is not.
    const matched = run && (!note || run.agent === note.agent) ? run : null;
    const agent = note?.agent ?? run?.agent ?? null;
    if (!agent || agent === "financial_manager") continue;
    const active = matched != null && ACTIVE.has(matched.status);
    const at = Math.max(stamp(note?.at), stamp(matched?.at));
    const open = matched == null || active;
    candidates.push({
      id: row.id,
      title,
      agent,
      run: open
        ? { agent, status: active && matched ? matched.status : "queued" }
        : { agent, status: matched?.status ?? "succeeded" },
      at,
      active,
    });
  }
  candidates.sort((a, b) => b.at - a.at || Number(b.active) - Number(a.active));
  const best = candidates[0];
  if (!best) return null;
  return {
    id: best.id,
    title: best.title,
    agent: best.agent,
    run: best.run,
  };
}

export type StoredAssignment =
  | { kind: "bot"; agent: AgentKey; name: string; at: string }
  | { kind: "person"; name: string; at: string };

export type AssignmentNote = { note: string | null; at: string };

/**
 * The newest assignment note on one action.
 * A progress note is not an assignment, so it does not hide the one before it.
 * Older notes stay in the log.
 */
export function latestStoredAssignment(notes: readonly AssignmentNote[]): StoredAssignment | null {
  const ordered = [...notes].sort((a, b) => stamp(b.at) - stamp(a.at));
  for (const row of ordered) {
    const botName = handoffAssigneeName(row.note);
    const agent = agentKeyFromAssignee(botName);
    if (agent && botName) return { kind: "bot", agent, name: botName, at: row.at };
    const person = personAssignmentName(row.note);
    if (person) return { kind: "person", name: person, at: row.at };
  }
  return null;
}

export type RowAssignment = {
  id: string;
  assigneeName: string | null;
  agent: AgentKey | null;
  /** This row's bot hand-off is stored and has not finished. */
  open: boolean;
};

/**
 * One row's button label and whether its bot is still Working.
 * The person on the action is the assignee only when no later hand-off note names a bot.
 * A finished run for that bot keeps the name and drops Working.
 */
export function rowAssignment(input: {
  id: string;
  ownerName?: string | null;
  notes: readonly AssignmentNote[];
  run?: { agent: AgentKey; status: string; at?: string } | null;
}): RowAssignment {
  const stored = latestStoredAssignment(input.notes);
  if (!stored) {
    const owner = input.ownerName?.trim() || null;
    return { id: input.id, assigneeName: owner, agent: null, open: false };
  }
  if (stored.kind === "person") {
    return { id: input.id, assigneeName: stored.name, agent: null, open: false };
  }
  const matched = input.run && input.run.agent === stored.agent ? input.run : null;
  const open = matched == null || ACTIVE.has(matched.status);
  return { id: input.id, assigneeName: stored.name, agent: stored.agent, open };
}

export type LiveHandoffRun = {
  actionItemId?: string | null;
  agent: AgentKey;
  status: string;
  at?: string;
};

/**
 * A live run settles the optimistic Working flag.
 * No live run yet keeps the row as it was. A finished run for that bot drops Working.
 */
export function applyLiveRuns(
  rows: readonly RowAssignment[],
  runs: readonly LiveHandoffRun[],
): RowAssignment[] {
  const latest = new Map<string, { agent: AgentKey; status: string }>();
  const ordered = [...runs].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  for (const run of ordered) {
    const id = run.actionItemId ?? "";
    if (!id || latest.has(id)) continue;
    latest.set(id, { agent: run.agent, status: run.status });
  }
  return rows.map((row) => {
    if (!row.open || !row.agent) return row;
    const run = latest.get(row.id);
    if (!run || run.agent !== row.agent) return row;
    if (ACTIVE.has(run.status)) return row;
    return { ...row, open: false };
  });
}

/** Rows whose assignee is a person, so a leftover bot run must not paint Working. */
export function personOwnedActionIds(rows: readonly RowAssignment[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.agent || !row.assigneeName?.trim()) continue;
    if (agentKeyFromAssignee(row.assigneeName)) continue;
    ids.add(row.id);
  }
  return ids;
}

/**
 * A queued bot run on a person-owned row is not that bot's current work.
 * It stays out of the card. The hand-off function cancels the stored row.
 */
export function withoutPersonQueuedRuns<T extends { action_item_id?: string | null; status: string }>(
  runs: readonly T[],
  personActions: ReadonlySet<string>,
): T[] {
  if (personActions.size === 0) return [...runs];
  return runs.filter((run) => {
    if (!run.action_item_id || !personActions.has(run.action_item_id)) return true;
    return !ACTIVE.has(run.status);
  });
}

/** Bots that own a not-finished hand-off on at least one row. */
export function openHandoffAgents(rows: readonly Pick<RowAssignment, "agent" | "open">[]): AgentKey[] {
  const seen = new Set<AgentKey>();
  const out: AgentKey[] = [];
  for (const row of rows) {
    if (!row.open || !row.agent || seen.has(row.agent)) continue;
    seen.add(row.agent);
    out.push(row.agent);
  }
  return out;
}

/**
 * A hand-off that just landed stays on that row until its note is stored.
 * Other rows keep the assignees already on file.
 */
export function withPendingAssignment(
  rows: readonly RowAssignment[],
  pending: { id: string; agent: AgentKey | null; assigneeName: string } | null,
  stored: StoredAssignment | null,
): RowAssignment[] {
  if (!pending) return [...rows];
  const landed =
    stored?.kind === "bot"
      ? stored.agent === pending.agent
      : stored?.kind === "person"
        ? pending.agent == null && stored.name === pending.assigneeName
        : false;
  if (landed) return [...rows];
  const next = {
    id: pending.id,
    assigneeName: pending.assigneeName,
    agent: pending.agent,
    open: pending.agent != null,
  };
  if (!rows.some((row) => row.id === pending.id)) return [...rows, next];
  return rows.map((row) => (row.id === pending.id ? next : row));
}

/**
 * A hand-off that just landed stays on that agent until its note is stored.
 * A refetch that still sees the previous assignee must not paint them again.
 */
export function preferPendingHandoff(
  loaded: HandedHomeAction | null,
  pending: { id: string; title: string; agent: AgentKey } | null,
  notes: ReadonlyMap<string, { agent: AgentKey }>,
): HandedHomeAction | null {
  if (!pending || pending.agent === "financial_manager") return loaded;
  if (notes.get(pending.id)?.agent === pending.agent) return loaded;
  return {
    id: pending.id,
    title: pending.title,
    agent: pending.agent,
    run: { agent: pending.agent, status: "queued" },
  };
}
