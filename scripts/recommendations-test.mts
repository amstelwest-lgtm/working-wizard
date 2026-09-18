/**
 * Recommendation + outcome model (P0.2) — pure helpers + migration guard.
 * Run: pnpm test:recommendations
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DATA_DEPTHS,
  IMPACT_METRICS,
  OUTCOME_METHODS,
  RECOMMENDATION_PRIORITIES,
  RECOMMENDATION_SOURCES,
  RECOMMENDATION_STATUSES,
  STATEMENT_DEPTH_DISCLOSURE,
  checkRootCauseClaims,
  expectedImpactLabel,
  isMissingRecommendationRelation,
  latestOutcomes,
  outcomeVerdict,
  parseEvidence,
  parseRecommendationRow,
  sortRecommendations,
  summariseOutcomes,
  type Recommendation,
  type RecommendationOutcome,
} from "../src/lib/recommendations";
import { NEXT_STEP_STATUSES, nextStepStatusLabel } from "../src/lib/client-brain";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
const quoted = (block: string) => Array.from(block.matchAll(/'([a-z_]+)'/g), (m) => m[1]);
function sameSet(actual: Iterable<string>, expected: readonly string[], label: string) {
  const a = new Set(actual);
  for (const e of expected) assert(a.has(e), `${label}: missing ${e}`);
  eq(a.size, expected.length, `${label}: extra values`);
}

// ── 1. Parsing a legacy row (pre-migration) fills safe defaults ──────────────

const legacyRow = {
  id: "r1",
  client_id: "c1",
  title: "Chase overdue debtors",
  rationale: "Debtor days are 71 against a 45-day benchmark.",
  assumptions: [],
  status: "proposed",
  edit_diff: null,
  linked_action_item_id: null,
  signed_off_by_id: null,
  signed_off_by_name: null,
  signed_off_by_title: null,
  firm_name: null,
  signed_off_at: null,
  note: null,
  created_by: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};
{
  const r = parseRecommendationRow(legacyRow);
  eq(r.priority, "medium", "default priority");
  eq(r.data_depth, "statement", "default depth is statement (never overclaim)");
  eq(r.source, "ai", "default source");
  eq(r.confidence, null, "no confidence");
  eq(r.evidence.length, 0, "no evidence");
  eq(r.expected_impact_metric, null, "no impact");
  eq(r.cycle_id, null, "no cycle");
}

// ── 2. Parsing a full row + clamping ─────────────────────────────────────────

{
  const r = parseRecommendationRow({
    ...legacyRow,
    status: "approved",
    priority: "critical",
    confidence: 1.4,
    data_depth: "transaction",
    evidence: [
      { kind: "ratio", key: "debtorDays", value: 71, label: "Debtor days" },
      { kind: "transaction", key: "inv-1042", value: "R 48 000", snapshot_id: null },
      { kind: "bogus", key: "" },
      "garbage",
    ],
    expected_impact_metric: "cash",
    expected_impact_amount: "45000",
    expected_impact_horizon_days: 90,
    source: "accountant",
    decided_at: "2026-09-02T00:00:00Z",
  });
  eq(r.confidence, 1, "confidence clamped to 1");
  eq(r.evidence.length, 2, "invalid evidence entries dropped");
  eq(r.evidence[1].kind, "transaction", "transaction evidence kept");
  eq(r.expected_impact_amount, 45000, "numeric string coerced");
  eq(expectedImpactLabel(r), "R 45 000 cash in 90 days", "impact label");
  eq(
    expectedImpactLabel({
      expected_impact_metric: "debtor_days",
      expected_impact_amount: -12,
      expected_impact_horizon_days: 60,
    }),
    "−12 debtor days in 60 days",
    "days label with sign",
  );
  eq(
    expectedImpactLabel({
      expected_impact_metric: "gross_margin",
      expected_impact_amount: 2.5,
      expected_impact_horizon_days: null,
    }),
    "2.5 pts gross margin",
    "margin label",
  );
  eq(
    expectedImpactLabel({
      expected_impact_metric: null,
      expected_impact_amount: 1,
      expected_impact_horizon_days: 1,
    }),
    null,
    "no metric → null",
  );
  eq(parseEvidence(null).length, 0, "null evidence");
}

// ── 3. Root-cause copy rules ─────────────────────────────────────────────────

{
  const ok = checkRootCauseClaims({
    data_depth: "statement",
    title: "Tighten credit terms",
    problem: "Debtor days rose from 52 to 71 over the year; cash pillar is the weakest.",
    rationale: "Bringing debtor days back to 45 frees roughly R 45 000.",
  });
  assert(ok.ok, "pillar/ratio/amount language is fine at statement depth");

  const bad = checkRootCauseClaims({
    data_depth: "statement",
    title: "Chase these five invoices",
    rationale: "Your largest customers are paying late.",
  });
  assert(!bad.ok, "statement-depth copy naming invoices/customers is rejected");
  if (!bad.ok) {
    assert(bad.violations.includes("specific invoices"), "flags invoices");
    assert(bad.violations.includes("ranked customers/suppliers"), "flags ranked customers");
  }

  const txn = checkRootCauseClaims({
    data_depth: "transaction",
    title: "Chase these five invoices",
    rationale: "Invoice #1042 is 61 days overdue.",
  });
  assert(txn.ok, "same copy is allowed once ledger-level evidence exists");

  const subtle = checkRootCauseClaims({
    data_depth: "statement",
    title: "Follow up debtors",
    rationale: "Customers who owe more than 60 days should get a call.",
  });
  assert(!subtle.ok, "'customers who owe' implies named debtors");

  assert(/statement totals/i.test(STATEMENT_DEPTH_DISCLOSURE), "disclosure names the limitation");
  assert(
    /aged debtors|accounting software/i.test(STATEMENT_DEPTH_DISCLOSURE),
    "disclosure asks for the data that unlocks depth",
  );
}

// ── 4. Ordering ──────────────────────────────────────────────────────────────

{
  const mk = (
    id: string,
    status: Recommendation["status"],
    priority: Recommendation["priority"],
    confidence: number | null,
    created_at: string,
  ) => ({
    id,
    status,
    priority,
    confidence,
    created_at,
  });
  const sorted = sortRecommendations([
    mk("old-low", "proposed", "low", 0.9, "2026-01-01"),
    mk("rejected-critical", "rejected", "critical", 1, "2026-09-01"),
    mk("high-a", "proposed", "high", 0.6, "2026-05-01"),
    mk("high-b", "approved", "high", 0.8, "2026-04-01"),
    mk("critical", "proposed", "critical", 0.5, "2026-03-01"),
    mk("superseded", "superseded", "critical", 1, "2026-09-02"),
  ]).map((r) => r.id);
  eq(
    sorted.join(","),
    "critical,high-b,high-a,old-low,superseded,rejected-critical",
    "critical → high (by confidence) → low; closed last (equal priority/confidence → newest first)",
  );
}

// ── 5. Outcome verdicts (direction-aware) ────────────────────────────────────

{
  const v = (
    metric: RecommendationOutcome["metric"],
    expected: number | null,
    actual: number | null,
  ) => outcomeVerdict({ metric, expected_amount: expected, actual_amount: actual });
  eq(v("cash", 45000, null), "unmeasured", "no actual");
  eq(v("cash", 45000, 46000), "on_target", "within 10%");
  eq(v("cash", 45000, 52000), "exceeded", "beat by >10%");
  eq(v("cash", 45000, 30000), "partial", "≥50%");
  eq(v("cash", 45000, 10000), "missed", "<50%");
  eq(v("cash", 45000, -5000), "worsened", "went the wrong way");
  eq(v("debtor_days", -12, -14), "exceeded", "debtor days: more reduction is better");
  eq(v("debtor_days", -12, -6), "partial", "debtor days: half the reduction");
  eq(v("debtor_days", -12, 3), "worsened", "debtor days: increased");
  eq(v("creditor_days", 10, 11), "on_target", "creditor days: higher is the improvement");
  eq(v("profit", 0, 100), "exceeded", "zero expectation, positive actual");
  eq(v("profit", 0, 0), "on_target", "zero/zero");
}

// ── 6. Latest-per-recommendation + cycle summary ─────────────────────────────

{
  const o = (
    id: string,
    rec: string,
    measured_at: string,
    actual: number | null,
  ): RecommendationOutcome => ({
    id,
    client_id: "c1",
    recommendation_id: rec,
    cycle_id: null,
    metric: "cash",
    expected_amount: 1000,
    actual_amount: actual,
    variance_amount: actual === null ? null : actual - 1000,
    method: "manual",
    baseline_snapshot_id: null,
    measured_snapshot_id: null,
    period_label: null,
    measured_at,
    notes: null,
    created_by: null,
    created_at: measured_at,
    updated_at: measured_at,
  });
  const outcomes = [
    o("o1", "r1", "2026-07-01T00:00:00Z", 200),
    o("o2", "r1", "2026-08-01T00:00:00Z", 1050),
    o("o3", "r2", "2026-08-01T00:00:00Z", 100),
    o("o4", "r3", "2026-08-01T00:00:00Z", null),
  ];
  eq(latestOutcomes(outcomes).get("r1")?.id, "o2", "latest measurement wins");
  const summary = summariseOutcomes(
    [
      { id: "r1", status: "approved" },
      { id: "r2", status: "edited" },
      { id: "r3", status: "approved" },
      { id: "r4", status: "approved" },
      { id: "r5", status: "proposed" },
      { id: "r6", status: "rejected" },
    ],
    outcomes,
  );
  eq(summary.actioned, 4, "approved/edited count as actioned");
  eq(summary.measured, 2, "r3 unmeasured, r4 no outcome");
  eq(summary.delivered, 1, "r1 on target");
  eq(summary.missed, 1, "r2 missed");
}

// ── 7. Missing-relation detection ────────────────────────────────────────────

{
  assert(
    isMissingRecommendationRelation({
      message: 'relation "public.recommendation_outcomes" does not exist',
    }),
    "table",
  );
  assert(
    isMissingRecommendationRelation({
      message: "column proposed_next_steps.priority does not exist",
    }),
    "column",
  );
  assert(
    isMissingRecommendationRelation({
      message: "Could not find the function public.advisory_create_action_from_recommendation",
    }),
    "rpc",
  );
  assert(!isMissingRecommendationRelation({ message: "permission denied" }), "other");
}

// ── 8. Migration ↔ TS vocabulary ─────────────────────────────────────────────

{
  const sql = readFileSync(
    resolve("supabase/migrations/20260918130000_recommendations_outcomes.sql"),
    "utf8",
  );
  const check = (name: string) => {
    const m = sql.match(new RegExp(`${name}\\s+CHECK \\(\\s*\\w+ IN \\(([\\s\\S]*?)\\)\\)`));
    assert(Boolean(m), `${name} present`);
    return quoted(m![1]);
  };
  sameSet(check("proposed_next_steps_status_check"), RECOMMENDATION_STATUSES, "status CHECK");
  sameSet(check("proposed_next_steps_priority_check"), RECOMMENDATION_PRIORITIES, "priority CHECK");
  sameSet(check("proposed_next_steps_data_depth_check"), DATA_DEPTHS, "data_depth CHECK");
  sameSet(check("proposed_next_steps_source_check"), RECOMMENDATION_SOURCES, "source CHECK");

  const impact = sql.match(
    /expected_impact_metric IS NULL OR expected_impact_metric IN \(([\s\S]*?)\)\s*\)/,
  );
  assert(Boolean(impact), "impact metric CHECK present");
  sameSet(quoted(impact![1]), IMPACT_METRICS, "impact metric CHECK");

  const outcomeMetric = sql.match(/metric\s+text NOT NULL CHECK \(metric IN \(([\s\S]*?)\)\)/);
  assert(Boolean(outcomeMetric), "outcome metric CHECK present");
  sameSet(quoted(outcomeMetric![1]), IMPACT_METRICS, "outcome metric CHECK matches impact metrics");

  const method = sql.match(
    /method\s+text NOT NULL DEFAULT 'manual' CHECK \(method IN \(([\s\S]*?)\)\)/,
  );
  assert(Boolean(method), "outcome method CHECK present");
  sameSet(quoted(method![1]), OUTCOME_METHODS, "outcome method CHECK");

  // Structural guarantees.
  assert(
    sql.includes(
      "ADD COLUMN IF NOT EXISTS recommendation_id uuid REFERENCES public.proposed_next_steps(id) ON DELETE SET NULL",
    ),
    "action_items.recommendation_id FK, nullable, never cascades task deletion",
  );
  assert(
    sql.includes("CREATE TABLE IF NOT EXISTS public.recommendation_outcomes"),
    "outcomes table",
  );
  assert(
    sql.includes(
      "variance_amount      numeric GENERATED ALWAYS AS (actual_amount - expected_amount) STORED",
    ),
    "variance is derived, never typed",
  );
  assert(
    sql.includes("CREATE OR REPLACE FUNCTION public.advisory_create_action_from_recommendation"),
    "approved → action RPC",
  );
  assert(
    /IF v_rec\.status NOT IN \('approved', 'edited'\) THEN\s+RAISE EXCEPTION/.test(sql),
    "RPC refuses unapproved recommendations",
  );
  assert(sql.includes("has_client_access(v_uid, v_rec.client_id)"), "RPC checks client access");
  assert(
    sql.includes(
      "GRANT EXECUTE ON FUNCTION public.advisory_create_action_from_recommendation(uuid, text, date, uuid, boolean) TO authenticated",
    ),
    "RPC callable by app users",
  );
  assert(!/CREATE POLICY "outcomes delete/.test(sql), "outcomes have no delete policy");
  assert(
    /"outcomes insert by access"[\s\S]*?created_by = auth\.uid\(\)/.test(sql),
    "outcome insert stamps the real author",
  );
  assert(
    sql.includes("'recommendation.superseded'") && sql.includes("'outcome.recorded'"),
    "new advisory events emitted",
  );
  assert(!/DROP TABLE|DROP COLUMN/i.test(sql), "additive only");
  assert(
    sql.includes("UPDATE public.action_items ai\n   SET recommendation_id = p.id"),
    "legacy linked_action_item_id backfilled into the FK",
  );
}

// ── 9. Wiring ────────────────────────────────────────────────────────────────

{
  sameSet(NEXT_STEP_STATUSES, RECOMMENDATION_STATUSES, "client-brain statuses include superseded");
  eq(nextStepStatusLabel("superseded"), "Superseded", "label for superseded");

  const fns = readFileSync(resolve("src/lib/recommendations.functions.ts"), "utf8");
  for (const name of [
    "listRecommendations",
    "createRecommendation",
    "decideRecommendation",
    "supersedeRecommendation",
    "createActionFromRecommendation",
    "recordRecommendationOutcome",
    "listRecommendationOutcomes",
  ]) {
    assert(fns.includes(`export const ${name}`), `${name} exported`);
  }
  assert(fns.includes("checkRootCauseClaims("), "create path enforces the root-cause copy rules");
  assert(
    fns.includes('rpc("advisory_create_action_from_recommendation"'),
    "action path uses the RPC",
  );
  assert(fns.includes("requireSupabaseAuth"), "auth middleware");

  const types = readFileSync(resolve("src/integrations/supabase/types.ts"), "utf8");
  for (const t of [
    "recommendation_outcomes: {",
    "advisory_create_action_from_recommendation: {",
    "recommendation_id: string | null",
    "expected_impact_metric: string | null",
  ]) {
    assert(types.includes(t), `types.ts has ${t}`);
  }
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert(Boolean(pkg.scripts["test:recommendations"]), "test:recommendations script registered");
}

console.log("recommendations: all checks passed");
