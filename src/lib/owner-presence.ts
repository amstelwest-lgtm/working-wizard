/**
 * What each owner-door agent is doing right now.
 * Runs, findings, and hand-off messages are the only inputs.
 */
import { fmAvatarClip, type FmAvatarClip } from "@/lib/fm-avatar-state";
import { agentShortName } from "@/lib/milon-team";
import {
  findingFigureEntries,
  findingSentence,
  handoffLine,
  latestRunByAgent,
  type AgentActivitySnapshot,
  type AgentFindingRow,
  type AgentRunRow,
} from "@/lib/milon-team-activity";
import type { LiveHealthQuote } from "@/lib/score-prose";
import type { AgentKey } from "@/lib/milon-team-feed";
import { AGENT_KEYS } from "@/lib/milon-team-feed";

export type OwnerMotion = "idle" | "working" | "found" | "speaking" | "listening";

export type OwnerTalk = {
  agent: AgentKey;
  mode: "working" | "speaking" | "listening";
} | null;

export type OwnerAgentPresence = {
  agent: AgentKey;
  motion: OwnerMotion;
  sentence: string;
  lookAt: AgentKey | null;
  /** Character clip. The same mapping drives all three agents. */
  fmClip: FmAvatarClip | null;
};

export type OwnerPresence = {
  agents: OwnerAgentPresence[];
  handoff: { from: AgentKey; to: AgentKey; sentence: string } | null;
};

const WORKING = new Set(["queued", "running"]);
const DONE = new Set(["succeeded", "partial"]);

function stamp(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Date.parse(value);
  return Number.isNaN(n) ? 0 : n;
}

function latestFinding(
  findings: readonly AgentFindingRow[],
  agent: AgentKey,
): AgentFindingRow | null {
  let best: AgentFindingRow | null = null;
  for (const row of findings) {
    if (row.agent !== agent) continue;
    if (!best || stamp(row.created_at) > stamp(best.created_at)) best = row;
  }
  return best;
}

function sentenceFor(
  finding: AgentFindingRow | null,
  market: AgentActivitySnapshot["market"],
  liveHealth: LiveHealthQuote | null,
): string {
  if (!finding) return "Nothing new from the books.";
  const text = findingSentence({
    title: finding.title,
    detail: finding.detail,
    figures: findingFigureEntries(finding.evidence),
    market,
    liveHealth,
  });
  return text || "Nothing new from the books.";
}

/**
 * The card uses the newest queued or running run for this agent.
 * That run wins over a newer finished run that still has a finding.
 */
export function cardRunForAgent(runs: readonly AgentRunRow[], agent: AgentKey): AgentRunRow | undefined {
  let active: AgentRunRow | undefined;
  for (const run of runs) {
    if (run.agent !== agent || !WORKING.has(run.status)) continue;
    if (
      !active ||
      run.queued_at > active.queued_at ||
      (run.queued_at === active.queued_at && run.id > active.id)
    ) {
      active = run;
    }
  }
  if (active) return active;
  return latestRunByAgent(runs)[agent];
}

export function cardRunsByAgent(runs: readonly AgentRunRow[]): Partial<Record<AgentKey, AgentRunRow>> {
  const out: Partial<Record<AgentKey, AgentRunRow>> = {};
  for (const agent of AGENT_KEYS) {
    const run = cardRunForAgent(runs, agent);
    if (run) out[agent] = run;
  }
  return out;
}

export type CardHandoffRow = {
  id: string;
  agent: AgentKey | null;
  open: boolean;
  openedAt?: string;
};

/**
 * An open hand-off that is not in the live runs yet still counts as queued.
 * A finished run that landed after the click is the row's run, so it is not painted again.
 */
export function withCardHandoffRuns(
  runs: readonly AgentRunRow[],
  rows: readonly CardHandoffRow[],
): AgentRunRow[] {
  const extra: AgentRunRow[] = [];
  for (const row of rows) {
    if (!row.open || !row.agent) continue;
    const live = runs.filter((run) => run.action_item_id === row.id && run.agent === row.agent);
    if (live.some((run) => WORKING.has(run.status))) continue;
    const settled = live.some((run) => {
      if (WORKING.has(run.status)) return false;
      if (!DONE.has(run.status) && run.status !== "failed" && run.status !== "dead" && run.status !== "cancelled") {
        return false;
      }
      const at = run.finished_at || run.queued_at;
      return !row.openedAt || at >= row.openedAt;
    });
    if (settled) continue;
    extra.push({
      id: `open-${row.id}`,
      agent: row.agent,
      client_id: "",
      status: "queued",
      queued_at: row.openedAt || "1970-01-01T00:00:00.000Z",
      started_at: null,
      finished_at: null,
      action_item_id: row.id,
    });
  }
  return extra.length > 0 ? [...runs, ...extra] : [...runs];
}

function motionFor(run: AgentRunRow | undefined, finding: AgentFindingRow | null): OwnerMotion {
  if (run && WORKING.has(run.status)) return "working";
  if (run && DONE.has(run.status) && finding && stamp(finding.created_at) >= stamp(run.queued_at)) {
    return "found";
  }
  return "idle";
}

export function ownerPresence(
  activity: AgentActivitySnapshot,
  talk: OwnerTalk = null,
  liveHealth: LiveHealthQuote | null = null,
): OwnerPresence {
  const runs = cardRunsByAgent(activity.runs);
  const newestMessage =
    [...activity.messages]
      .filter((row) => handoffLine(row, agentShortName))
      .sort((a, b) => stamp(b.created_at) - stamp(a.created_at))[0] ?? null;
  const handoffText = newestMessage ? handoffLine(newestMessage, agentShortName) : null;
  const handoff =
    newestMessage && handoffText && newestMessage.to_agent
      ? { from: newestMessage.from_agent, to: newestMessage.to_agent, sentence: handoffText }
      : null;

  const agents = AGENT_KEYS.map((agent) => {
    const finding = latestFinding(activity.findings, agent);
    let motion = motionFor(runs[agent], finding);
    let sentence = motion === "working" ? "Working…" : sentenceFor(finding, activity.market, liveHealth);
    let lookAt: AgentKey | null = null;
    if (talk?.agent === agent) {
      motion = talk.mode;
      if (talk.mode === "working") sentence = "Working…";
      if (talk.mode === "speaking") sentence = "Speaking.";
      if (talk.mode === "listening") sentence = "Listening.";
    } else if (handoff && (agent === handoff.from || agent === handoff.to)) {
      lookAt = agent === handoff.from ? handoff.to : handoff.from;
      // A message between bots is not an action assignment. Working comes from
      // a stored hand-off that has not finished.
      if (agent === handoff.from && motion === "idle") motion = "found";
    }
    const fmClip = fmAvatarClip({
      talk: talk?.agent === agent ? talk.mode : null,
      run: runs[agent] ?? null,
      finding,
      handoff:
        handoff && newestMessage && (agent === handoff.from || agent === handoff.to)
          ? { at: newestMessage.created_at }
          : null,
    });
    return { agent, motion, sentence, lookAt, fmClip };
  });

  return { agents, handoff };
}

/**
 * A handed action belongs on the agent it was given to.
 * An open assignment shows Working on that card, ahead of an older
 * found-something. A queued run aimed at someone else must not leave
 * Working… on the Financial Manager while the Advisor holds the action.
 */
/**
 * Each open action hand-off shows Working on that bot.
 * A bot with no open hand-off keeps its own run or finding.
 * A message aimed at the Financial Manager does not paint Working by itself.
 */
export function steerOpenHandoffs(
  presence: OwnerPresence,
  openAgents: readonly AgentKey[],
): OwnerPresence {
  const open = new Set(openAgents);
  return {
    ...presence,
    agents: presence.agents.map((card) => {
      if (!open.has(card.agent)) return card;
      if (card.motion === "working" && card.sentence === "Working…") return card;
      return { ...card, motion: "working", sentence: "Working…" };
    }),
  };
}

export function steerAssignedWork(
  presence: OwnerPresence,
  assignee: AgentKey | null,
  run: { agent: AgentKey; status: string } | null,
): OwnerPresence {
  if (!assignee || assignee === "financial_manager") return presence;
  const active = run != null && WORKING.has(run.status);
  // No run yet means the assignment is stored and the runner has not queued.
  // A finished run keeps the card's own state, which is what a reload must show.
  const open = run == null || active;
  return {
    ...presence,
    agents: presence.agents.map((card) => {
      if (card.agent === assignee) {
        if (!open) return card;
        if (card.motion === "working" && card.sentence === "Working…") return card;
        return { ...card, motion: "working", sentence: "Working…" };
      }
      const paintedByHandoff = presence.handoff?.to === card.agent;
      const paintedByThisRun = active && run?.agent === card.agent;
      if (card.motion === "working" && (paintedByHandoff || paintedByThisRun)) {
        return { ...card, motion: "idle", sentence: "Nothing new from the books.", lookAt: null };
      }
      return card;
    }),
  };
}
