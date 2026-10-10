/**
 * Analyst allow-list and the pure parts of a background run.
 * The edge function enforces the same list before it executes a tool.
 */

import {
  canonicalEvidenceKey,
  figuresClose,
  periodEndKey,
  periodEndsMentioned,
  retryAfterFailure,
  sanitizeAgentError,
  type StoredFigures,
} from "./agent-bus.ts";
import { CLAUDE_SONNET_55 } from "./claude-request.ts";

export const ANALYST_MAX_ITERATIONS = 10;

export const FINDING_DEDUPE_DAYS = 7;

/** Share of the larger figure set that must match, key and value, to count as the same finding. */
export const FINDING_FIGURE_OVERLAP = 0.6;

export const FINDING_KINDS = [
  "weakest_pillar",
  "score_decline",
  "score_improvement",
  "working_capital_days",
  "margin_compression",
  "margin_improvement",
  "liquidity",
  "leverage",
  "revenue_trend",
  "cost_ratio",
  "data_quality",
  "other",
] as const;

export type FindingKind = (typeof FINDING_KINDS)[number];

export function findingKindAllowed(kind: string): kind is FindingKind {
  return (FINDING_KINDS as readonly string[]).includes(kind);
}

const SEVERITY_RANK: Record<string, number> = { info: 1, watch: 2, act: 3 };

/** The higher severity, when the new one outranks the one already stored. */
export function higherFindingSeverity(current: string, incoming: string): string | null {
  if ((SEVERITY_RANK[incoming] ?? 0) > (SEVERITY_RANK[current] ?? 0)) return incoming;
  return null;
}

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
    out[`pillar:${rec.id}`] = rec.score;
  }
  return out;
}

function periodText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Flat statement figures, plus one row per health pillar set, per statement-history
 * period, and per score-history period. A recorded finding is not a read: the
 * caller skips record_finding.
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
  if (Array.isArray(row.periods)) {
    for (const item of row.periods) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const period = periodText(rec.period_label) ?? periodText(rec.period_date);
      if (!period) continue;
      const figures = { ...numericFigures(rec.ratios), ...numericFigures(rec.figures) };
      if (Object.keys(figures).length === 0) continue;
      reads.push({
        snapshotId: typeof rec.snapshot_id === "string" ? rec.snapshot_id : null,
        periodLabel: period,
        figures,
      });
    }
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

/**
 * List rates in USD per million tokens. Sonnet 4.6 stays so a CLAUDE_MODEL
 * override still prices agent_runs. Cache writes are the 5-minute tier.
 */
export const CLAUDE_MODEL_RATES_USD_PER_MTOK = {
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheWrite5m: 3.75,
    cacheRead: 0.3,
  },
  "claude-sonnet-5-5": {
    input: 2,
    output: 10,
    cacheWrite5m: 2.5,
    cacheRead: 0.1,
  },
} as const;

type PricedClaudeModel = keyof typeof CLAUDE_MODEL_RATES_USD_PER_MTOK;

function ratesForModel(model: string): (typeof CLAUDE_MODEL_RATES_USD_PER_MTOK)[PricedClaudeModel] {
  if (Object.prototype.hasOwnProperty.call(CLAUDE_MODEL_RATES_USD_PER_MTOK, model)) {
    return CLAUDE_MODEL_RATES_USD_PER_MTOK[model as PricedClaudeModel];
  }
  return CLAUDE_MODEL_RATES_USD_PER_MTOK[CLAUDE_SONNET_55];
}

export function analystRunCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
  cacheReadTokens = 0,
  model = CLAUDE_SONNET_55,
): number {
  const rates = ratesForModel(model);
  const cost =
    (Math.max(0, inputTokens) * rates.input +
      Math.max(0, cacheWriteTokens) * rates.cacheWrite5m +
      Math.max(0, cacheReadTokens) * rates.cacheRead +
      Math.max(0, outputTokens) * rates.output) /
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

/** Flat numbers, or one level of `{ period: { key: value } }`, for overlap checks. */
export function flattenFindingFigures(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [inner, n] of Object.entries(value as Record<string, unknown>)) {
      if (typeof n === "number" && Number.isFinite(n)) out[`${key}|${inner}`] = n;
    }
  }
  return out;
}

/** Map a stored or legacy figure key onto the key new findings use. */
export function canonicalComparableKey(key: string, value: number, periodLabel: string | null): string {
  const pipe = key.indexOf("|");
  const period = pipe >= 0 ? key.slice(0, pipe) : periodLabel;
  const bare = pipe >= 0 ? key.slice(pipe + 1) : key;
  const lowered = bare.toLowerCase();
  if (
    (lowered === "profit" || lowered === "assets" || lowered === "financing" || lowered === "cash") &&
    value >= 0 &&
    value <= 100
  ) {
    return `pillar:${lowered}`;
  }
  if (lowered === "score" && period && /^\d{4}-\d{2}-\d{2}$/.test(period)) return `score:${period}`;
  return canonicalEvidenceKey(bare, new Set());
}

/**
 * Figure keys for dedupe. Legacy `profit` matches `pillar:profit`. A flat
 * `Debtor Days` matches the same key nested under its period label.
 */
export function comparableFindingFigures(raw: unknown, periodLabel: string | null): Record<string, number> {
  const flat = flattenFindingFigures(raw);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(flat)) {
    out[canonicalComparableKey(key, value, periodLabel)] = value;
  }
  return out;
}

/** One recorded observation in this run: kind plus the period or snapshot it cites. */
export function findingRecordKey(input: {
  kind: string;
  periodLabel: string | null;
  snapshotId: string | null;
}): string {
  return [
    normalizeFindingKind(input.kind),
    normalizeFindingText(input.periodLabel ?? ""),
    (input.snapshotId ?? "").toLowerCase(),
  ].join("\t");
}

/** Free-text kinds from before the enum, plus the enum values themselves. */
export function normalizeFindingKind(kind: string): string {
  const text = normalizeFindingText(kind);
  if ((FINDING_KINDS as readonly string[]).includes(text)) return text;
  if (text.includes("weakest") && text.includes("pillar")) return "weakest_pillar";
  if (text.startsWith("health score decline") || text.includes("score decline")) return "score_decline";
  if (text.includes("score improvement")) return "score_improvement";
  if (text.includes("debtor") && text.includes("creditor")) return "working_capital_days";
  if (text.includes("margin") && text.includes("compress")) return "margin_compression";
  if (text.includes("margin") && text.includes("improv")) return "margin_improvement";
  return text;
}

export function evidenceKeyList(reads: StoredFigures[]): string[] {
  return [...new Set(reads.flatMap((row) => Object.keys(row.figures)))].sort();
}

export function evidenceKeysNote(reads: StoredFigures[]): string | null {
  const keys = evidenceKeyList(reads);
  if (keys.length === 0) return null;
  return `evidence keys you may cite: ${keys.join(", ")}`;
}

const SCORE_HISTORY_PERIOD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Period for dedupe. A nested figures map can name it when period_label is
 * null. A date key such as 2026-10-08 is score history, not the statement period.
 */
export function dedupePeriodOf(input: { periodLabel: string | null; figures: unknown }): string | null {
  const explicit = input.periodLabel?.trim() ?? "";
  if (explicit) return explicit;
  if (!input.figures || typeof input.figures !== "object" || Array.isArray(input.figures)) return null;
  const periods: string[] = [];
  for (const [key, value] of Object.entries(input.figures as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (SCORE_HISTORY_PERIOD.test(key)) continue;
    periods.push(key);
  }
  return periods.length === 1 ? periods[0] : null;
}

function labelPeriodKeys(label: string): string[] {
  const end = periodEndKey(label);
  return end ? [end] : [normalizeFindingText(label)];
}

/** Every period end a finding names, including each nested figures key. */
export function findingPeriodKeys(input: { periodLabel: string | null; figures: unknown }): Set<string> {
  const keys = new Set<string>();
  const explicit = input.periodLabel?.trim() ?? "";
  if (explicit) for (const key of labelPeriodKeys(explicit)) keys.add(key);
  if (!input.figures || typeof input.figures !== "object" || Array.isArray(input.figures)) return keys;
  for (const [key, value] of Object.entries(input.figures as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const periodKey of labelPeriodKeys(key)) keys.add(periodKey);
  }
  return keys;
}

function sharesFindingPeriod(
  a: { periodLabel: string | null; snapshotId: string | null; figures: unknown },
  b: { periodLabel: string | null; snapshotId: string | null; figures: unknown },
): boolean {
  const left = findingPeriodKeys(a);
  const right = findingPeriodKeys(b);
  for (const key of left) {
    if (right.has(key)) return true;
  }
  return a.snapshotId != null && b.snapshotId != null && a.snapshotId === b.snapshotId;
}

/**
 * A data-quality finding that compares two periods is the Sep-versus-Oct
 * label, not a conflict inside one set of books.
 */
export function dataQualityComparesPeriods(input: { title: string; detail: string; figures: unknown }): boolean {
  const nested = findingPeriodKeys({ periodLabel: null, figures: input.figures });
  if (nested.size >= 2) return true;
  return periodEndsMentioned(`${input.title}\n${input.detail}`).size >= 2;
}

/** Matched key/value pairs divided by the larger set. 3 of 5 is 0.6. */
export function figureKeyOverlap(a: Record<string, number>, b: Record<string, number>): number {
  const left = Object.keys(a);
  const right = Object.keys(b);
  const denom = Math.max(left.length, right.length);
  if (denom === 0) return 0;
  const used = new Set<string>();
  let matched = 0;
  for (const key of left) {
    const other = right.find(
      (candidate) =>
        !used.has(candidate) &&
        candidate.toLowerCase() === key.toLowerCase() &&
        figuresClose(a[key], b[candidate]),
    );
    if (!other) continue;
    used.add(other);
    matched += 1;
  }
  return matched / denom;
}

/**
 * Same client and agent is the caller's filter. Kinds never match each other.
 * The same kind matches when any period end is shared (`1 Jan 2026 – 30 Sep 2026`
 * is Sep 2026) or the snapshot is the same, or when the figure overlap is at
 * least 60 percent.
 */
export function findingDuplicates<T extends {
  id: string;
  kind: string;
  figures: unknown;
  seenAtMs: number;
  periodLabel: string | null;
  snapshotId: string | null;
  severity: string;
}>(input: {
  nowMs: number;
  candidate: {
    kind: string;
    figures: unknown;
    periodLabel: string | null;
    snapshotId: string | null;
  };
  recent: T[];
}): T | null {
  const cutoff = input.nowMs - FINDING_DEDUPE_DAYS * 24 * 60 * 60 * 1000;
  const kind = normalizeFindingKind(input.candidate.kind);
  const candidatePeriod = dedupePeriodOf({
    periodLabel: input.candidate.periodLabel,
    figures: input.candidate.figures,
  });
  const figures = comparableFindingFigures(input.candidate.figures, candidatePeriod);
  let best: T | null = null;
  for (const row of input.recent) {
    if (row.seenAtMs < cutoff) continue;
    if (normalizeFindingKind(row.kind) !== kind) continue;
    const rowPeriod = dedupePeriodOf({ periodLabel: row.periodLabel, figures: row.figures });
    const samePeriod = sharesFindingPeriod(
      {
        periodLabel: input.candidate.periodLabel,
        snapshotId: input.candidate.snapshotId,
        figures: input.candidate.figures,
      },
      { periodLabel: row.periodLabel, snapshotId: row.snapshotId, figures: row.figures },
    );
    const overlap = figureKeyOverlap(figures, comparableFindingFigures(row.figures, rowPeriod));
    if (!samePeriod && overlap < FINDING_FIGURE_OVERLAP) continue;
    if (!best || row.seenAtMs >= best.seenAtMs) best = row;
  }
  return best;
}

/** A review that saved findings and then hit the turn cap is finished. */
export function analystRunSummary(input: { stopReason: string; summary: string }): string {
  if (input.stopReason === "cap_after_findings") {
    return "The review recorded its findings and stopped at the turn limit.";
  }
  return input.summary;
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
