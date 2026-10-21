/**
 * Owner hand-off rules. The edge function and the analyst runner share these.
 * Nothing here talks to the database.
 */
import {
  agentCopyStatus,
  evidenceMetrics,
  moneyMarketFromClient,
  polishAgentCopy,
  severityWithFloor,
  type AgentKey,
  type MoneyMarket,
} from "./agent-bus.ts";
import { agentDisplayNameFromKey } from "./milon-team-names.ts";
import { STARTER_TRIAL_ENDED_CODE, STARTER_TRIAL_ENDED_MESSAGE } from "./starter-trial-constants.ts";

export const HANDOFF_TRIGGER = "on_demand";

/** Stored when a run stops so it does not spend another model call. The row does not show this raw. */
export const HANDOFF_COST_STOP = "Stopped before another model call so the run stays within its cost ceiling.";
export const ANALYST_RUNNER = "agent-analyst";

export const AGENT_RUNNERS = {
  analyst: "agent-analyst",
  financial_manager: "agent-financial-manager",
  advisor: "agent-advisor",
} as const satisfies Record<AgentKey, string>;

export type HandoffDecision =
  | { ok: true; agent: AgentKey; runner: string; displayName: string; settingKey: string }
  | { ok: false; error: "unknown_agent"; missing: string };

/** Analyst keeps the original dispatch flag. The other two have their own rows. */
export function runnerSettingKey(agent: AgentKey): string {
  if (agent === "financial_manager") return "financial_manager_enabled";
  if (agent === "advisor") return "advisor_enabled";
  return "enabled";
}

export function handoffDecision(agent: string): HandoffDecision {
  if (agent !== "analyst" && agent !== "financial_manager" && agent !== "advisor") {
    return { ok: false, error: "unknown_agent", missing: "That is not one of the three bots." };
  }
  const displayName = agentDisplayNameFromKey(agent);
  if (!displayName) return { ok: false, error: "unknown_agent", missing: "That is not one of the three bots." };
  return {
    ok: true,
    agent,
    runner: AGENT_RUNNERS[agent],
    displayName,
    settingKey: runnerSettingKey(agent),
  };
}

/** Same switch as agent-dispatch. A hand-off does not start a run while this is off. */
export function runnerEnabled(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value === "true";
  return false;
}

export function callerMayHandOff(input: {
  userId: string;
  ownerUserId: string | null;
  isWorkspaceMember: boolean;
  /**
   * Practice editor from `is_client_writer`: an active practice assignment
   * whose classification can edit. A read-only seat stays false.
   * `owner_user_id` on a firm file is the accountant who added the client,
   * so a colleague on the same file is allowed through this flag.
   */
  isPracticeEditor?: boolean;
}): boolean {
  if (!input.userId) return false;
  return input.userId === input.ownerUserId || input.isWorkspaceMember || input.isPracticeEditor === true;
}

/** Shown when the hand-off is refused. The raw word "forbidden" is an access miss, not a plan. */
export const HANDOFF_FORBIDDEN_COPY =
  "This login can't hand work over on this file. Open it from the practice, or ask the accountant who added the client.";

const HANDOFF_FAILED_PLAIN = "Couldn't hand this over";

/**
 * A sentence for the toast and the inline Retry line.
 * `forbidden` is the owner-handoff access check. Trial copy is used only when
 * the server actually returns the trial code or the trial sentence.
 */
export function handoffFailureMessage(error: string | null | undefined): string {
  const raw = (error ?? "").trim();
  if (!raw || raw === HANDOFF_FAILED_PLAIN) return HANDOFF_FAILED_PLAIN;
  if (raw === "forbidden") return HANDOFF_FORBIDDEN_COPY;
  if (raw === STARTER_TRIAL_ENDED_CODE || raw === STARTER_TRIAL_ENDED_MESSAGE) return STARTER_TRIAL_ENDED_MESSAGE;
  if (/^[a-z0-9_]+$/.test(raw)) return HANDOFF_FAILED_PLAIN;
  return raw;
}

export function handoffInputs(actionItemId: string): string {
  return `action_item:${actionItemId}`;
}

/** A queued or running hand-off is the current one. A finished run is not. */
export function handoffNeedsFreshRun(status: string | null | undefined): boolean {
  return status !== "queued" && status !== "running";
}

/** A second hand-off for the same action inside this window does not start another run. */
export const HANDOFF_OPEN_WINDOW_MS = 60_000;

export type HandoffActionRun = { id: string; status: string; queuedAt: string };

/** An open run, or one whose start is still inside the window. */
export function handoffRunInWindow(
  run: HandoffActionRun,
  nowMs: number,
  windowMs = HANDOFF_OPEN_WINDOW_MS,
): boolean {
  if (!run.id) return false;
  if (run.status === "queued" || run.status === "running") return true;
  const at = Date.parse(run.queuedAt);
  return Number.isFinite(at) && nowMs >= at && nowMs - at < windowMs;
}

/**
 * The run a new hand-off must keep. The earliest start inside the window wins,
 * so a second click does not replace the one already underway.
 */
export function handoffRunToKeep(
  runs: readonly HandoffActionRun[],
  nowMs: number,
  windowMs = HANDOFF_OPEN_WINDOW_MS,
): HandoffActionRun | null {
  const live = runs.filter((run) => handoffRunInWindow(run, nowMs, windowMs));
  if (!live.length) return null;
  return [...live].sort((a, b) => {
    const delta = Date.parse(a.queuedAt) - Date.parse(b.queuedAt);
    if (delta !== 0) return delta;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  })[0] ?? null;
}

/**
 * Idempotency material for handing the same action to the same bot again.
 * The previous run id keeps a double-click on an open re-queue from starting two.
 */
export function handoffAgainInputs(actionItemId: string, previousRunId: string): string {
  return `${handoffInputs(actionItemId)}:again:${previousRunId}`;
}

export type HandoffNewestRun = { id: string; status: string };

export type HandoffRunPlan =
  | { action: "reuse"; runId: string; status: string }
  | { action: "insert"; inputs: string };

/**
 * The newest run for this action and bot decides the insert.
 * A queued or running run is reused. A finished run gets one new key.
 * The first run keeps action_item:<id>. There is no walk through older keys.
 */
export function planHandoffRun(newest: HandoffNewestRun | null, actionItemId: string): HandoffRunPlan {
  if (newest && !handoffNeedsFreshRun(newest.status)) {
    return { action: "reuse", runId: newest.id, status: newest.status };
  }
  if (!newest?.id) return { action: "insert", inputs: handoffInputs(actionItemId) };
  return { action: "insert", inputs: handoffAgainInputs(actionItemId, newest.id) };
}

/** The row that won a unique-key insert. The loser does not start another run or note. */
export function handoffCollisionResult(winner: HandoffNewestRun): {
  reused: true;
  noted: false;
  runId: string;
  status: string;
} {
  return { reused: true, noted: false, runId: winner.id, status: winner.status };
}

/** Newest hand-off note. A later sentence after the name stays out of the assignee label. */
export function handoffAssigneeName(note: string | null | undefined): string | null {
  if (!note?.startsWith("Handed to ")) return null;
  const rest = note.slice("Handed to ".length).trim();
  const name = rest.split(/[.\n]/)[0]?.trim() ?? "";
  return name || null;
}

export function handoffRequestNote(displayName: string): string {
  const name = displayName.replace(/\s+/g, " ").trim();
  return `Handed to ${name}.`;
}

/** A person on the Hand to menu. The assignee is in the text. The author is the signed-in actor. */
export function personAssignmentNote(name: string): string {
  return `Assigned to ${name}.`;
}

export function personAssignmentName(note: string | null | undefined): string | null {
  if (!note?.startsWith("Assigned to ")) return null;
  const rest = note.slice("Assigned to ".length).trim();
  const name = rest.split(/[.\n]/)[0]?.trim() ?? "";
  return name || null;
}

/** Compare a Next moves row with the action it created. Prefix and spacing do not matter. */
export function normalizeMoveLabel(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/^hand-off:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The hand-off is stored on the action, not on the move key.
 * Match the move key first, then the title with the Hand-off prefix removed.
 */
export function moveRowMatches(input: {
  moveKey: string;
  title: string;
  sourceMoveKey?: string | null;
  driverKey?: string | null;
  actionTitle?: string | null;
}): boolean {
  const key = normalizeMoveLabel(input.moveKey);
  const title = normalizeMoveLabel(input.title);
  const source = normalizeMoveLabel(input.sourceMoveKey);
  const driver = normalizeMoveLabel(input.driverKey);
  const action = normalizeMoveLabel(input.actionTitle);
  if (key && (source === key || driver === key)) return true;
  if (title && action === title) return true;
  return false;
}

export type MoveAssignmentRef = {
  actionItemId: string;
  sourceMoveKey: string | null;
  driverKey: string | null;
  title: string;
  assigneeName: string | null;
  /** When the stored hand-off note was written. A blank newer row does not replace it. */
  assignedAt?: string | null;
  runStatus?: string | null;
  draftId?: string | null;
  findingsReady?: boolean;
  /** Shared with the Action plan chip. Working or Draft ready, from every run of this action. */
  phase?: "working" | "draft_ready" | "approved" | "sent" | "failed" | null;
  phaseLabel?: string | null;
};

function assignmentStamp(row: MoveAssignmentRef): number {
  if (!row.assigneeName) return Number.NEGATIVE_INFINITY;
  const at = Date.parse(row.assignedAt ?? "");
  return Number.isFinite(at) ? at : 0;
}

/**
 * The action this Next moves row already created, when one is on file.
 * A newer row with no hand-off note does not hide the row that has one.
 * Two noted rows: the later note wins, so a reassign survives an immediate reload.
 */
export function assignmentForMove(
  rows: readonly MoveAssignmentRef[],
  moveKey: string,
  title: string,
): MoveAssignmentRef | null {
  const key = normalizeMoveLabel(moveKey);
  const matches = rows.filter((row) =>
    moveRowMatches({
      moveKey,
      title,
      sourceMoveKey: row.sourceMoveKey,
      driverKey: row.driverKey,
      actionTitle: row.title,
    }),
  );
  const exact = matches.filter(
    (row) => normalizeMoveLabel(row.sourceMoveKey) === key || normalizeMoveLabel(row.driverKey) === key,
  );
  const pool = exact.length > 0 ? exact : matches;
  if (pool.length === 0) return null;
  const noted = pool.filter((row) => row.assigneeName);
  const ranked = (noted.length > 0 ? noted : pool).slice();
  ranked.sort((a, b) => assignmentStamp(b) - assignmentStamp(a));
  return ranked[0] ?? null;
}

/** A move-list read may be cached only when it started after the latest committed hand-off. */
export function moveLoadMayCache(startedEpoch: number, currentEpoch: number): boolean {
  return startedEpoch === currentEpoch;
}

/** The draft a finished hand-off may leave for a person. The action title is the label. */
export function handoffDraftTitle(actionTitle: string): string {
  const title = actionTitle.replace(/\s+/g, " ").trim();
  if (!title) return "Hand-off draft";
  return `Hand-off: ${title}`.slice(0, 200);
}

/**
 * A second hand-off of the same action must not add another draft.
 * An existing draft already titled with the action is the same work.
 */
export function handoffDraftIsDuplicate(actionTitle: string, existingTitles: readonly string[]): boolean {
  const action = actionTitle.replace(/\s+/g, " ").trim().toLowerCase();
  if (!action) return true;
  const labelled = handoffDraftTitle(actionTitle).toLowerCase();
  return existingTitles.some((row) => {
    const key = row.replace(/\s+/g, " ").trim().toLowerCase();
    return key === action || key === labelled;
  });
}

/** Drop the team prefix so the finish note uses the short role. */
function finishedRole(displayName: string): string {
  const short = displayName.replace(/^Milōn\s+/u, "").trim();
  return short || displayName.trim() || "Milōn";
}

/** A success sentence that does not name a saved draft. It is not proof a row exists. */
export function handoffClaimsDraftsRecorded(text: string | null | undefined): boolean {
  return /drafts are recorded/i.test(text ?? "");
}

/**
 * The row says this when a hand-off ended without a finding for that action.
 * A reason that is only "drafts are recorded" is replaced: that sentence is not a draft.
 */
export function handoffCouldNotDraftSentence(displayName: string, reason?: string | null): string {
  const short = finishedRole(displayName);
  const raw = (reason ?? "").replace(/\s+/g, " ").trim();
  const already = raw.toLowerCase().startsWith(`${short.toLowerCase()} couldn't draft this`);
  if (already) return raw.replace(/\.+$/u, "").slice(0, 500);
  const generic = !raw || handoffClaimsDraftsRecorded(raw);
  const why = generic ? "no draft was saved for this action" : raw.replace(/\.+$/u, "");
  return `${short} couldn't draft this, ${why}`.slice(0, 500);
}

/** Finish note. A run with no finding does not say finished. */
export function handoffFinishNote(input: {
  displayName: string;
  summary: string;
  findingCount: number;
  market?: MoneyMarket;
  figures?: Record<string, number>;
}): string {
  if (input.findingCount > 0) {
    return handoffResultNote(input.displayName, input.summary, input.market, input.figures);
  }
  return handoffCouldNotDraftSentence(input.displayName, input.summary);
}

/**
 * The note a finished run leaves. It does not repeat "Handed to …".
 * The result is the sentence after the colon.
 */
export function handoffResultNote(
  displayName: string,
  summary: string,
  market?: MoneyMarket,
  figures?: Record<string, number>,
): string {
  const polished = polishAgentCopy({ text: summary, role: "summary", market, figures });
  const body = (polished.ok ? polished.text : summary).replace(/\s+/g, " ").trim();
  const note = body ? `${finishedRole(displayName)} finished: ${body}` : `${finishedRole(displayName)} finished.`;
  return note.slice(0, 500);
}

/** The result sentence inside a finish note. An older "Handed to" note has none. */
export function handoffResultText(note: string | null | undefined): string | null {
  if (!note) return null;
  const mark = " finished: ";
  const at = note.indexOf(mark);
  if (at < 0) return null;
  const body = note.slice(at + mark.length).trim();
  return body || null;
}

/** Newest finish note on one action. Assignment notes are left for the assignee. */
export function latestHandoffResult(
  notes: readonly { note: string | null; at: string }[],
): { text: string; at: string } | null {
  const ordered = [...notes].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  for (const row of ordered) {
    const text = handoffResultText(row.note);
    if (text) return { text, at: row.at };
  }
  return null;
}

export function handoffFinding(input: {
  summary: string;
  figures: Record<string, number> | null;
  periodLabel: string | null;
  snapshotId: string | null;
  market?: MoneyMarket;
}): { title: string; detail: string; severity: string; evidence: Record<string, unknown> } | null {
  const figures: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.figures ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) figures[key] = value;
  }
  if (Object.keys(figures).length === 0) return null;
  const market = input.market ?? moneyMarketFromClient(null);
  const polished = polishAgentCopy({
    text: input.summary,
    role: "summary",
    figures,
    market,
  });
  if (!polished.ok) return null;
  const metrics = evidenceMetrics(figures, input.periodLabel, market);
  const severity = severityWithFloor("info", metrics);
  return {
    title: polished.text.slice(0, 200),
    detail: polished.text.slice(0, 2000),
    severity,
    evidence: {
      figures,
      period_label: input.periodLabel,
      snapshot_id: input.snapshotId,
      metrics,
      status: agentCopyStatus(severity),
    },
  };
}
