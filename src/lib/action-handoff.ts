/**
 * Assignment labels for handing an action to one of the three agents.
 * Nothing here talks to the database or starts a run.
 */
import { formatEventTime, type DateMarket } from "./market/format.ts";
import { agentShortName } from "./milon-team.ts";
import { AGENT_DISPLAY_NAME } from "./milon-team-names.ts";
import { AGENT_KEYS, type AgentKey } from "./milon-team-feed.ts";
import {
  HANDOFF_COST_STOP,
  handoffClaimsDraftsRecorded,
  handoffCouldNotDraftSentence,
  handoffResultText,
  latestHandoffResult,
} from "./owner-handoff.ts";

export { HANDOFF_COST_STOP };

const POSTER: Record<AgentKey, string> = {
  financial_manager: "/avatars/fm/fm-poster.webp",
  analyst: "/avatars/analyst/analyst-poster.webp",
  advisor: "/avatars/advisor/advisor-poster.webp",
};

/** Newest assignee label that names one of the three bots. */
export function agentKeyFromAssignee(name: string | null | undefined): AgentKey | null {
  const text = (name ?? "").trim();
  if (!text) return null;
  for (const agent of AGENT_KEYS) {
    if (text === AGENT_DISPLAY_NAME[agent] || text === agentShortName(agent)) return agent;
  }
  return null;
}

export function agentPosterSrc(agent: AgentKey): string {
  return POSTER[agent];
}

function oneSpace(text: string): string {
  return text.replace(/[ \t]{2,}/g, " ").trim();
}

export function handoffButtonLabel(agent: AgentKey, assigned: boolean, compact = false): string {
  if (assigned) return `Assigned to ${agentShortName(agent)} ✓`;
  const name = compact ? agentShortName(agent) : AGENT_DISPLAY_NAME[agent];
  return oneSpace(`Hand to ${name}`);
}

/**
 * Closed Hand to control. A bot assignee reads "Handed to <agent>" so the
 * click paints the new owner. A person, or nobody, stays "Hand to".
 * `compact` uses the short name so a 390px row does not clip the label.
 */
export function handoffTriggerLabel(assignee: string | null | undefined, compact = false): string {
  const clean = (assignee ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "Hand to";
  const agent = agentKeyFromAssignee(clean);
  const shown = compact && agent ? agentShortName(agent) : clean;
  const verb = agent ? "Handed to" : "Hand to";
  return oneSpace(`${verb} ${shown}`);
}

type HandoffMarket = DateMarket;

/**
 * When a hand-off or finish happened. Same day in the market zone is
 * "07:37 SAST" / "1:37 AM ET". Any other day includes the date.
 * An unreadable stamp stays off the row.
 */
export function handoffClock(
  at: string | null | undefined,
  market: HandoffMarket,
  now: Date | string | number = new Date(),
): string | null {
  if (!at) return null;
  return formatEventTime(at, market, now);
}

/** A queued or running hand-off that has not moved for this long offers Retry. */
export const HANDOFF_SLOW_AFTER_MS = 3 * 60 * 1000;

export function handoffCostStopped(text: string | null | undefined): boolean {
  return (text ?? "").includes(HANDOFF_COST_STOP);
}

/**
 * The face is the newest hand-off or finish note.
 * A cost-ceiling stop stays off the face and is the row status with Retry.
 */
export function assignmentNoteFace<T extends { note: string | null; at: string }>(
  notes: readonly T[],
): { face: T | null; earlier: T[] } {
  const rows = notes
    .filter((row) => {
      const text = row.note?.trim() ?? "";
      return text.length > 0 && !handoffCostStopped(text);
    })
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return { face: rows[0] ?? null, earlier: rows.slice(1) };
}

/** Friendly line for a cost-ceiling stop. Retry sits beside it on the row. */
export function handoffCouldNotFinish(agent: AgentKey): string {
  return `${agentShortName(agent)} couldn't finish this one`;
}

/** A hand-off ended and this action has no finding. Retry sits beside it. */
export function handoffCouldNotDraft(agent: AgentKey, reason?: string | null): string {
  return handoffCouldNotDraftSentence(agentShortName(agent), reason);
}

function costStopLine(note: string): string | null {
  if (!handoffCostStopped(note)) return null;
  for (const agent of AGENT_KEYS) {
    const short = agentShortName(agent);
    if (note.includes(`${short} finished`) || note.startsWith(short)) return handoffCouldNotFinish(agent);
  }
  return "Couldn't finish this one";
}

/** True once a queued or running hand-off has been sitting longer than the usual wait. */
export function handoffIsSlow(
  status: string | null | undefined,
  at: string | null | undefined,
  now = Date.now(),
): boolean {
  if (status !== "queued" && status !== "running") return false;
  if (!at) return false;
  const stamp = Date.parse(at);
  if (Number.isNaN(stamp)) return false;
  return now - stamp > HANDOFF_SLOW_AFTER_MS;
}

/**
 * One note, with who wrote it and when.
 * "Assigned to theo · by amstel.west · 20:31"
 */
export function formatAssignmentNote(
  row: {
    note: string;
    at?: string | null;
    actorLabel?: string | null;
    actorType?: string | null;
  },
  market: HandoffMarket,
  now: Date | string | number = new Date(),
): string {
  const stripped = row.note.trim().replace(/\.+$/u, "");
  const friendly = costStopLine(row.note);
  const body = friendly ?? stripped;
  const handed = stripped.startsWith("Handed to ");
  const actorNamesBot = agentKeyFromAssignee(row.actorLabel) != null;
  const hideAuthor = handed && (actorNamesBot || row.actorType === "system");
  const actor = hideAuthor ? "" : (row.actorLabel?.trim() ?? "");
  const time = handoffClock(row.at, market, now);
  const tail = [actor ? `by ${actor}` : "", time ?? ""].filter(Boolean).join(" · ");
  return tail ? `${body} · ${tail}` : body;
}

/**
 * Progress line once a queued run exists for this action.
 * "Finished" is only allowed when `draftId` is the finding saved for this action.
 * A succeeded run with no id says the bot couldn't draft this, with the reason.
 * Pass `findingsReady: false` while that list is still loading so the row stays on Working.
 */
export function handoffProgressCaption(
  agent: AgentKey,
  status: string | null | undefined,
  detail?: {
    at?: string | null;
    result?: string | null;
    market?: HandoffMarket;
    now?: Date | string | number;
    /** agent_findings id for this action. Without it, a settled run is not finished. */
    draftId?: string | null;
    /** False while findings for this client have not loaded yet. */
    findingsReady?: boolean;
  },
): string | null {
  const short = agentShortName(agent);
  if (status === "queued") return `${short} is queued`;
  if (status === "running") return `${short} picked this up`;
  const settled = status === "succeeded" || status === "partial" || status === "failed" || status === "dead";
  if (!settled) return null;
  const result = detail?.result?.replace(/\s+/g, " ").trim();
  if (handoffCostStopped(result)) return handoffCouldNotFinish(agent);
  const draftId = detail?.draftId?.trim() ?? "";
  if (!draftId) {
    if (detail?.findingsReady === false && status !== "failed" && status !== "dead") {
      return `${short} picked this up`;
    }
    return handoffCouldNotDraft(agent, result);
  }
  const time = detail?.market ? handoffClock(detail.at, detail.market, detail.now ?? new Date()) : null;
  return time ? `${short} finished · ${time}` : `${short} finished`;
}

/**
 * The queue line belongs to the bot that owns the row.
 * A person assignee drops "Advisor is queued" even if that run is still stored.
 */
export function botPickupCaption(input: {
  assignee?: string | null;
  run?: { agent: AgentKey; status: string; at?: string | null } | null;
  result?: string | null;
  resultAt?: string | null;
  market?: HandoffMarket;
  now?: Date | string | number;
  draftId?: string | null;
  findingsReady?: boolean;
}): string | null {
  const assigned = agentKeyFromAssignee(input.assignee);
  if (!input.run || !assigned || assigned !== input.run.agent) return null;
  return handoffProgressCaption(input.run.agent, input.run.status, {
    at: input.resultAt ?? input.run.at,
    result: input.result,
    market: input.market,
    now: input.now,
    draftId: input.draftId,
    findingsReady: input.findingsReady,
  });
}

export type HandoffPhase = "working" | "draft_ready" | "approved" | "sent" | "failed";

/** Chip and sent-column label. Null leaves the ordinary health and Not sent labels. */
export function handoffPhaseLabel(phase: HandoffPhase | null | undefined): string | null {
  if (phase === "working") return "Working";
  if (phase === "draft_ready") return "Draft ready";
  if (phase === "approved") return "Approved";
  if (phase === "sent") return "Sent";
  if (phase === "failed") return "Couldn't draft";
  return null;
}

export type HandoffFindingRef = {
  id: string;
  run_id?: string | null;
  status?: string | null;
  superseded_by?: unknown;
  dismissed_reason?: string | null;
};

/** Newest visible finding whose run belongs to this action. */
export function findingForAction(input: {
  actionItemId: string;
  runs: readonly { id: string; action_item_id?: string | null }[];
  findings: readonly HandoffFindingRef[];
}): HandoffFindingRef | null {
  const runIds = new Set(
    input.runs.filter((run) => run.action_item_id === input.actionItemId).map((run) => run.id),
  );
  if (runIds.size === 0) return null;
  const matches = input.findings.filter((row) => {
    if (!row.id || !row.run_id || !runIds.has(row.run_id)) return false;
    if (row.superseded_by) return false;
    if (row.status === "dismissed") return false;
    if (typeof row.dismissed_reason === "string" && row.dismissed_reason.trim()) return false;
    return true;
  });
  return matches.find((row) => row.status !== "approved") ?? matches[0] ?? null;
}

export function handoffPhaseFor(input: {
  runStatus?: string | null;
  finding?: { id: string; status?: string | null } | null;
  findingsReady: boolean;
  sentAt?: string | null;
}): HandoffPhase | null {
  const status = input.runStatus ?? "";
  if (status === "queued" || status === "running") return "working";
  const settled = status === "succeeded" || status === "partial" || status === "failed" || status === "dead";
  if (!settled) return null;
  if (input.sentAt && input.finding) return "sent";
  if (input.finding?.status === "approved") return "approved";
  if (input.finding) return "draft_ready";
  if (!input.findingsReady && status !== "failed" && status !== "dead") return "working";
  return "failed";
}

/** Hide a finish note that claims drafts were recorded when this action has no finding id. */
export function assignmentNotesForDraft<T extends { note: string | null }>(
  notes: readonly T[],
  draftId: string | null | undefined,
): T[] {
  return notes.filter((row) => {
    const text = handoffResultText(row.note);
    if (!text) return true;
    if (!draftId) return false;
    if (handoffClaimsDraftsRecorded(text)) return false;
    return true;
  });
}

type HandoffRunRef = {
  id: string;
  agent: AgentKey;
  status: string;
  at?: string;
  queued_at?: string;
  finished_at?: string | null;
  action_item_id?: string | null;
  summary?: string | null;
};

/** Caption, phase, and draft id for one action row. Finished requires a finding id. */
export function describeActionHandoff<T extends { note: string | null; at: string }>(input: {
  actionItemId: string;
  assignee?: string | null;
  sentAt?: string | null;
  notes: readonly T[];
  storedRun?: { id?: string; agent: AgentKey; status: string; at: string } | null;
  runs: readonly HandoffRunRef[];
  findings: readonly HandoffFindingRef[];
  findingsReady: boolean;
  market?: HandoffMarket;
  now?: Date | string | number;
}): {
  caption: string | null;
  run: { status: string; at?: string | null; agent?: AgentKey } | null;
  draftId: string | null;
  phase: HandoffPhase | null;
  phaseLabel: string | null;
  notes: T[];
} {
  const stored = input.storedRun ?? null;
  let live: { id: string; agent: AgentKey; status: string; at: string; summary: string } | null = null;
  for (const run of input.runs) {
    if (run.action_item_id !== input.actionItemId) continue;
    if (stored?.id && run.id !== stored.id) continue;
    const at = run.finished_at || run.at || run.queued_at || "";
    if (!live || at > live.at) {
      live = { id: run.id, agent: run.agent, status: run.status, at, summary: run.summary ?? "" };
    }
  }
  const run =
    live && stored && live.agent === stored.agent && (stored.id ? live.id === stored.id : live.at >= (stored.at || ""))
      ? { agent: live.agent, status: live.status, at: live.at }
      : stored
        ? { agent: stored.agent, status: stored.status, at: stored.at }
        : null;
  const storedResult = latestHandoffResult(input.notes);
  const liveResult =
    live && (live.status === "succeeded" || live.status === "partial") && live.summary.trim()
      ? { text: live.summary.trim(), at: live.at }
      : null;
  const result = storedResult ?? liveResult;
  const finding = findingForAction({
    actionItemId: input.actionItemId,
    runs: input.runs,
    findings: input.findings,
  });
  const draftId = finding?.id ?? null;
  const caption =
    handoffCostStopped(result?.text) && run?.agent
      ? handoffCouldNotFinish(run.agent)
      : botPickupCaption({
          assignee: input.assignee,
          run,
          result: result?.text,
          resultAt: result?.at,
          market: input.market,
          now: input.now,
          draftId,
          findingsReady: input.findingsReady,
        });
  const assigned = agentKeyFromAssignee(input.assignee);
  const phase =
    run && assigned && assigned === run.agent
      ? handoffPhaseFor({
          runStatus: run.status,
          finding,
          findingsReady: input.findingsReady,
          sentAt: input.sentAt,
        })
      : null;
  return {
    caption,
    run: run ? { status: run.status, at: run.at, agent: run.agent } : null,
    draftId,
    phase,
    phaseLabel: handoffPhaseLabel(phase),
    notes: assignmentNotesForDraft(input.notes, draftId),
  };
}
