/**
 * Phase 2 derived-metrics contracts.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/analytics-metrics-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ANALYTICS_PHASE2_SQL,
  BLOCKED_METRICS,
  BLOCKED_STALLS,
  COMMITMENT_LADDER,
  HYPOTHESES,
  LOOP_INTERPRETATION,
  METRICS,
  SITUATION_MIN_CHARS,
  STALL_RULES,
  assertBehavioralQuestion,
  isBehavioralQuestion,
} from "../src/lib/metrics/definitions";

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

for (const rule of STALL_RULES) {
  assert(
    stallSql.includes(rule.suggestedQuestion.replace(/'/g, "''")) ||
      stallSql.includes(rule.suggestedQuestion),
    `SQL must carry the same question as definitions.ts for ${rule.stallType}`,
  );
}

assert(ANALYTICS_PHASE2_SQL.length === 2, "two editor-sized SQL files");

const defs = readFileSync(resolve("src/lib/metrics/definitions.ts"), "utf8");
assert(!defs.includes("public/js/track.js"), "no vanilla tracker");
assert(!defs.includes("/founder/metrics"), "Phase 3 dashboard is not this phase");

const fns = readFileSync(resolve("src/lib/metrics.functions.ts"), "utf8");
assert(fns.includes("assertPlatformOwner"), "derived metrics are founder-only");
assert(!fns.includes("assertOpsConsoleAccess"), "IT members do not get the founder instrument");

console.log("analytics-metrics-test: ok");
