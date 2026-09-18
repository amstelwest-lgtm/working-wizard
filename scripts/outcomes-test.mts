/**
 * Outcomes + portfolio (P2) — snapshot-diff measurement, idempotency, story
 * sentences, calibration, pack results section, portfolio exceptions, wiring.
 * Run: pnpm test:outcomes
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  METRIC_READERS,
  calibratedConfidence,
  deliveryByMetric,
  deliveryContextLines,
  fmtDelta,
  isAutoMeasurable,
  measureOutcomes,
  outcomeStories,
  outcomeStory,
  type SnapshotLike,
} from "../src/lib/outcomes";
import {
  EXCEPTION_KINDS,
  exceptionsFor,
  rankPortfolio,
  summarisePortfolio,
  type PortfolioClientFacts,
} from "../src/lib/portfolio";
import { PACK_SECTION_KEYS, buildAdvisoryPack } from "../src/lib/advisory-pack";
import {
  checkRootCauseClaims,
  type Recommendation,
  type RecommendationOutcome,
} from "../src/lib/recommendations";
import { trackRecordLines } from "../supabase/functions/brain-propose/logic.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = "2026-09-18T12:00:00.000Z";

function rec(over: Partial<Recommendation>): Recommendation {
  return {
    id: "r1",
    client_id: "c",
    cycle_id: null,
    title: "Tighten credit terms",
    rationale: null,
    problem: null,
    evidence: [],
    priority: "high",
    confidence: null,
    data_depth: "statement",
    expected_impact_metric: "debtor_days",
    expected_impact_amount: -26,
    expected_impact_horizon_days: 90,
    expected_impact_note: null,
    source: "ai",
    status: "approved",
    assumptions: [],
    linked_action_item_id: null,
    superseded_by: null,
    decided_at: "2026-08-05T10:00:00Z",
    decided_by: null,
    signed_off_by_id: null,
    signed_off_by_name: null,
    signed_off_at: null,
    note: null,
    created_by: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: NOW,
    ...over,
  } as Recommendation;
}
const snap = (
  id: string,
  date: string,
  label: string,
  ratios: Record<string, number>,
  fin: Record<string, string> = {},
): SnapshotLike => ({
  id,
  period_date: date,
  period_label: label,
  ratios,
  financials: fin,
});
const S_JUL = snap(
  "s1",
  "2026-07-31",
  "Jul 2026",
  { "Debtor Days": 71, "Gross Margin": 0.31 },
  { revenue: "480000", netIncome: "12000" },
);
const S_AUG = snap(
  "s2",
  "2026-08-31",
  "Aug 2026",
  { "Debtor Days": 58, "Gross Margin": 0.33 },
  { revenue: "510,000", netIncome: "9000" },
);
const S_SEP = snap(
  "s3",
  "2026-09-30",
  "Sep 2026",
  { "Debtor Days": 49, "Gross Margin": 0.34 },
  { revenue: "530000", netIncome: "15000" },
);

// ── 1. Measurement ───────────────────────────────────────────────────────────

{
  const drafts = measureOutcomes({
    recommendations: [rec({})],
    snapshots: [S_AUG, S_JUL],
    existing: [],
    now: NOW,
  });
  eq(drafts.length, 1, "one draft");
  const d = drafts[0];
  eq(
    d.baseline_snapshot_id,
    "s1",
    "baseline = latest snapshot on/before the decision (Jul, decided 5 Aug)",
  );
  eq(d.measured_snapshot_id, "s2", "measured = newest");
  eq(d.actual_amount, -13, "debtor days 71 → 58 = −13");
  eq(d.expected_amount, -26, "expected carried");
  eq(d.method, "snapshot_diff", "method");
  eq(d.notes, "Debtor days: 71 days (Jul 2026) → 58 days (Aug 2026)", "notes explain the movement");
  eq(d.period_label, "Aug 2026", "period label from measured snapshot");

  // Idempotent: same newest snapshot already measured → nothing.
  const existing: RecommendationOutcome[] = [
    {
      id: "o",
      client_id: "c",
      recommendation_id: "r1",
      cycle_id: null,
      metric: "debtor_days",
      expected_amount: -26,
      actual_amount: -13,
      variance_amount: 13,
      method: "snapshot_diff",
      baseline_snapshot_id: "s1",
      measured_snapshot_id: "s2",
      period_label: "Aug 2026",
      measured_at: NOW,
      notes: null,
      created_by: null,
      created_at: NOW,
      updated_at: NOW,
    },
  ];
  eq(
    measureOutcomes({ recommendations: [rec({})], snapshots: [S_AUG, S_JUL], existing, now: NOW })
      .length,
    0,
    "already measured against s2 → nothing",
  );
  // A newer snapshot re-measures against the SAME baseline (cumulative effect).
  const again = measureOutcomes({
    recommendations: [rec({})],
    snapshots: [S_SEP, S_AUG, S_JUL],
    existing,
    now: NOW,
  });
  eq(again.length, 1, "new snapshot → new measurement");
  eq(again[0].baseline_snapshot_id, "s1", "baseline stays at decision time");
  eq(again[0].measured_snapshot_id, "s3", "measured against Sep");
  eq(again[0].actual_amount, -22, "71 → 49");

  eq(
    measureOutcomes({ recommendations: [rec({})], snapshots: [S_JUL], existing: [], now: NOW })
      .length,
    0,
    "single snapshot → nothing to compare",
  );
  eq(
    measureOutcomes({
      recommendations: [rec({ status: "proposed" })],
      snapshots: [S_AUG, S_JUL],
      existing: [],
      now: NOW,
    }).length,
    0,
    "unapproved not measured",
  );
  eq(
    measureOutcomes({
      recommendations: [rec({ expected_impact_metric: "cash" })],
      snapshots: [S_AUG, S_JUL],
      existing: [],
      now: NOW,
    }).length,
    0,
    "cash is manual-only",
  );
  eq(
    measureOutcomes({
      recommendations: [rec({ expected_impact_metric: null })],
      snapshots: [S_AUG, S_JUL],
      existing: [],
      now: NOW,
    }).length,
    0,
    "no metric → nothing",
  );

  // Decision after the newest snapshot → baseline is newest → nothing newer → skip.
  eq(
    measureOutcomes({
      recommendations: [rec({ decided_at: "2026-09-10T00:00:00Z" })],
      snapshots: [S_AUG, S_JUL],
      existing: [],
      now: NOW,
    }).length,
    0,
    "decided after latest figures → wait",
  );
  // Decision before every snapshot → earliest is the baseline.
  eq(
    measureOutcomes({
      recommendations: [rec({ decided_at: "2026-06-01T00:00:00Z" })],
      snapshots: [S_AUG, S_JUL],
      existing: [],
      now: NOW,
    })[0].baseline_snapshot_id,
    "s1",
    "earliest snapshot as baseline",
  );

  const gm = measureOutcomes({
    recommendations: [
      rec({ id: "r2", expected_impact_metric: "gross_margin", expected_impact_amount: 2 }),
    ],
    snapshots: [S_AUG, S_JUL],
    existing: [],
    now: NOW,
  })[0];
  eq(gm.actual_amount, 2, "gross margin in points: 31.0 → 33.0 = +2.0");
  const rev = measureOutcomes({
    recommendations: [
      rec({ id: "r3", expected_impact_metric: "revenue", expected_impact_amount: 20000 }),
    ],
    snapshots: [S_AUG, S_JUL],
    existing: [],
    now: NOW,
  })[0];
  eq(rev.actual_amount, 30000, "revenue parsed with thousands separators: 510,000 − 480000");
  assert(
    isAutoMeasurable("profit") &&
      !isAutoMeasurable("cash") &&
      !isAutoMeasurable("other") &&
      !isAutoMeasurable(null),
    "auto-measurable set",
  );
  eq(
    METRIC_READERS.stock_days!.read(snap("x", "2026-01-01", null, { "Inventory Days": 40.4 })),
    40.4,
    "stock days reads Inventory Days",
  );
}

// ── 2. Stories ───────────────────────────────────────────────────────────────

{
  const o: RecommendationOutcome = {
    id: "o",
    client_id: "c",
    recommendation_id: "r1",
    cycle_id: null,
    metric: "debtor_days",
    expected_amount: -26,
    actual_amount: -13,
    variance_amount: 13,
    method: "snapshot_diff",
    baseline_snapshot_id: "s1",
    measured_snapshot_id: "s2",
    period_label: "Aug 2026",
    measured_at: NOW,
    notes: "Debtor days: 71 days (Jul 2026) → 58 days (Aug 2026)",
    created_by: null,
    created_at: NOW,
    updated_at: NOW,
  };
  const s = outcomeStory(rec({}), o);
  eq(s.verdict, "partial", "−13 of −26 = half → partial");
  eq(
    s.sentence,
    'You did "Tighten credit terms" in Aug 2026. Debtor days went from 71 days (Jul 2026) to 58 days (Aug 2026) against an expected −26 days. Partly delivered.',
    `story: ${s.sentence}`,
  );

  const manual = outcomeStory(
    rec({ expected_impact_metric: "cash", expected_impact_amount: 45000 }),
    {
      ...o,
      metric: "cash",
      expected_amount: 45000,
      actual_amount: 31000,
      method: "manual",
      notes: null,
    },
  );
  assert(
    manual.sentence.includes("Cash moved +R31 000 against an expected +R45 000"),
    `manual story: ${manual.sentence}`,
  );
  eq(manual.verdict, "partial", "31/45 partial");

  const un = outcomeStory(rec({}), { ...o, actual_amount: null });
  assert(
    un.sentence.includes("has not been measured yet — it will be once the next figures land"),
    "auto-measurable pending copy",
  );
  const unManual = outcomeStory(rec({ expected_impact_metric: "cash" }), {
    ...o,
    metric: "cash",
    actual_amount: null,
  });
  assert(unManual.sentence.includes("record what happened when you know"), "manual pending copy");

  const stories = outcomeStories(
    [rec({}), rec({ id: "r9", title: "Cut overheads", expected_impact_metric: "cash" })],
    [o],
  );
  eq(
    stories.map((x) => x.verdict).join(","),
    "partial,unmeasured",
    "measured first, unmeasured last",
  );
  for (const st of stories) {
    assert(
      checkRootCauseClaims({ data_depth: "statement", title: st.sentence }).ok,
      `story is statement-level: ${st.sentence}`,
    );
  }
  eq(fmtDelta(-13, "days"), "−13 days", "delta days");
  eq(fmtDelta(2.04, "pts"), "+2.0 pts", "delta pts");
  eq(fmtDelta(31000, "money"), "+R31 000", "delta money");
}

// ── 3. Calibration ───────────────────────────────────────────────────────────

{
  const recs = [
    rec({ id: "a" }),
    rec({ id: "b", expected_impact_metric: "gross_margin", expected_impact_amount: 2 }),
    rec({ id: "c" }),
  ];
  const base = {
    id: "",
    client_id: "c",
    cycle_id: null,
    variance_amount: null,
    method: "snapshot_diff" as const,
    baseline_snapshot_id: null,
    measured_snapshot_id: null,
    period_label: null,
    measured_at: NOW,
    notes: null,
    created_by: null,
    created_at: NOW,
    updated_at: NOW,
  };
  const outs: RecommendationOutcome[] = [
    {
      ...base,
      id: "o1",
      recommendation_id: "a",
      metric: "debtor_days",
      expected_amount: -26,
      actual_amount: -13,
    },
    {
      ...base,
      id: "o2",
      recommendation_id: "c",
      metric: "debtor_days",
      expected_amount: -20,
      actual_amount: -22,
    },
    {
      ...base,
      id: "o3",
      recommendation_id: "b",
      metric: "gross_margin",
      expected_amount: 2,
      actual_amount: -1,
    },
  ];
  const d = deliveryByMetric(recs, outs);
  const dd = d.find((x) => x.metric === "debtor_days")!;
  eq(dd.measured, 2, "two debtor-day measurements");
  eq(dd.deliveryRatio, 0.8, "(0.5 + 1.1)/2 = 0.8");
  eq(dd.delivered, 1, "one delivered");
  eq(dd.missed, 0, "partial is not missed");
  const gm = d.find((x) => x.metric === "gross_margin")!;
  eq(gm.deliveryRatio, 0, "went backwards clamps to 0");
  eq(gm.missed, 1, "worsened counts as missed");
  eq(calibratedConfidence("debtor_days", d), 0.72, "0.8 × 0.9");
  eq(calibratedConfidence("gross_margin", d), 0.2, "floored at 0.2");
  eq(calibratedConfidence("cash", d), null, "no history → null");
  const lines = deliveryContextLines(d);
  assert(
    lines.some((l) =>
      l.startsWith("Debtor days: 2 past recommendations measured; delivered 80% of expected"),
    ),
    `context line: ${lines}`,
  );

  // Edge-function copy of the maths agrees on the headline number.
  const edge = trackRecordLines([
    {
      recommendation_title: "Tighten credit terms",
      metric: "debtor_days",
      expected_amount: -26,
      actual_amount: -13,
    },
    {
      recommendation_title: "Chase slow payers",
      metric: "debtor_days",
      expected_amount: -20,
      actual_amount: -22,
    },
    {
      recommendation_title: "Raise prices",
      metric: "gross_margin",
      expected_amount: 2,
      actual_amount: -1,
    },
  ]);
  assert(
    edge.some((l) => l.startsWith("Debtor days: 2 past moves measured, delivered 80% of expected")),
    `edge line: ${edge}`,
  );
  assert(
    edge.some((l) => l.includes('Worked: "Chase slow payers"')),
    "edge names what worked",
  );
  assert(
    edge.some((l) => l.includes('Missed: "Raise prices"')),
    "edge names what missed",
  );
}

// ── 4. Pack: results section ─────────────────────────────────────────────────

{
  eq(PACK_SECTION_KEYS[1], "last_cycle_results", "results come right after the headline");
  const base = {
    clientName: "New Co",
    firmName: null,
    hasFirm: false,
    periodLabel: "Aug 2026",
    priorPeriodLabel: null,
    figuresAsOf: "2026-08-31",
    health: null,
    ratios: null,
    priorRatios: null,
    openingBalance: null,
    closings: null,
    cashRunwayWeeks: null,
    recommendations: [],
    dataRequests: [],
    openActions: 0,
    overdueActions: 0,
    now: NOW,
  };
  const none = buildAdvisoryPack(base).sections.find((s) => s.key === "last_cycle_results")!;
  assert(none.body.startsWith("No recommendations were actioned"), "no outcomes copy");
  const pending = buildAdvisoryPack({
    ...base,
    outcomes: [
      {
        recommendationId: "r",
        title: "x",
        verdict: "unmeasured",
        verdictLabel: "Not measured yet",
        sentence: "pending",
      },
    ],
  }).sections.find((s) => s.key === "last_cycle_results")!;
  assert(pending.body.includes("None can be measured yet"), "pending copy");
  const done = buildAdvisoryPack({
    ...base,
    outcomes: [
      {
        recommendationId: "a",
        title: "a",
        verdict: "on_target",
        verdictLabel: "On target",
        sentence: "A landed.",
      },
      {
        recommendationId: "b",
        title: "b",
        verdict: "missed",
        verdictLabel: "Missed",
        sentence: "B missed.",
      },
      {
        recommendationId: "c",
        title: "c",
        verdict: "partial",
        verdictLabel: "Partly",
        sentence: "C partly.",
      },
      {
        recommendationId: "d",
        title: "d",
        verdict: "unmeasured",
        verdictLabel: "Not measured yet",
        sentence: "D pending.",
      },
    ],
  }).sections.find((s) => s.key === "last_cycle_results")!;
  eq(
    done.body,
    "3 of 4 accepted recommendations measured: 1 delivered, 1 missed, 1 partly. Expected versus actual, from the statements, not from memory.",
    `results body: ${done.body}`,
  );
  eq(done.bullets!.length, 4, "stories as bullets");
}

// ── 5. Portfolio ─────────────────────────────────────────────────────────────

{
  const quiet: PortfolioClientFacts = {
    clientId: "q",
    name: "Quiet Co",
    state: "action_execution",
    stateSince: "2026-09-10T00:00:00Z",
    nextReviewAt: null,
    figuresAsOf: "2026-08-31",
    openDataRequests: 0,
    blockingDataRequests: 0,
    overdueActions: 0,
    blockedActions: 0,
    openActions: 2,
    proposedRecommendations: 0,
    packStatus: "approved",
    packVersion: 1,
    packEditRate: 0.1,
    outcomesMissed: 0,
    outcomesMeasured: 1,
    lastLoginAt: "2026-09-15T00:00:00Z",
  };
  eq(exceptionsFor(quiet, NOW).length, 0, "quiet client has no exceptions");

  const loud: PortfolioClientFacts = {
    ...quiet,
    clientId: "l",
    name: "Loud Co",
    state: "accountant_review",
    stateSince: "2026-08-01T00:00:00Z",
    packStatus: "in_review",
    packVersion: 3,
    blockingDataRequests: 1,
    openDataRequests: 2,
    overdueActions: 2,
    outcomesMissed: 1,
    figuresAsOf: "2026-05-01",
    lastLoginAt: "2026-07-01T00:00:00Z",
  };
  const ex = exceptionsFor(loud, NOW);
  eq(
    ex.map((e) => e.kind).join(","),
    "pack_waiting,blocking_data,outcome_missed,overdue_actions,stuck,stale_figures,owner_inactive",
    `ordered by severity: ${ex.map((e) => e.kind)}`,
  );
  eq(ex[0].label, "Pack v3 waiting for your sign-off", "pack label");
  eq(ex[0].tab, "advisory", "pack resolves on advisory tab");
  assert(
    ex.find((e) => e.kind === "stuck")!.label.includes('days at "With your accountant"'),
    "stuck label names the state",
  );
  for (const e of ex)
    assert((EXCEPTION_KINDS as readonly string[]).includes(e.kind), `kind ${e.kind}`);

  // Resting states are never "stuck"; pre-data states never "stale".
  eq(
    exceptionsFor(
      { ...quiet, state: "outcome_monitoring", stateSince: "2026-01-01T00:00:00Z" },
      NOW,
    ).some((e) => e.kind === "stuck"),
    false,
    "monitoring is not stuck",
  );
  eq(
    exceptionsFor(
      { ...quiet, state: "onboarding", figuresAsOf: null, stateSince: "2026-09-17T00:00:00Z" },
      NOW,
    ).some((e) => e.kind === "stale_figures"),
    false,
    "pre-data not stale",
  );
  eq(
    exceptionsFor(
      { ...quiet, state: "accountant_review", proposedRecommendations: 2, packStatus: null },
      NOW,
    ).some((e) => e.kind === "unreviewed_recommendations"),
    true,
    "drafted recs with no pack",
  );
  eq(
    exceptionsFor({ ...quiet, state: "next_review" }, NOW).some((e) => e.kind === "review_due"),
    true,
    "next_review → review due",
  );
  eq(
    exceptionsFor({ ...quiet, nextReviewAt: "2026-09-22T00:00:00Z" }, NOW).find(
      (e) => e.kind === "review_due",
    )?.label,
    "Review due in 4 days",
    "review due soon",
  );
  eq(
    exceptionsFor({ ...quiet, lastLoginAt: "2026-07-01T00:00:00Z", openActions: 0 }, NOW).some(
      (e) => e.kind === "owner_inactive",
    ),
    false,
    "inactive owner only matters with open actions",
  );

  const rows = rankPortfolio(
    [quiet, loud, { ...quiet, clientId: "m", name: "Mid Co", overdueActions: 1 }],
    NOW,
  );
  eq(rows.map((r) => r.name).join(","), "Loud Co,Mid Co,Quiet Co", "ranked by severity score");
  eq(rows[0].daysInState, 48, "days in state");
  const sum = summarisePortfolio(rows);
  eq(sum.clients, 3, "clients");
  eq(sum.needAttention, 2, "two need attention (sev ≤ 2)");
  eq(sum.packsWaiting, 1, "one pack waiting");
  eq(sum.wentBackwards, 1, "one went backwards");
  eq(
    JSON.stringify(rankPortfolio([quiet, loud], NOW)),
    JSON.stringify(rankPortfolio([quiet, loud], NOW)),
    "deterministic",
  );
}

// ── 6. Wiring ────────────────────────────────────────────────────────────────

{
  const fns = readFileSync(resolve("src/lib/outcomes.functions.ts"), "utf8");
  assert(
    fns.includes("measureOutcomesPure({ ...inputs, existing: inputs.outcomes, now })"),
    "server fn delegates to the pure measurer",
  );
  assert(
    fns.includes("method: d.method") && !fns.includes('method: "manual"'),
    "auto path writes snapshot_diff; manual stays on recordRecommendationOutcome",
  );
  const card = readFileSync(resolve("src/components/next-step-card.tsx"), "utf8");
  assert(
    card.includes("measure({ data: { clientId } }).catch(() => null)"),
    "card measures outcomes when it resolves",
  );
  const recFns = readFileSync(resolve("src/lib/recommendations.functions.ts"), "utf8");
  assert(
    recFns.includes("confidence: data.confidence ?? calibrated"),
    "new recommendations get calibrated confidence when none given",
  );
  const packFns = readFileSync(resolve("src/lib/advisory-pack.functions.ts"), "utf8");
  assert(packFns.includes("outcomes: outcomeStories("), "pack generation includes outcome stories");
  const edge = readFileSync(resolve("supabase/functions/brain-propose/index.ts"), "utf8");
  assert(
    edge.includes('.from("recommendation_outcomes")') &&
      edge.includes("Track record of past recommendations"),
    "brain-propose gets the track record",
  );
  const logic = readFileSync(resolve("supabase/functions/brain-propose/logic.ts"), "utf8");
  assert(
    logic.includes("do not re-propose a move that was measured as missed"),
    "prompt rule against repeating misses",
  );
  const panel = readFileSync(resolve("src/components/outcomes-panel.tsx"), "utf8");
  assert(
    panel.includes("useServerFn(recordRecommendationOutcome)") &&
      panel.includes('method: "manual"'),
    "manual capture uses the existing outcome fn",
  );
  assert(!/navigate\(|useNavigate|window\.location/.test(panel), "panel never navigates");
  const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
  assert(
    app.indexOf("<OutcomesPanel") > app.indexOf("<RecommendationsPanel"),
    "owner board: outcomes under recommendations",
  );
  const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
  assert(
    studio.indexOf("<OutcomesPanel") > studio.indexOf("<RecommendationsPanel"),
    "studio: outcomes under recommendations",
  );
  const dash = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
  assert(
    dash.indexOf("<PortfolioExceptions") < dash.indexOf('id="clients-table"'),
    "portfolio sits above the clients table",
  );
  const pf = readFileSync(resolve("src/lib/portfolio.functions.ts"), "utf8");
  assert(
    !/for \(const c of clients\)[\s\S]{0,400}await sb/.test(pf),
    "portfolio never queries per client in a loop",
  );
  assert(pf.includes('.in("client_id", ids)'), "batched by client ids");
}

console.log("outcomes: all checks passed");
