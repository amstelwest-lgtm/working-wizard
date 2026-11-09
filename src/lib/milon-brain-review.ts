/**
 * Weekly brain review (P1): pattern scan, anonymise, queue lesson candidates.
 * Pure helpers + typed rows. DB writers live in the edge function and ops server fns.
 */
import { redactIdentifiers } from "./redact-identifiers.ts";
import { clipMilonBrainRuleText, type MilonBrainRuleRow } from "./milon-brain-rules.ts";

export const MILON_BRAIN_TASK_FEATURE_IDEA = "feature_idea";
export const MILON_BRAIN_LAYER_MILON_WIDE = "milon_wide";
export const MILON_BRAIN_LAYER_PRIVATE = "private";
export const MILON_BRAIN_STATUS_PENDING = "pending";
export const MILON_BRAIN_STATUS_ACTIVE = "active";
export const MILON_BRAIN_STATUS_RETIRED = "retired";

export const MILON_BRAIN_REVIEW_MIN_FIRMS = 3;
export const MILON_BRAIN_REVIEW_DEFAULT_DAYS = 30;

const AMOUNT_PATTERN =
  /(?:\b(?:R|ZAR|USD|\$|€|£)\s*)?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?\s*%?|\b\d{4,}\b/g;

export type BrainReviewPrivateRow = {
  id: string;
  firm_id: string;
  client_id: string | null;
  task_type: string;
  rule_text: string;
  created_at: string;
};

export type BrainPatternGroup = {
  patternKey: string;
  taskType: string;
  firmIds: string[];
  sampleRuleText: string;
};

/** Normalised key for dedupe and idempotent pending inserts. */
export function milonBrainReviewPatternKey(ruleText: string, taskType: string): string {
  const base = anonymiseMilonBrainLessonText(ruleText).toLowerCase().replace(/\s+/g, " ").trim();
  return `${taskType}\0${base}`;
}

/** Strip identifiers and raw amounts before a milon_wide lesson is queued. */
export function anonymiseMilonBrainLessonText(ruleText: string): string {
  let text = redactIdentifiers(ruleText);
  text = text.replace(AMOUNT_PATTERN, "[AMOUNT]");
  text = text.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, "[CLIENT]");
  return clipMilonBrainRuleText(text.replace(/\s+/g, " ").trim());
}

export function groupMilonBrainPatterns(
  rows: readonly BrainReviewPrivateRow[],
  minFirms = MILON_BRAIN_REVIEW_MIN_FIRMS,
): BrainPatternGroup[] {
  const byKey = new Map<string, { taskType: string; firms: Set<string>; sample: string }>();
  for (const row of rows) {
    if (row.task_type === MILON_BRAIN_TASK_FEATURE_IDEA) continue;
    const key = milonBrainReviewPatternKey(row.rule_text, row.task_type);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { taskType: row.task_type, firms: new Set(), sample: row.rule_text };
      byKey.set(key, bucket);
    }
    bucket.firms.add(row.firm_id);
  }
  const out: BrainPatternGroup[] = [];
  for (const [patternKey, bucket] of byKey) {
    if (bucket.firms.size < minFirms) continue;
    out.push({
      patternKey,
      taskType: bucket.taskType,
      firmIds: [...bucket.firms].sort(),
      sampleRuleText: bucket.sample,
    });
  }
  return out.sort((a, b) => a.patternKey.localeCompare(b.patternKey));
}

export function lessonCandidateInsert(input: {
  patternKey: string;
  taskType: string;
  sampleRuleText: string;
  sourceRuleId: string;
}): Omit<MilonBrainRuleRow, "firm_id" | "client_id"> & {
  firm_id: null;
  client_id: null;
  pattern_key: string;
} {
  const lesson = anonymiseMilonBrainLessonText(input.sampleRuleText);
  return {
    firm_id: null,
    client_id: null,
    task_type: input.taskType,
    source_event: "brain_weekly_review",
    source_row_id: input.sourceRuleId,
    decision: "corrected",
    rule_text: lesson,
    approver_id: null,
    layer: MILON_BRAIN_LAYER_MILON_WIDE,
    status: MILON_BRAIN_STATUS_PENDING,
    pattern_key: input.patternKey,
  };
}

export type BrainReviewQueueItem = {
  id: string;
  kind: "lesson_candidate" | "feature_idea";
  task_type: string;
  rule_text: string;
  status: string;
  layer: string;
  firm_id: string | null;
  created_at: string;
  pattern_key?: string | null;
};

export function isFirmPrivateBrainRowVisible(
  row: { firm_id: string | null; layer?: string | null },
  viewerFirmId: string,
): boolean {
  if (row.layer !== MILON_BRAIN_LAYER_PRIVATE) return false;
  return row.firm_id === viewerFirmId;
}

export function nextBrainReviewStatus(decision: "approve" | "reject"): string {
  return decision === "approve" ? MILON_BRAIN_STATUS_ACTIVE : MILON_BRAIN_STATUS_RETIRED;
}

export function isBrainReviewRowDecidable(row: {
  layer: string;
  status: string;
  task_type: string;
}): boolean {
  const lesson =
    row.layer === MILON_BRAIN_LAYER_MILON_WIDE && row.status === MILON_BRAIN_STATUS_PENDING;
  const idea =
    row.layer === MILON_BRAIN_LAYER_PRIVATE &&
    row.task_type === MILON_BRAIN_TASK_FEATURE_IDEA &&
    row.status === MILON_BRAIN_STATUS_ACTIVE;
  return lesson || idea;
}
