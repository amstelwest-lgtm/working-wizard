/**
 * Analyst allow-list and the pure parts of a background run.
 * The edge function enforces the same list before it executes a tool.
 */

import { retryAfterFailure, sanitizeAgentError, type StoredFigures } from "./agent-bus.ts";

export const ANALYST_MAX_ITERATIONS = 10;

export const FINDING_DEDUPE_DAYS = 7;

export const ANALYST_READ_TOOLS = [
  "get_health",
  "get_ratios",
  "get_variance",
  "get_financial_snapshot",
  "get_statement_history",
  "get_data_freshness",
  "get_score_history",
] as const;

export const ANALYST_WRITE_TOOLS = ["record_finding"] as const;

export const ANALYST_TOOLS = [...ANALYST_READ_TOOLS, ...ANALYST_WRITE_TOOLS] as const;

export type AnalystToolName = (typeof ANALYST_TOOLS)[number];

export const ANALYST_TOOL_LABELS: Record<AnalystToolName, string> = {
  get_health: "Health",
  get_ratios: "Ratios",
  get_variance: "Variance",
  get_financial_snapshot: "Statements",
  get_statement_history: "History",
  get_data_freshness: "Freshness",
  get_score_history: "Score history",
  record_finding: "Finding",
};

const STATEMENT_KEYS = [
  "revenue",
  "cogs",
  "grossProfit",
  "netIncome",
  "cash",
  "receivables",
  "payables",
  "inventory",
  "totalAssets",
  "equity",
] as const;

export function analystToolAllowed(name: string): name is AnalystToolName {
  return (ANALYST_TOOLS as readonly string[]).includes(name);
}

/** Refuses anything outside the analyst list, including milon-bot write tools. */
export function executeAnalystGate(
  name: string,
): { allowed: true; name: AnalystToolName } | { allowed: false; error: string; tool_blocked: true; tool: string } {
  if (!analystToolAllowed(name)) {
    return {
      allowed: false,
      error: "MILŌN refused that tool. It is not on the analyst allow-list.",
      tool_blocked: true,
      tool: name,
    };
  }
  return { allowed: true, name };
}

export function numericFigures(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** Change between two stored statement totals. No figure is invented. */
export function statementVariance(
  current: Record<string, number>,
  prior: Record<string, number>,
): Record<string, { current: number; prior: number; delta: number }> {
  const out: Record<string, { current: number; prior: number; delta: number }> = {};
  for (const key of STATEMENT_KEYS) {
    const now = current[key];
    const then = prior[key];
    if (typeof now === "number" && typeof then === "number") {
      out[key] = { current: now, prior: then, delta: now - then };
    }
  }
  return out;
}

export function collectStoredFigures(
  payload: unknown,
  snapshot: { snapshotId: string | null; periodLabel: string | null },
): StoredFigures | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const figures = {
    ...numericFigures(row.statement_totals),
    ...numericFigures(row.figures),
    ...numericFigures(row.ratios),
    ...numericFigures(row.stored_ratios),
  };
  for (const key of [
    "overall",
    "live_overall",
    "stored_score",
    "revenue",
    "cash",
    "debtor_days",
    "creditor_days",
    "gross_margin",
    "net_margin",
  ]) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) figures[key] = value;
  }
  if (Object.keys(figures).length === 0) return null;
  const period =
    snapshot.periodLabel ??
    (typeof row.period_label === "string" ? row.period_label : null);
  const id =
    snapshot.snapshotId ?? (typeof row.snapshot_id === "string" ? row.snapshot_id : null);
  return { snapshotId: id, periodLabel: period, figures };
}

function pillarScores(raw: unknown): Record<string, number> {
  if (!Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== "string" || typeof rec.score !== "number" || !Number.isFinite(rec.score)) continue;
    out[rec.id] = rec.score;
  }
  return out;
}

/**
 * Flat statement figures, plus one row per health pillar set and per score-history
 * period. A recorded finding is not a read: the caller skips record_finding.
 */
export function collectStoredReads(
  payload: unknown,
  snapshot: { snapshotId: string | null; periodLabel: string | null },
): StoredFigures[] {
  if (!payload || typeof payload !== "object") return [];
  const row = payload as Record<string, unknown>;
  const reads: StoredFigures[] = [];
  const pillars = pillarScores(row.pillars);
  const flat = collectStoredFigures(payload, snapshot);
  if (flat) {
    reads.push({ ...flat, figures: { ...pillars, ...flat.figures } });
  } else if (Object.keys(pillars).length > 0) {
    const period =
      snapshot.periodLabel ?? (typeof row.period_label === "string" ? row.period_label : null);
    const id = snapshot.snapshotId ?? (typeof row.snapshot_id === "string" ? row.snapshot_id : null);
    reads.push({ snapshotId: id, periodLabel: period, figures: pillars });
  }
  if (Array.isArray(row.scores)) {
    for (const item of row.scores) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const period = typeof rec.period_date === "string" ? rec.period_date : null;
      if (!period || typeof rec.score !== "number" || !Number.isFinite(rec.score)) continue;
      reads.push({
        snapshotId: null,
        periodLabel: period,
        figures: { score: rec.score, [`score:${period}`]: rec.score },
      });
    }
  }
  return reads;
}

/** Sonnet 4.6 list rates: $3 / MTok in, $15 / MTok out. Cache write is 1.25×, cache read is 0.1×. */
export function analystRunCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
  cacheReadTokens = 0,
): number {
  const cost =
    (Math.max(0, inputTokens) * 3 +
      Math.max(0, cacheWriteTokens) * 3.75 +
      Math.max(0, cacheReadTokens) * 0.3 +
      Math.max(0, outputTokens) * 15) /
    1_000_000;
  return Math.round(cost * 100_000) / 100_000;
}

/**
 * The stored score wins when one is on file. live_overall stays labeled as a
 * recalculation, so a finding cannot treat it as the saved score.
 */
export function labelHealthScore(input: {
  liveOverall: number | null;
  storedScore: number | null;
  storedAsOf: string | null;
}): {
  overall: number | null;
  overall_as_of: string | null;
  overall_basis: "stored" | "live";
  live_overall: number | null;
  live_overall_label: string;
  stored_score: number | null;
  pillars_basis: "live";
} {
  if (input.storedScore != null) {
    return {
      overall: input.storedScore,
      overall_as_of: input.storedAsOf,
      overall_basis: "stored",
      live_overall: input.liveOverall,
      live_overall_label: "Recalculated from the current books. Not the stored score.",
      stored_score: input.storedScore,
      pillars_basis: "live",
    };
  }
  return {
    overall: input.liveOverall,
    overall_as_of: null,
    overall_basis: "live",
    live_overall: input.liveOverall,
    live_overall_label: "Recalculated from the current books. No stored score is on file.",
    stored_score: null,
    pillars_basis: "live",
  };
}

export function normalizeFindingText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function figureSignature(figures: Record<string, number>): string {
  return Object.keys(figures)
    .sort()
    .map((key) => `${key}=${figures[key]}`)
    .join("|");
}

/** Same client and agent is the caller's filter. Match kind+title, or the same figures, inside 7 days. */
export function findingDuplicates<T extends {
  id: string;
  kind: string;
  title: string;
  figures: Record<string, number>;
  seenAtMs: number;
}>(input: {
  nowMs: number;
  candidate: { kind: string; title: string; figures: Record<string, number> };
  recent: T[];
}): T | null {
  const cutoff = input.nowMs - FINDING_DEDUPE_DAYS * 24 * 60 * 60 * 1000;
  const kind = normalizeFindingText(input.candidate.kind);
  const title = normalizeFindingText(input.candidate.title);
  const figures = figureSignature(input.candidate.figures);
  let best: T | null = null;
  for (const row of input.recent) {
    if (row.seenAtMs < cutoff) continue;
    const sameText =
      normalizeFindingText(row.kind) === kind && normalizeFindingText(row.title) === title;
    const sameFigures = figures.length > 0 && figureSignature(row.figures) === figures;
    if (!sameText && !sameFigures) continue;
    if (!best || row.seenAtMs >= best.seenAtMs) best = row;
  }
  return best;
}

/**
 * Hitting the iteration cap after a saved finding is a finished review.
 * A cap with no finding, or any earlier safety stop, stays partial.
 */
export function analystRunOutcome(input: {
  stopReason: string;
  steps: Array<{ tool: string | null; status: string }>;
  maxIterations: number;
}): { status: "succeeded" | "partial"; stopReason: string } {
  const accepted = input.steps.filter((step) => step.tool === "record_finding" && step.status === "ok").length;
  const hitCap =
    input.stopReason === "safety_limit" &&
    input.steps.length >= input.maxIterations &&
    accepted >= 1;
  if (hitCap) return { status: "succeeded", stopReason: "cap_after_findings" };
  const partial =
    input.stopReason === "insufficient_information" || input.stopReason === "safety_limit";
  return { status: partial ? "partial" : "succeeded", stopReason: input.stopReason };
}

export function analystFailureIsRetryable(message: string): boolean {
  if (/rate limit/i.test(message)) return true;
  const match = message.match(/\((\d{3})\)/);
  if (match) {
    const code = Number(match[1]);
    if (code === 429 || code >= 500) return true;
    if (code >= 400 && code < 500) return false;
  }
  return true;
}

export function analystFailurePlan(attempt: number, message: string):
  | { action: "dead"; error: string }
  | { action: "retry"; delaySeconds: number; error: string }
  | { action: "dead_letter"; error: string } {
  const error = sanitizeAgentError(message);
  if (!analystFailureIsRetryable(message)) return { action: "dead", error };
  const next = retryAfterFailure(attempt);
  if (next.action === "dead_letter") return { action: "dead_letter", error };
  return { action: "retry", delaySeconds: next.delaySeconds, error };
}
