/**
 * Shapes tool payloads from data MILŌN already stores.
 * Health uses ask-ai's edge pillar breakdown (the Deno-safe scorer kept in
 * lockstep with computeRatios). Cash uses summarizeCashForecast, which omits
 * balances. The advisory position is resolveNextStep — not a second workflow.
 */
import {
  ADVISORY_STATES,
  inferAdvisoryStateFromFacts,
  type AdvisoryFacts,
  type AdvisoryState,
} from "../../../src/lib/advisory-state.ts";
import {
  resolveNextStep,
  type NextStepAudience,
  type NextStepFacts,
} from "../../../src/lib/next-step.ts";
import { DISPLAY_TO_CAMEL, pillarBreakdownFromRatios } from "../ask-ai/derive-ratios.ts";
import { rankNextSteps, summarizeCashForecast } from "../ask-ai/deliverable-summaries.ts";
import type { RatioRow } from "../ask-ai/types.ts";
import type { SavedCashflow } from "../ask-ai/deliverable-summaries.ts";

const CAMEL_TO_DISPLAY: Record<string, string> = {};
for (const [display, camel] of Object.entries(DISPLAY_TO_CAMEL)) {
  CAMEL_TO_DISPLAY[camel] = display;
}

const STATEMENT_KEYS = [
  "revenue",
  "cogs",
  "grossProfit",
  "ebit",
  "netIncome",
  "cash",
  "receivables",
  "payables",
  "inventory",
  "totalAssets",
  "equity",
] as const;

const HISTORY_RATIOS = [
  "Gross Margin",
  "Net Margin",
  "Debtor Days",
  "Creditor Days",
  "Working Capital Days",
];

export function numericRecord(raw: unknown, limit = 16): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) out[key] = val;
    if (Object.keys(out).length >= limit) break;
  }
  return out;
}

export function toDisplayRatios(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (DISPLAY_TO_CAMEL[key]) out[key] = val;
    else if (CAMEL_TO_DISPLAY[key]) out[CAMEL_TO_DISPLAY[key]] = val;
  }
  return out;
}

function toCamelKey(key: string): string | null {
  if (DISPLAY_TO_CAMEL[key]) return DISPLAY_TO_CAMEL[key];
  if (CAMEL_TO_DISPLAY[key]) return key;
  return null;
}

export function shapeCompany(input: {
  name: string | null;
  businessType: string | null;
  advisoryState: string | null;
  hasFirm: boolean;
  cashRunwayWeeks: number | null;
  people: Array<{ id: string; name: string; role: string | null }>;
}): Record<string, unknown> {
  if (!input.name && !input.businessType && input.people.length === 0) {
    return { empty: true, people: [] };
  }
  return {
    empty: false,
    name: input.name,
    business_type: input.businessType,
    advisory_state: input.advisoryState,
    has_firm: input.hasFirm,
    cash_runway_weeks: input.cashRunwayWeeks,
    people: input.people.slice(0, 20).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
    })),
  };
}

export function shapeSnapshot(input: {
  periodLabel: string | null;
  periodDate: string | null;
  ratios: unknown;
  financials: unknown;
  cashRunwayWeeks: number | null;
}): Record<string, unknown> {
  const ratios = toDisplayRatios(numericRecord(input.ratios, 24));
  const totals: Record<string, number> = {};
  const fin = numericRecord(input.financials, 40);
  for (const key of STATEMENT_KEYS) {
    if (typeof fin[key] === "number") totals[key] = fin[key];
  }
  const empty =
    !input.periodLabel && Object.keys(ratios).length === 0 && Object.keys(totals).length === 0;
  return {
    empty,
    period_label: input.periodLabel,
    period_date: input.periodDate,
    ratios,
    statement_totals: totals,
    cash_runway_weeks: input.cashRunwayWeeks,
  };
}

export function shapeHealth(
  rawRatios: Record<string, number>,
  runwayWeeks: number | null,
): Record<string, unknown> {
  const display = toDisplayRatios(rawRatios);
  const pillars = pillarBreakdownFromRatios(display).map((p) => ({
    id: p.id,
    label: p.label,
    score: p.score,
  }));
  const scored = pillars.filter((p) => p.score != null) as Array<{
    id: string;
    label: string;
    score: number;
  }>;
  const overall =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((sum, p) => sum + p.score, 0) / scored.length);
  const weakest = scored.slice().sort((a, b) => a.score - b.score)[0] ?? null;
  const rows: RatioRow[] = [];
  for (const [key, val] of Object.entries(rawRatios)) {
    const camel = toCamelKey(key);
    if (!camel || !Number.isFinite(val)) continue;
    rows.push({
      key: camel,
      value: val,
      format: camel.endsWith("Days") ? "days" : "pct",
      p25: null,
      p50: null,
      p75: null,
      higher_is_better: null,
    });
  }
  const moves = rankNextSteps(rows, 3).map((m) => ({
    rank: m.rank,
    title: m.title,
    ratio: m.ratioName,
  }));
  return {
    empty: overall == null && runwayWeeks == null && moves.length === 0,
    overall,
    pillars,
    weakest: weakest ? { id: weakest.id, label: weakest.label, score: weakest.score } : null,
    cash_runway_weeks: runwayWeeks,
    priority_moves: moves,
    scorer: "ask-ai-pillar-breakdown",
  };
}

export function shapeCash(cashflow: unknown, storedRunway: number | null): Record<string, unknown> {
  const summary = summarizeCashForecast(
    cashflow && typeof cashflow === "object" ? (cashflow as SavedCashflow) : null,
    storedRunway,
  );
  if (!summary) {
    if (storedRunway == null) return { empty: true };
    return { empty: false, hasData: false, runwayWeeks: storedRunway, amounts_omitted: true };
  }
  return { empty: false, ...summary, amounts_omitted: true };
}

export function shapeHistory(
  rows: Array<{ period_label: string | null; period_date: string | null; ratios: unknown }>,
): Record<string, unknown> {
  const periods = rows.slice(0, 6).map((row) => {
    const display = toDisplayRatios(numericRecord(row.ratios, 24));
    const ratios: Record<string, number> = {};
    for (const name of HISTORY_RATIOS) {
      if (typeof display[name] === "number") ratios[name] = display[name];
    }
    return {
      period_label: row.period_label,
      period_date: row.period_date,
      ratios,
    };
  });
  return { empty: periods.length === 0, periods };
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function shapeRecommendations(
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const recommendations = rows.slice(0, 12).map((row) => ({
    id: row.id ?? null,
    title: row.title ?? null,
    status: row.status ?? null,
    priority: row.priority ?? null,
    problem: typeof row.problem === "string" ? row.problem.slice(0, 280) : null,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    expected_impact_metric: row.expected_impact_metric ?? null,
    expected_impact_amount: row.expected_impact_amount ?? null,
    linked_action_item_id: row.linked_action_item_id ?? null,
    data_depth: row.data_depth ?? null,
    decided: row.status === "approved" || row.status === "rejected" || row.status === "edited",
  }));
  recommendations.sort((a, b) => {
    const ar = PRIORITY_RANK[String(a.priority)] ?? 9;
    const br = PRIORITY_RANK[String(b.priority)] ?? 9;
    return ar - br;
  });
  return { empty: recommendations.length === 0, recommendations };
}

export function shapeOutcomes(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  const outcomes = rows.slice(0, 8).map((row) => ({
    recommendation_id: row.recommendation_id ?? null,
    metric: row.metric ?? null,
    expected_amount: row.expected_amount ?? null,
    actual_amount: row.actual_amount ?? null,
    variance_amount: row.variance_amount ?? null,
    period_label: row.period_label ?? null,
    measured_at: row.measured_at ?? null,
  }));
  return { empty: outcomes.length === 0, outcomes };
}

export function shapeTasks(input: {
  outcomeGoal: string | null;
  items: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  const open = input.items
    .filter((item) => item.status !== "done")
    .slice(0, 20)
    .map((item) => ({
      id: item.id ?? null,
      title: item.title ?? null,
      status: item.status ?? null,
      due_date: item.due_date ?? null,
      owner_id: item.owner_id ?? null,
      owner_name: item.owner_name ?? null,
      recommendation_id: item.recommendation_id ?? null,
    }));
  const doneCount = input.items.filter((item) => item.status === "done").length;
  if (!input.outcomeGoal && open.length === 0 && doneCount === 0) return { empty: true, open: [] };
  return {
    empty: false,
    outcome_goal: input.outcomeGoal,
    open,
    done_count: doneCount,
  };
}

export function shapeDataRequests(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  const requests = rows.slice(0, 10).map((row) => ({
    id: row.id ?? null,
    kind: row.kind ?? null,
    severity: row.severity ?? null,
    status: row.status ?? null,
    title: typeof row.title === "string" ? row.title.slice(0, 160) : null,
    reason: typeof row.reason === "string" ? row.reason.slice(0, 200) : null,
  }));
  return { empty: requests.length === 0, requests };
}

export function coerceAdvisoryState(raw: string | null, facts: AdvisoryFacts): AdvisoryState {
  if (raw && (ADVISORY_STATES as readonly string[]).includes(raw)) return raw as AdvisoryState;
  return inferAdvisoryStateFromFacts(facts);
}

export function shapeAdvisoryPosition(
  facts: NextStepFacts,
  audience: NextStepAudience,
): Record<string, unknown> {
  const step = resolveNextStep(facts, audience);
  return {
    empty: false,
    state: step.state,
    state_label: step.stateLabel,
    urgency: step.urgency,
    next_step: step.title,
    reason: step.reason,
    outstanding: step.outstanding,
  };
}
