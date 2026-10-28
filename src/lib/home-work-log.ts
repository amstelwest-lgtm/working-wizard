/**
 * Team progress on accountant client Home: who did what, when, and what is next.
 * Rows come from handed-off actions and the drafts the agents saved.
 * Draft rows name the document kind, never the stored sentence, so a stale
 * figure in a draft body is not quoted here. The draft itself is one click away.
 */
import { draftFindingKindLabel } from "@/hooks/owner-agent-ui";
import { agentKeyFromAssignee, handoffCostStopped } from "@/lib/action-handoff";
import { agentShortName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";
import { isVisibleAgentFinding } from "@/lib/milon-team-activity";
import { latestHandoffResult } from "@/lib/owner-handoff";
import { actionDisplayTitle } from "@/lib/strategic-moves";

export type WorkLogState = "working" | "ready" | "approved" | "stopped" | "assigned";

export type WorkLogRow = {
  key: string;
  /** ISO time of the latest step. Null sorts last. */
  at: string | null;
  who: string;
  what: string;
  state: WorkLogState;
  status: string;
  next: string | null;
  draftId: string | null;
  /** Set when the row offers Retry. */
  retry: { actionItemId: string; title: string; agent: AgentKey } | null;
};

export type WorkLogHandoff = {
  id: string;
  title: string;
  assignee?: string | null;
  agent?: AgentKey | null;
  openedAt?: string;
  missed?: boolean;
  error?: string | null;
  run?: { id?: string; agent: AgentKey; status: string; at?: string | null } | null;
  draftId?: string | null;
  findingsReady?: boolean;
  notes?: readonly { note: string | null; at: string }[];
};

export type WorkLogFinding = {
  id: string;
  agent: AgentKey;
  kind?: string | null;
  evidence: unknown;
  created_at: string;
  status?: string | null;
  approved_at?: string | null;
  superseded_by?: unknown;
  dismissed_reason?: string | null;
};

export const WORK_LOG_LIMIT = 8;

const DRAFTED: Record<string, string> = {
  "Action point": "Drafted an action point",
  "Data request": "Drafted a data request",
  "Accountant hand-off": "Drafted a hand-off note",
  "Next move": "Drafted a next move",
  Advisory: "Drafted advisory notes",
};

const NEXT_DRAFT = "Draft to follow";
const NEXT_REVIEW = "Review the draft";
const NEXT_RETRY = "Hand it on again";

function handoffRow(row: WorkLogHandoff, findings: readonly WorkLogFinding[]): WorkLogRow | null {
  const assignee = row.assignee?.trim() ?? "";
  const agent = row.run?.agent ?? row.agent ?? agentKeyFromAssignee(assignee);
  if (!agent && !assignee) return null;
  const what = actionDisplayTitle(row.title) || row.title.trim();
  if (!what) return null;
  const result = latestHandoffResult(row.notes ?? []);
  const at = row.run?.at ?? result?.at ?? row.openedAt ?? null;
  const base = { key: `action-${row.id}`, at, what, draftId: null, retry: null };
  if (!agent) {
    return {
      ...base,
      who: assignee,
      state: "assigned",
      status: "Assigned",
      next: "Awaiting their update",
    };
  }
  const who = agentShortName(agent);
  const retry = { actionItemId: row.id, title: row.title, agent };
  const stopped = (status: string): WorkLogRow => ({
    ...base,
    who,
    state: "stopped",
    status,
    next: NEXT_RETRY,
    retry,
  });
  if (row.error) return stopped("Didn't start");
  if (row.missed) return stopped("Not started");
  if (handoffCostStopped(result?.text)) return stopped("Stopped");
  const status = row.run?.status ?? "queued";
  if (status === "failed" || status === "dead") return stopped("Didn't finish");
  if (status === "running")
    return { ...base, who, state: "working", status: "Working", next: NEXT_DRAFT };
  if (status === "succeeded" || status === "partial") {
    const draftId = row.draftId?.trim() || null;
    if (draftId) {
      const approved = findings.find((item) => item.id === draftId)?.status === "approved";
      return approved
        ? { ...base, who, draftId, state: "approved", status: "Approved", next: null }
        : { ...base, who, draftId, state: "ready", status: "Draft ready", next: NEXT_REVIEW };
    }
    if (row.findingsReady === false)
      return { ...base, who, state: "working", status: "Working", next: NEXT_DRAFT };
    return stopped("No draft");
  }
  return { ...base, who, state: "working", status: "Queued", next: NEXT_DRAFT };
}

function draftRow(row: WorkLogFinding): WorkLogRow | null {
  const kind = draftFindingKindLabel(row);
  if (!kind) return null;
  const approved = row.status === "approved";
  return {
    key: `draft-${row.id}`,
    at: (approved ? row.approved_at : null) ?? row.created_at,
    who: agentShortName(row.agent),
    what: DRAFTED[kind] ?? `Drafted: ${kind}`,
    state: approved ? "approved" : "ready",
    status: approved ? "Approved" : "Draft ready",
    next: approved ? null : NEXT_REVIEW,
    draftId: row.id,
    retry: null,
  };
}

/** Newest first. `more` counts the rows past the limit. */
export function homeWorkLog(input: {
  handoffs: readonly WorkLogHandoff[];
  findings: readonly WorkLogFinding[];
  limit?: number;
}): { rows: WorkLogRow[]; more: number } {
  const linked = new Set(input.handoffs.map((row) => row.draftId?.trim()).filter(Boolean));
  const rows = [
    ...input.handoffs.flatMap((row) => handoffRow(row, input.findings) ?? []),
    ...input.findings
      .filter((row) => isVisibleAgentFinding(row) && !linked.has(row.id))
      .flatMap((row) => draftRow(row) ?? []),
  ].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const limit = input.limit ?? WORK_LOG_LIMIT;
  return { rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit) };
}
