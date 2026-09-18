/**
 * Recommendation + outcome model — pure helpers (P0.2 of the advisory OS).
 *
 * The recommendation object IS `proposed_next_steps`, extended by
 * `supabase/migrations/20260918130000_recommendations_outcomes.sql`. This file
 * holds the vocabulary, parsers, ordering, the root-cause copy rules and the
 * outcome verdict logic. No network.
 */
import type { Json } from "@/integrations/supabase/types";
import type { ProposedNextStep } from "@/lib/client-brain";

export const RECOMMENDATION_STATUSES = [
  "proposed",
  "approved",
  "edited",
  "rejected",
  "superseded",
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const RECOMMENDATION_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITIES)[number];

export const IMPACT_METRICS = [
  "cash",
  "profit",
  "revenue",
  "gross_margin",
  "debtor_days",
  "creditor_days",
  "stock_days",
  "other",
] as const;
export type ImpactMetric = (typeof IMPACT_METRICS)[number];

/** Metrics where a LOWER number is the improvement. */
export const LOWER_IS_BETTER: ReadonlySet<ImpactMetric> = new Set(["debtor_days", "stock_days"]);

export const DATA_DEPTHS = ["statement", "transaction"] as const;
export type DataDepth = (typeof DATA_DEPTHS)[number];

export const RECOMMENDATION_SOURCES = ["ai", "accountant", "owner", "system"] as const;
export type RecommendationSource = (typeof RECOMMENDATION_SOURCES)[number];

export const OUTCOME_METHODS = ["snapshot_diff", "forecast_vs_actual", "manual"] as const;
export type OutcomeMethod = (typeof OUTCOME_METHODS)[number];

export type EvidenceRef = {
  kind: "ratio" | "pillar" | "forecast" | "fact" | "transaction";
  key: string;
  label?: string;
  value?: number | string | null;
  snapshot_id?: string | null;
};

export type Recommendation = ProposedNextStep & {
  status: RecommendationStatus;
  cycle_id: string | null;
  problem: string | null;
  evidence: EvidenceRef[];
  priority: RecommendationPriority;
  confidence: number | null;
  data_depth: DataDepth;
  expected_impact_metric: ImpactMetric | null;
  expected_impact_amount: number | null;
  expected_impact_horizon_days: number | null;
  expected_impact_note: string | null;
  source: RecommendationSource;
  superseded_by: string | null;
  decided_at: string | null;
  decided_by: string | null;
};

export type RecommendationOutcome = {
  id: string;
  client_id: string;
  recommendation_id: string;
  cycle_id: string | null;
  metric: ImpactMetric;
  expected_amount: number | null;
  actual_amount: number | null;
  variance_amount: number | null;
  method: OutcomeMethod;
  baseline_snapshot_id: string | null;
  measured_snapshot_id: string | null;
  period_label: string | null;
  measured_at: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// ── Parsing ──────────────────────────────────────────────────────────────────

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseEvidence(v: Json | unknown): EvidenceRef[] {
  if (!Array.isArray(v)) return [];
  const out: EvidenceRef[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const kind = oneOf(
      r.kind,
      ["ratio", "pillar", "forecast", "fact", "transaction"] as const,
      "fact",
    );
    const key = typeof r.key === "string" ? r.key : "";
    if (!key) continue;
    out.push({
      kind,
      key,
      label: typeof r.label === "string" ? r.label : undefined,
      value: typeof r.value === "number" || typeof r.value === "string" ? r.value : null,
      snapshot_id: typeof r.snapshot_id === "string" ? r.snapshot_id : null,
    });
  }
  return out;
}

/**
 * Accepts a raw `proposed_next_steps` row from before OR after the P0.2
 * migration and returns a fully-populated Recommendation with safe defaults.
 */
export function parseRecommendationRow(row: Record<string, unknown>): Recommendation {
  const base = row as unknown as ProposedNextStep;
  return {
    ...base,
    status: oneOf(row.status, RECOMMENDATION_STATUSES, "proposed"),
    cycle_id: typeof row.cycle_id === "string" ? row.cycle_id : null,
    problem: typeof row.problem === "string" ? row.problem : null,
    evidence: parseEvidence(row.evidence),
    priority: oneOf(row.priority, RECOMMENDATION_PRIORITIES, "medium"),
    confidence: clampConfidence(numOrNull(row.confidence)),
    data_depth: oneOf(row.data_depth, DATA_DEPTHS, "statement"),
    expected_impact_metric: row.expected_impact_metric
      ? oneOf(row.expected_impact_metric, IMPACT_METRICS, "other")
      : null,
    expected_impact_amount: numOrNull(row.expected_impact_amount),
    expected_impact_horizon_days: numOrNull(row.expected_impact_horizon_days),
    expected_impact_note:
      typeof row.expected_impact_note === "string" ? row.expected_impact_note : null,
    source: oneOf(row.source, RECOMMENDATION_SOURCES, "ai"),
    superseded_by: typeof row.superseded_by === "string" ? row.superseded_by : null,
    decided_at: typeof row.decided_at === "string" ? row.decided_at : null,
    decided_by: typeof row.decided_by === "string" ? row.decided_by : null,
  };
}

export function clampConfidence(v: number | null): number | null {
  if (v === null) return null;
  return Math.min(1, Math.max(0, v));
}

// ── Ordering / status ────────────────────────────────────────────────────────

const PRIORITY_RANK: Record<RecommendationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function isOpenRecommendation(r: Pick<Recommendation, "status">): boolean {
  return r.status === "proposed";
}

export function isActionable(r: Pick<Recommendation, "status">): boolean {
  return r.status === "approved" || r.status === "edited";
}

/** Critical first, then higher confidence, then newest. Closed ones sink. */
export function sortRecommendations<
  T extends Pick<Recommendation, "status" | "priority" | "confidence" | "created_at">,
>(rows: readonly T[]): T[] {
  const closedRank = (s: RecommendationStatus) => (s === "rejected" || s === "superseded" ? 1 : 0);
  return [...rows].sort((a, b) => {
    const c = closedRank(a.status) - closedRank(b.status);
    if (c !== 0) return c;
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    const conf = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (conf !== 0) return conf;
    return b.created_at.localeCompare(a.created_at);
  });
}

export function recommendationStatusLabel(status: RecommendationStatus): string {
  switch (status) {
    case "proposed":
      return "Proposed";
    case "approved":
      return "Approved";
    case "edited":
      return "Approved (edited)";
    case "rejected":
      return "Rejected";
    case "superseded":
      return "Superseded";
  }
}

export function priorityLabel(p: RecommendationPriority): string {
  return p === "critical" ? "Critical" : p === "high" ? "High" : p === "medium" ? "Medium" : "Low";
}

export function impactMetricLabel(m: ImpactMetric): string {
  switch (m) {
    case "cash":
      return "Cash";
    case "profit":
      return "Profit";
    case "revenue":
      return "Revenue";
    case "gross_margin":
      return "Gross margin";
    case "debtor_days":
      return "Debtor days";
    case "creditor_days":
      return "Creditor days";
    case "stock_days":
      return "Stock days";
    case "other":
      return "Other";
  }
}

/** 45000 → "45 000" (SA convention; plain spaces so PDFs and emails render the same). */
export function groupThousands(n: number): string {
  return String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** "R 45 000 cash in 90 days" / "−12 debtor days in 60 days". */
export function expectedImpactLabel(
  r: Pick<
    Recommendation,
    "expected_impact_metric" | "expected_impact_amount" | "expected_impact_horizon_days"
  >,
  currency = "R",
): string | null {
  if (!r.expected_impact_metric || r.expected_impact_amount === null) return null;
  const m = r.expected_impact_metric;
  const amt = r.expected_impact_amount;
  const isDays = m === "debtor_days" || m === "creditor_days" || m === "stock_days";
  const isPct = m === "gross_margin";
  const sign = amt < 0 ? "−" : "";
  const abs = Math.abs(amt);
  const value = isDays
    ? `${sign}${Math.round(abs)} ${impactMetricLabel(m).toLowerCase()}`
    : isPct
      ? `${sign}${abs.toFixed(1)} pts ${impactMetricLabel(m).toLowerCase()}`
      : `${sign}${currency} ${groupThousands(Math.round(abs))} ${impactMetricLabel(m).toLowerCase()}`;
  const horizon = r.expected_impact_horizon_days
    ? ` in ${r.expected_impact_horizon_days} days`
    : "";
  return `${value}${horizon}`;
}

// ── Root-cause copy rules (agreed in the plan) ───────────────────────────────
//
// A statement-depth recommendation is built from period totals. It may name a
// pillar, a ratio, a trend or an amount. It may NOT claim to know which
// invoices, customers, suppliers or transactions caused it — that story needs
// ledger-level evidence (data_depth = 'transaction').

const TRANSACTION_LEVEL_CLAIMS: ReadonlyArray<{ re: RegExp; what: string }> = [
  {
    re: /\b(these|those|the|your|top|five|5|ten|10)\s+(\w+\s+){0,2}invoices?\b/i,
    what: "specific invoices",
  },
  { re: /\binvoices?\s+(#|no\.?|number)\s*\w+/i, what: "an invoice number" },
  {
    re: /\b(customers?|clients?|debtors?)\s+(who|that|which)\s+(owe|owes|haven'?t|hasn'?t|are|is)\b/i,
    what: "named customers",
  },
  {
    re: /\b(largest|biggest|top|slowest)\s+(\w+\s+){0,2}(customers?|debtors?|suppliers?|creditors?)\b/i,
    what: "ranked customers/suppliers",
  },
  {
    re: /\b(this|that|the)\s+(transaction|payment|receipt|supplier invoice)\b/i,
    what: "a specific transaction",
  },
  { re: /\bpaid\s+(late|on)\s+\d{1,2}\s+\w+\b/i, what: "a dated payment" },
];

export type ClaimCheck = { ok: true } | { ok: false; violations: string[] };

/**
 * Returns the transaction-level claims found in a statement-depth
 * recommendation's copy. Use before saving AI/accountant text and before
 * rendering; an owner on PDF-only data must never read "these five invoices".
 */
export function checkRootCauseClaims(
  r: Pick<Recommendation, "data_depth"> &
    Partial<Pick<Recommendation, "title" | "rationale" | "problem">>,
): ClaimCheck {
  if (r.data_depth === "transaction") return { ok: true };
  const text = [r.title, r.problem, r.rationale].filter(Boolean).join("\n");
  const violations = TRANSACTION_LEVEL_CLAIMS.filter((c) => c.re.test(text)).map((c) => c.what);
  return violations.length
    ? { ok: false, violations: Array.from(new Set(violations)) }
    : { ok: true };
}

/** Copy the UI shows next to statement-depth recommendations. */
export const STATEMENT_DEPTH_DISCLOSURE =
  "Based on statement totals. To see which customers or invoices are driving this, add an aged debtors/creditors report or connect your accounting software.";

// ── Outcomes ─────────────────────────────────────────────────────────────────

export type OutcomeVerdict =
  | "unmeasured"
  | "exceeded"
  | "on_target"
  | "partial"
  | "missed"
  | "worsened";

/**
 * Compare actual vs expected on the metric's own direction. Tolerance is a
 * fraction of |expected| (default 10%). Direction-aware: for debtor_days a more
 * negative actual than expected is "exceeded".
 */
export function outcomeVerdict(
  o: Pick<RecommendationOutcome, "metric" | "expected_amount" | "actual_amount">,
  tolerance = 0.1,
): OutcomeVerdict {
  if (o.actual_amount === null || o.expected_amount === null) return "unmeasured";
  // Normalise so that positive = improvement for every metric.
  const dir = LOWER_IS_BETTER.has(o.metric) ? -1 : 1;
  const exp = o.expected_amount * dir;
  const act = o.actual_amount * dir;
  if (exp === 0) return act > 0 ? "exceeded" : act === 0 ? "on_target" : "worsened";
  const tol = Math.abs(exp) * tolerance;
  if (act < 0 && exp > 0) return "worsened";
  if (act > exp + tol) return "exceeded";
  if (act >= exp - tol) return "on_target";
  if (act >= exp * 0.5) return "partial";
  return "missed";
}

export function outcomeVerdictLabel(v: OutcomeVerdict): string {
  switch (v) {
    case "unmeasured":
      return "Not measured yet";
    case "exceeded":
      return "Beat the target";
    case "on_target":
      return "On target";
    case "partial":
      return "Partly delivered";
    case "missed":
      return "Missed";
    case "worsened":
      return "Went the other way";
  }
}

/** Latest measurement per recommendation. */
export function latestOutcomes(
  rows: readonly RecommendationOutcome[],
): Map<string, RecommendationOutcome> {
  const m = new Map<string, RecommendationOutcome>();
  for (const o of rows) {
    const cur = m.get(o.recommendation_id);
    if (!cur || o.measured_at > cur.measured_at) m.set(o.recommendation_id, o);
  }
  return m;
}

/**
 * Cycle-level summary for "what changed since last cycle": how many
 * recommendations were measured and how they landed.
 */
export function summariseOutcomes(
  recs: readonly Pick<Recommendation, "id" | "status">[],
  outcomes: readonly RecommendationOutcome[],
): { actioned: number; measured: number; delivered: number; missed: number } {
  const latest = latestOutcomes(outcomes);
  let actioned = 0;
  let measured = 0;
  let delivered = 0;
  let missed = 0;
  for (const r of recs) {
    if (!isActionable(r)) continue;
    actioned++;
    const o = latest.get(r.id);
    if (!o) continue;
    const v = outcomeVerdict(o);
    if (v === "unmeasured") continue;
    measured++;
    if (v === "exceeded" || v === "on_target") delivered++;
    else if (v === "missed" || v === "worsened") missed++;
  }
  return { actioned, measured, delivered, missed };
}

/** PostgREST error text when the P0.2 columns/tables are not migrated yet. */
export function isMissingRecommendationRelation(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : "";
  return /does not exist|schema cache|recommendation_outcomes|recommendation_id|advisory_create_action_from_recommendation/i.test(
    msg,
  );
}
