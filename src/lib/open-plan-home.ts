/**
 * Home and the action plan read the same open rows.
 * A hand-off paints the assigned agent's card from that list.
 */
import type { AgentKey } from "@/lib/milon-team-feed";

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
  /** Queued or running while the hand-off is in progress. Null once it has finished. */
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
 * An in-progress run wins over an older note. Otherwise the newest hand-off wins.
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
    const agent = note?.agent ?? run?.agent ?? null;
    if (!agent || agent === "financial_manager") continue;
    const active = run != null && ACTIVE.has(run.status);
    const at = Math.max(stamp(note?.at), stamp(run?.at));
    candidates.push({
      id: row.id,
      title,
      agent,
      run: run ? { agent: run.agent, status: run.status } : null,
      at,
      active,
    });
  }
  candidates.sort((a, b) => Number(b.active) - Number(a.active) || b.at - a.at);
  const best = candidates[0];
  if (!best) return null;
  const inFlight = best.active || best.run == null;
  return {
    id: best.id,
    title: best.title,
    agent: best.agent,
    run: inFlight
      ? { agent: best.agent, status: best.active && best.run ? best.run.status : "queued" }
      : null,
  };
}
