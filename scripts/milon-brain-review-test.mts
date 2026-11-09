/**
 * Brain P1: pattern scan, anonymise, idempotency, ops RLS migration smoke.
 * Run: pnpm test:milon-brain-review
 */
import { readFileSync } from "node:fs";
import {
  anonymiseMilonBrainLessonText,
  groupMilonBrainPatterns,
  isFirmPrivateBrainRowVisible,
  lessonCandidateInsert,
  milonBrainReviewPatternKey,
  MILON_BRAIN_LAYER_MILON_WIDE,
  MILON_BRAIN_LAYER_PRIVATE,
  isBrainReviewRowDecidable,
  MILON_BRAIN_STATUS_ACTIVE,
  MILON_BRAIN_STATUS_PENDING,
  MILON_BRAIN_STATUS_RETIRED,
  nextBrainReviewStatus,
  type BrainReviewPrivateRow,
} from "../src/lib/milon-brain-review.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const rule = "Approved: Chase Chill Pepper for R 45,000 before month end.";

const anon = anonymiseMilonBrainLessonText(rule);
assert(!/\bchill\b/i.test(anon), `names stripped: ${anon}`);
assert(!anon.includes("45,000") && !anon.includes("45000"), `amounts stripped: ${anon}`);

const patternKey = milonBrainReviewPatternKey(rule, "action_point_draft");
assert(patternKey.startsWith("action_point_draft"), patternKey);

const firm = (n: number) =>
  `${String(n).padStart(8, "0")}-0000-4000-8000-00000000000${n}`;

const baseRow = (fid: string): BrainReviewPrivateRow => ({
  id: `${fid}-row`,
  firm_id: fid,
  client_id: null,
  task_type: "action_point_draft",
  rule_text: rule,
  created_at: "2026-11-09T12:00:00Z",
});

const twoFirms = groupMilonBrainPatterns([baseRow(firm(1)), { ...baseRow(firm(2)), id: "b" }]);
assert(twoFirms.length === 0, "two firms do not queue a lesson");

const threeFirms = groupMilonBrainPatterns([
  baseRow(firm(1)),
  { ...baseRow(firm(2)), id: "b" },
  { ...baseRow(firm(3)), id: "c" },
]);
assert(threeFirms.length === 1, "three firms queue one pattern");
assert(threeFirms[0].firmIds.length === 3, "distinct firm count");

const insertRow = lessonCandidateInsert({
  patternKey: threeFirms[0].patternKey,
  taskType: threeFirms[0].taskType,
  sampleRuleText: threeFirms[0].sampleRuleText,
  sourceRuleId: baseRow(firm(1)).id,
});
assert(insertRow.layer === MILON_BRAIN_LAYER_MILON_WIDE, "candidate is milon_wide");
assert(insertRow.status === MILON_BRAIN_STATUS_PENDING, "candidate stays pending");
assert(insertRow.firm_id === null, "milon_wide candidate has no firm_id");
assert(insertRow.pattern_key === threeFirms[0].patternKey, "pattern_key stored");
assert(insertRow.decision === "corrected", "anonymised lesson uses corrected");

assert(
  !isFirmPrivateBrainRowVisible({ firm_id: firm(2), layer: MILON_BRAIN_LAYER_PRIVATE }, firm(1)),
  "firm A cannot see firm B private rows",
);
assert(
  isFirmPrivateBrainRowVisible({ firm_id: firm(1), layer: MILON_BRAIN_LAYER_PRIVATE }, firm(1)),
  "firm A sees its private rows",
);
assert(
  !isFirmPrivateBrainRowVisible({ firm_id: firm(1), layer: MILON_BRAIN_LAYER_MILON_WIDE }, firm(1)),
  "firm members do not treat milon_wide as private visibility",
);

const migration = read("supabase/migrations/20261109210000_milon_brain_rules_p1.sql");
assert(migration.includes("'pending'"), "status pending");
assert(migration.includes("pattern_key"), "pattern_key column");
assert(migration.includes("is_milon_ops"), "ops helper");
assert(migration.includes("milon_brain_rules_pending_pattern_key_idx"), "idempotent unique index");
assert(migration.includes("layer = 'private'"), "private select scoped");
assert(
  migration.includes("milon_brain_rules_firm_insert") &&
    migration.includes("layer = 'private'") &&
    migration.includes("status = 'active'") &&
    migration.includes("pattern_key IS NULL"),
  "INSERT policy pins private active rows without pattern_key",
);

const edge = read("supabase/functions/milon-brain-review/index.ts");
assert(edge.includes("runBrainReviewScan"), "on-demand review scan");
assert(edge.includes("is_milon_ops"), "edge checks ops");
assert(edge.includes("approver_id"), "approver logged on decide");

assert(
  isBrainReviewRowDecidable({
    layer: MILON_BRAIN_LAYER_MILON_WIDE,
    status: MILON_BRAIN_STATUS_PENDING,
    task_type: "action_point_draft",
  }),
  "pending milon_wide is decidable",
);
assert(
  !isBrainReviewRowDecidable({
    layer: MILON_BRAIN_LAYER_MILON_WIDE,
    status: MILON_BRAIN_STATUS_ACTIVE,
    task_type: "action_point_draft",
  }),
  "active milon_wide is not re-decided in P1 queue",
);
assert(nextBrainReviewStatus("approve") === MILON_BRAIN_STATUS_ACTIVE, "approve maps to active");
assert(nextBrainReviewStatus("reject") === MILON_BRAIN_STATUS_RETIRED, "reject maps to retired");

assert(
  milonBrainReviewPatternKey(rule, "action_point_draft") ===
    milonBrainReviewPatternKey(rule, "action_point_draft"),
  "pattern key is stable for idempotent scans",
);

console.log("milon-brain-review: ok");
