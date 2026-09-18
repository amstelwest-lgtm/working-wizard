/**
 * Outcome measurement — pure module (P2.1 / P2.2).
 *
 * Closes the loop: a recommendation said "expected: +R45 000 cash over 90
 * days"; this module works out what actually happened, from the snapshots
 * MILŌN already has, with no LLM and no typing where a statement can answer.
 *
 * `measureOutcomes` compares the metric a recommendation targeted between
 * the snapshot that was current when it was decided (baseline) and the
 * newest snapshot since. Metrics the statements cannot read (cash, "other")
 * fall to manual capture. `outcomeStory` turns a measurement into the one
 * sentence the next pack leads with. `deliveryByMetric` feeds calibration
 * back into the next round of recommendations.
 */
import {
  IMPACT_METRICS,
  LOWER_IS_BETTER,
  impactMetricLabel,
  isActionable,
  latestOutcomes,
  outcomeVerdict,
  outcomeVerdictLabel,
  type ImpactMetric,
  type OutcomeVerdict,
  type Recommendation,
  type RecommendationOutcome,
} from "@/lib/recommendations";

export type SnapshotLike = {
  id: string;
  period_label: string | null;
  period_date: string;
  ratios: Record<string, number> | null;
  financials: Record<string, string | number | null> | null;
};

/** How each metric is read from a snapshot. `null` = not readable → manual. */
export type MetricReader = {
  unit: "days" | "pts" | "money";
  read: (s: SnapshotLike) => number | null;
};

function ratio(s: SnapshotLike, key: string): number | null {
  const v = s.ratios?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function fin(s: SnapshotLike, key: string): number | null {
  const raw = s.financials?.[key];
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export const METRIC_READERS: Partial<Record<ImpactMetric, MetricReader>> = {
  debtor_days: { unit: "days", read: (s) => ratio(s, "Debtor Days") },
  creditor_days: { unit: "days", read: (s) => ratio(s, "Creditor Days") },
  stock_days: { unit: "days", read: (s) => ratio(s, "Inventory Days") },
  gross_margin: {
    unit: "pts",
    read: (s) => {
      const v = ratio(s, "Gross Margin");
      return v === null ? null : v * 100;
    },
  },
  revenue: { unit: "money", read: (s) => fin(s, "revenue") },
  profit: { unit: "money", read: (s) => fin(s, "netIncome") },
  // cash / other: statements do not carry a reliable figure → manual capture.
};

export function isAutoMeasurable(metric: ImpactMetric | null | undefined): boolean {
  return Boolean(metric && METRIC_READERS[metric]);
}

export type OutcomeDraft = {
  recommendation_id: string;
  metric: ImpactMetric;
  expected_amount: number | null;
  actual_amount: number;
  method: "snapshot_diff";
  baseline_snapshot_id: string;
  measured_snapshot_id: string;
  period_label: string | null;
  measured_at: string;
  notes: string;
  /** For the story; not stored. */
  baseline_value: number;
  measured_value: number;
};

/** The recommendation's "decided" moment; falls back to creation. */
export function recommendationBaselineAt(
  r: Pick<Recommendation, "decided_at" | "created_at">,
): string {
  return r.decided_at ?? r.created_at;
}

/**
 * For every approved/edited recommendation whose metric the statements can
 * read: baseline = latest snapshot dated on/before the decision, measured =
 * newest snapshot after it. One measurement per (recommendation, measured
 * snapshot) — re-running with the same snapshots adds nothing.
 */
export function measureOutcomes(input: {
  recommendations: readonly Recommendation[];
  snapshots: readonly SnapshotLike[];
  existing: readonly RecommendationOutcome[];
  now: string;
}): OutcomeDraft[] {
  const snaps = [...input.snapshots].sort((a, b) => a.period_date.localeCompare(b.period_date));
  if (snaps.length < 2) return [];
  const newest = snaps[snaps.length - 1];
  const measuredAlready = new Set(
    input.existing
      .filter((o) => o.measured_snapshot_id)
      .map((o) => `${o.recommendation_id}|${o.measured_snapshot_id}`),
  );
  const out: OutcomeDraft[] = [];

  for (const r of input.recommendations) {
    if (!isActionable(r)) continue;
    const metric = r.expected_impact_metric;
    if (!metric) continue;
    const reader = METRIC_READERS[metric];
    if (!reader) continue;
    if (measuredAlready.has(`${r.id}|${newest.id}`)) continue;

    const decidedDay = recommendationBaselineAt(r).slice(0, 10);
    // Latest snapshot dated on/before the decision; if none, the earliest we have.
    const baseline = [...snaps].reverse().find((s) => s.period_date <= decidedDay) ?? snaps[0];
    if (baseline.id === newest.id) continue; // nothing newer to compare against

    const b = reader.read(baseline);
    const m = reader.read(newest);
    if (b === null || m === null) continue;
    const actual = round(m - b, reader.unit);

    out.push({
      recommendation_id: r.id,
      metric,
      expected_amount: r.expected_impact_amount,
      actual_amount: actual,
      method: "snapshot_diff",
      baseline_snapshot_id: baseline.id,
      measured_snapshot_id: newest.id,
      period_label: newest.period_label,
      measured_at: input.now,
      notes: `${impactMetricLabel(metric)}: ${fmtValue(b, reader.unit)} (${baseline.period_label ?? baseline.period_date}) → ${fmtValue(
        m,
        reader.unit,
      )} (${newest.period_label ?? newest.period_date})`,
      baseline_value: b,
      measured_value: m,
    });
  }
  return out;
}

function round(v: number, unit: MetricReader["unit"]): number {
  return unit === "money" ? Math.round(v) : Math.round(v * 10) / 10;
}

function groupThousands(n: number): string {
  return Math.abs(Math.round(n))
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function fmtValue(v: number, unit: MetricReader["unit"], currency = "R"): string {
  if (unit === "days") return `${Math.round(v)} days`;
  if (unit === "pts") return `${v.toFixed(1)}%`;
  return `${v < 0 ? "−" : ""}${currency}${groupThousands(v)}`;
}

export function fmtDelta(v: number, unit: MetricReader["unit"], currency = "R"): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  if (unit === "days") return `${sign}${Math.abs(Math.round(v))} days`;
  if (unit === "pts") return `${sign}${Math.abs(v).toFixed(1)} pts`;
  return `${sign}${currency}${groupThousands(v)}`;
}

// ── Story (P2.2: the sentence the next pack leads with) ──────────────────────

export type OutcomeStory = {
  recommendationId: string;
  title: string;
  verdict: OutcomeVerdict;
  verdictLabel: string;
  sentence: string;
};

export function outcomeStory(
  r: Pick<Recommendation, "id" | "title" | "expected_impact_metric" | "decided_at" | "created_at">,
  o: Pick<
    RecommendationOutcome,
    "metric" | "expected_amount" | "actual_amount" | "method" | "notes" | "period_label"
  >,
  currency = "R",
): OutcomeStory {
  const verdict = outcomeVerdict(o);
  const unit: MetricReader["unit"] =
    METRIC_READERS[o.metric]?.unit ?? (o.metric === "cash" ? "money" : "pts");
  const label = impactMetricLabel(o.metric).toLowerCase();
  const when = monthLabel(recommendationBaselineAt(r));
  let sentence: string;
  if (o.actual_amount === null) {
    sentence = `"${r.title}" (${when}) has not been measured yet${
      isAutoMeasurable(o.metric)
        ? " — it will be once the next figures land."
        : " — record what happened when you know."
    }`;
  } else {
    const movement =
      o.method === "snapshot_diff" && o.notes
        ? `went from ${o.notes.replace(/^[^:]+:\s*/, "").replace(" → ", " to ")}`
        : `moved ${fmtDelta(o.actual_amount, unit, currency)}`;
    const vs =
      o.expected_amount !== null
        ? ` against an expected ${fmtDelta(o.expected_amount, unit, currency)}`
        : "";
    sentence = `You did "${r.title}" in ${when}. ${capitalise(label)} ${movement}${vs}. ${outcomeVerdictLabel(
      verdict,
    )}.`;
  }
  return {
    recommendationId: r.id,
    title: r.title,
    verdict,
    verdictLabel: outcomeVerdictLabel(verdict),
    sentence,
  };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "the last cycle";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Stories for every actionable recommendation, measured or not, latest measurement wins. */
export function outcomeStories(
  recs: readonly Recommendation[],
  outcomes: readonly RecommendationOutcome[],
  currency = "R",
): OutcomeStory[] {
  const latest = latestOutcomes(outcomes);
  return recs
    .filter((r) => isActionable(r))
    .map((r) => {
      const o = latest.get(r.id);
      if (o) return outcomeStory(r, o, currency);
      return outcomeStory(
        r,
        {
          metric: r.expected_impact_metric ?? "other",
          expected_amount: r.expected_impact_amount,
          actual_amount: null,
          method: "manual",
          notes: null,
          period_label: null,
        },
        currency,
      );
    })
    .sort((a, b) => rankVerdict(a.verdict) - rankVerdict(b.verdict));
}

function rankVerdict(v: OutcomeVerdict): number {
  return ["worsened", "missed", "partial", "on_target", "exceeded", "unmeasured"].indexOf(v);
}

// ── Calibration (P2.2: what history says about this metric) ─────────────────

export type MetricDelivery = {
  metric: ImpactMetric;
  measured: number;
  /** Mean of actual/expected (direction-normalised), clamped 0..1.5. */
  deliveryRatio: number;
  delivered: number;
  missed: number;
};

export function deliveryByMetric(
  recs: readonly Recommendation[],
  outcomes: readonly RecommendationOutcome[],
): MetricDelivery[] {
  const latest = latestOutcomes(outcomes);
  const byMetric = new Map<ImpactMetric, number[]>();
  const counts = new Map<ImpactMetric, { delivered: number; missed: number }>();
  for (const r of recs) {
    const o = latest.get(r.id);
    if (!o || o.actual_amount === null || o.expected_amount === null || o.expected_amount === 0)
      continue;
    const dir = LOWER_IS_BETTER.has(o.metric) ? -1 : 1;
    const ratio = Math.max(0, Math.min(1.5, (o.actual_amount * dir) / (o.expected_amount * dir)));
    byMetric.set(o.metric, [...(byMetric.get(o.metric) ?? []), ratio]);
    const v = outcomeVerdict(o);
    const c = counts.get(o.metric) ?? { delivered: 0, missed: 0 };
    if (v === "exceeded" || v === "on_target") c.delivered++;
    if (v === "missed" || v === "worsened") c.missed++;
    counts.set(o.metric, c);
  }
  return IMPACT_METRICS.filter((m) => byMetric.has(m)).map((m) => {
    const rs = byMetric.get(m)!;
    return {
      metric: m,
      measured: rs.length,
      deliveryRatio: Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) / 100,
      delivered: counts.get(m)!.delivered,
      missed: counts.get(m)!.missed,
    };
  });
}

/** Lines the recommendation prompt gets so history informs the next round. */
export function deliveryContextLines(d: readonly MetricDelivery[]): string[] {
  return d.map(
    (x) =>
      `${impactMetricLabel(x.metric)}: ${x.measured} past recommendation${x.measured === 1 ? "" : "s"} measured; delivered ${Math.round(
        x.deliveryRatio * 100,
      )}% of expected on average (${x.delivered} on/above target, ${x.missed} missed).`,
  );
}

/**
 * Confidence for a new recommendation on `metric`, from history. Unknown
 * metric → null (leave the field alone). Never below 0.2: one bad month is
 * not a law.
 */
export function calibratedConfidence(
  metric: ImpactMetric,
  d: readonly MetricDelivery[],
): number | null {
  const x = d.find((m) => m.metric === metric);
  if (!x || x.measured === 0) return null;
  return Math.round(Math.max(0.2, Math.min(0.95, x.deliveryRatio * 0.9)) * 100) / 100;
}
