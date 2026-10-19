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
): string {
  if (!finding) return "Nothing new from the books.";
  const text = findingSentence({
    title: finding.title,
    detail: finding.detail,
    figures: findingFigureEntries(finding.evidence),
    market,
  });
  return text || "Nothing new from the books.";
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
): OwnerPresence {
  const runs = latestRunByAgent(activity.runs);
  const newestMessage = [...activity.messages].sort(
    (a, b) => stamp(b.created_at) - stamp(a.created_at),
  )[0];
  const handoffText = newestMessage ? handoffLine(newestMessage, agentShortName) : null;
  const handoff =
    newestMessage && handoffText && newestMessage.to_agent
      ? { from: newestMessage.from_agent, to: newestMessage.to_agent, sentence: handoffText }
      : null;

  const agents = AGENT_KEYS.map((agent) => {
    const finding = latestFinding(activity.findings, agent);
    let motion = motionFor(runs[agent], finding);
    let sentence = motion === "working" ? "Working…" : sentenceFor(finding, activity.market);
    let lookAt: AgentKey | null = null;
    if (talk?.agent === agent) {
      motion = talk.mode;
      if (talk.mode === "working") sentence = "Working…";
      if (talk.mode === "speaking") sentence = "Speaking.";
      if (talk.mode === "listening") sentence = "Listening.";
    } else if (handoff && (agent === handoff.from || agent === handoff.to)) {
      lookAt = agent === handoff.from ? handoff.to : handoff.from;
      if (agent === handoff.to && motion === "idle") motion = "working";
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
