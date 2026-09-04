/**
 * Phase 2 derived-metrics contracts.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/analytics-metrics-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ANALYTICS_PHASE2_SQL,
  ANALYTICS_PHASE3_SQL,
  ANALYTICS_SQL_TO_RUN,
  BLOCKED_METRICS,
  BLOCKED_STALLS,
  COMMITMENT_LADDER,
  HYPOTHESES,
  LOOP_INTERPRETATION,
  METRICS,
  PREDICTION_MIN_CHARS,
  SITUATION_MIN_CHARS,
  STALL_RULES,
  assertBehavioralQuestion,
  isBehavioralQuestion,
} from "../src/lib/metrics/definitions";
import { buildDigestText, buildInstrument } from "../src/lib/metrics/digest";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(HYPOTHESES.VALUE_INGESTION_TRUST.status === "blocked", "H3 is blocked");
assert(BLOCKED_METRICS.EXTRACTION_CORRECTION_RATE.blocked, "correction rate is blocked");
assert(BLOCKED_STALLS.high_correction_rate.blocked, "high_correction_rate stall is blocked");
assert(!("EXTRACTION_CORRECTION_RATE" in METRICS), "do not ship a lying H3 metric");

for (const metric of Object.values(METRICS)) {
  assert(metric.hypothesis, `${metric.key} needs a hypothesis`);
  assert(metric.decisionIfBad.length > 20, `${metric.key} needs decisionIfBad`);
  assert(metric.question.includes("?"), `${metric.key} asks a question`);
  assert(!/total (users|reports|tasks|signups)/i.test(metric.label), `${metric.key} looks like vanity`);
}

for (const rule of STALL_RULES) {
  assertBehavioralQuestion(rule.suggestedQuestion);
  assert(rule.stallType !== "high_correction_rate", "blocked stall must not be in the live list");
}

assert(!isBehavioralQuestion("Would you use this more if we added X?"), "rejects would you");
assert(!isBehavioralQuestion("Do you like the reports?"), "rejects do you like");
assert(!isBehavioralQuestion("How satisfied are you?"), "rejects how satisfied");
assert(!isBehavioralQuestion("Is it useful for your clients?"), "rejects is it useful");
assert(isBehavioralQuestion("What were you using instead of MILŌN this month?"), "keeps past-tense");

assert(SITUATION_MIN_CHARS > 20, "situation friction matches SQL check (length > 20)");

const referral = COMMITMENT_LADDER.find((r) => r.rung === "referred_another_practice");
assert(referral && "unmeasurable" in referral && referral.unmeasurable, "referral rung is unmeasurable");

assert(LOOP_INTERPRETATION.length === 4, "four loop readings");
assert(
  LOOP_INTERPRETATION.some((r) => /diagnostics, not workflow/i.test(r.meaning)),
  "dangerous reading is spelled out",
);

const viewsSql = readFileSync(
  resolve("supabase/migrations/20260902200000_analytics_derived_views.sql"),
  "utf8",
);
const stallSql = readFileSync(
  resolve("supabase/migrations/20260902201000_analytics_commitment_stalls.sql"),
  "utf8",
);

assert(viewsSql.includes("v_practice_activation"), "activation view");
assert(viewsSql.includes("report.sent"), "activation uses report.sent");
assert(!viewsSql.includes("report.generated"), "no invented report.generated");
assert(viewsSql.includes("v_accountability_loop"), "loop view");
assert(viewsSql.includes("task.link.engaged"), "loop counts engaged");
assert(!/task\.link\.fetched/.test(viewsSql), "never count GET fetch");
assert(viewsSql.includes("is_founding_practice"), "founding split");
assert(viewsSql.includes("NOT is_internal"), "excludes internal");
assert(!/sum\(.*signups|total_users|count\(\*\) as total_reports/i.test(viewsSql), "no vanity totals");

assert(stallSql.includes("situation_required"), "signals require a situation");
assert(stallSql.includes("high_correction_rate") === false, "SQL must not emit H3 stalls");
assert(
  !/week_start\s+date GENERATED ALWAYS/i.test(stallSql),
  "week_start must not be a generated column (42P17)",
);
assert(stallSql.includes("SQL4_RETRY_42P17"), "retry marker present so the paste can be identified");

for (const rule of STALL_RULES) {
  assert(
    stallSql.includes(rule.suggestedQuestion.replace(/'/g, "''")) ||
      stallSql.includes(rule.suggestedQuestion),
    `SQL must carry the same question as definitions.ts for ${rule.stallType}`,
  );
}

assert(ANALYTICS_PHASE2_SQL.length === 2, "two editor-sized SQL files");
assert(ANALYTICS_PHASE3_SQL.length === 3, "three Phase 3 SQL files");
assert(ANALYTICS_SQL_TO_RUN.length === 5, "five remaining editor files");
assert(PREDICTION_MIN_CHARS > 8, "prediction friction matches SQL check");

const defs = readFileSync(resolve("src/lib/metrics/definitions.ts"), "utf8");
assert(!defs.includes("public/js/track.js"), "no vanilla tracker");

const fns = readFileSync(resolve("src/lib/metrics.functions.ts"), "utf8");
assert(fns.includes("assertPlatformOwner"), "derived metrics are founder-only");
assert(!fns.includes("assertOpsConsoleAccess"), "IT members do not get the founder instrument");
assert(fns.includes("analytics_founder_bundle"), "instrument reads via public RPC");
assert(!fns.includes('.schema("analytics")'), "do not hit PostgREST analytics schema");

const dash = readFileSync(resolve("src/routes/_authenticated/founder.metrics.tsx"), "utf8");
assert(dash.includes("assertPlatformOwner") === false, "guard lives in the server fn, not the page");
assert(dash.includes("getFounderInstrument"), "dashboard loads the instrument");
assert(dash.includes("SQL 7"), "error copy asks for SQL 7, not a re-paste of 3–6");
assert(!/Paste SQL 3–5/.test(dash), "do not tell the founder to re-paste SQL 3–5");
assert(!/total signups|NPS|cumulative/i.test(dash), "dashboard has no vanity copy");
assert(dash.includes("LOOP_INTERPRETATION"), "loop rules are on the page");

const sql5 = readFileSync(
  resolve("supabase/migrations/20260902300000_analytics_experiments_digest.sql"),
  "utf8",
);
assert(sql5.includes("experiment_prediction_required"), "prediction is required");
assert(sql5.includes("analytics_purge_old_events"), "purge exists");
assert(!/cron\.schedule.*purge/i.test(sql5), "purge is not scheduled");
assert(sql5.includes("digest_log"), "digest log table");

const sql7 = readFileSync(
  resolve("supabase/migrations/20260904130000_analytics_founder_bundle.sql"),
  "utf8",
);
assert(sql7.includes("analytics_founder_bundle"), "SQL 7 is the public bundle RPC");
assert(sql7.includes("Invalid schema"), "SQL 7 names the PostgREST error");
assert(!sql7.includes("CREATE SCHEMA"), "SQL 7 does not recreate analytics");

const digestRoute = readFileSync(resolve("src/routes/api/metrics-digest.ts"), "utf8");
assert(digestRoute.includes("wrote: false"), "unauthenticated GET does not send");
assert(digestRoute.includes("hasValidSecret"), "send requires the cron secret");

const emptyDigest = buildDigestText({
  activation: [],
  loop: [],
  adoption: [],
  expansion: [],
  retention: [],
  queue: [],
});
assert(emptyDigest.startsWith("WORST THIS WEEK:"), "digest leads with bad news");
assert(!/total (users|signups|reports)/i.test(emptyDigest), "digest has no vanity totals");

const closedWeek = new Date(Date.now() - 21 * 86_400_000).toISOString();
const inst = buildInstrument({
  activation: [
    {
      cohort_week: closedWeek,
      is_founding_practice: false,
      practices: 4,
      activation_14d_pct: 10,
    },
  ],
  loop: [
    {
      cohort_week: closedWeek,
      tasks_assigned: 8,
      emails_dispatched: 8,
      links_engaged_by_human: 1,
      status_progressed: 0,
      completed: 1,
      completion_14d_pct: 12,
    },
  ],
  adoption: [
    {
      cohort_week: closedWeek,
      entities_with_send: 5,
      assigned_within_7d: 1,
      assignment_adoption_pct: 20,
    },
  ],
  expansion: [],
  retention: [],
  queue: [
    {
      id: 1,
      practice_name: "Harbour",
      stall_type: "send_no_assign",
      severity: "high",
      suggested_question: "After the client saw the report, what did you actually do to get things fixed?",
    },
  ],
});
assert(inst.headline.metricKey === "LOOP_COMPLETION_RATE", "default headline is the loop");
assert(inst.hypotheses.find((h) => h.id === "H3")?.status === "blocked", "H3 stays blocked");
assert(inst.hypotheses.find((h) => h.id === "H2")?.status === "contradicted", "low loop contradicts H2");
assert(inst.worstLine.includes("WORST THIS WEEK"), "worst line is blunt");

const foundingOnly = buildInstrument({
  activation: [
    {
      cohort_week: closedWeek,
      is_founding_practice: true,
      practices: 1,
      activation_14d_pct: 100,
    },
  ],
  loop: [],
  adoption: [],
  expansion: [],
  retention: [],
  queue: [],
});
assert(foundingOnly.headline.value == null, "founding 100% is not the unaffiliated headline");

console.log("analytics-metrics-test: ok");
