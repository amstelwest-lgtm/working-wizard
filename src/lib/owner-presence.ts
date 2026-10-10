/**
 * What each owner-door agent is doing right now.
 * Runs, findings, and hand-off messages are the only inputs.
 */
import { agentShortName } from "@/lib/milon-team";
import {
  findingFigures,
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
    figures: findingFigures(finding.evidence),
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
    return { agent, motion, sentence, lookAt };
  });

  return { agents, handoff };
}
