/**
 * Firm-level implementation plan for Setup Partner.
 * Buckets a confirmed practice workflow. Pure helpers; the edge writes.
 *
 * client_setup → private brain rule (firm_id set, client_id null).
 * product_gap → one milon_wide pending feature_idea per dedupe_key.
 * bespoke → logged row only, never a queue.
 * covered → plan only.
 */
import {
  buildCapabilityManifest,
  matchManifestClassifier,
  type ImCapabilityManifest,
} from "./im-capability-manifest.ts";
import { clipMilonBrainRuleText, type MilonBrainRuleRow } from "./milon-brain-rules.ts";
import {
  MOM_TEST_GAP_IDS,
  MOM_TEST_SETUP_IDS,
} from "../../supabase/functions/setup-partner/firm-interview-prompt.ts";
import {
  SETUP_PARTNER_SOURCE_EVENT,
  SETUP_PARTNER_TASK_FEATURE,
  SETUP_PARTNER_TASK_WORKFLOW,
  isInterviewerNote,
  type SetupPartnerCountry,
  type SetupPartnerWorkflowMap,
} from "./setup-partner.ts";

export const PRACTICE_BESPOKE_TASK = "practice_bespoke";
export const PRACTICE_BESPOKE_SOURCE = "setup_partner_bespoke_log";
export const PRACTICE_PRODUCT_GAP_SOURCE = "setup_partner_product_gap";

export type PracticeGapBucket = "covered" | "client_setup" | "product_gap" | "bespoke";
export type PracticeGapEffort = "S" | "M" | "L";

export type PracticePlanStep = {
  step: string;
  step_type: string;
  capability: string;
  covers: string;
  bucket: PracticeGapBucket;
  fit_note: string;
  effort: PracticeGapEffort;
  dedupe_key: string;
};

export type PracticeImplementationPlan = {
  steps: PracticePlanStep[];
};

const REF_CAP = 4;

const SETTING_RE = /^(who|when|which|where)\b/i;
const TOOLS_RE = /\b(xero|quickbooks|qbo|sage|spreadsheet|tools used|ledger connection)\b/i;
/** Naming the reviewer or sign-off, or a habit the firm still keeps itself. Not bespoke. */
const FIRM_HABIT_RE =
  /\b(reviewer|who reviews|names? the reviewer|sign-?off|sign off|signs off|kept in a spreadsheet|bank rec|bank reconciliation|e-?mails?|whatsapp|dext|receipts?|source documents?|industries|on the book)\b/i;
const FINANCE_RE =
  /\b(invoice|bill|vat|tax|cash|reconcil\w*|journal|ledger|report|budget|forecast|payable|receivable|bank)\b/i;

const FIT_SETUP = "Firm setting for the practice. Saved as a private rule.";
const FIT_GAP = "Fits the universal finance function. Not in Milōn yet.";
const FIT_BESPOKE = "Outside the universal finance function. Logged only.";

/** Client-agnostic slug. No firm, client, or name. */
export function practiceGapSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "step";
}

/** Normalised slug of capability + step type. Same gap merges across firms. */
export function practiceGapDedupeKey(capability: string, stepType: string): string {
  return `${practiceGapSlug(capability)}--${practiceGapSlug(stepType)}`;
}

function stepOf(
  step: string,
  input: {
    stepType: string;
    capability: string;
    covers: string;
    bucket: PracticeGapBucket;
    fitNote: string;
    effort: PracticeGapEffort;
  },
): PracticePlanStep {
  return {
    step,
    step_type: input.stepType,
    capability: input.capability,
    covers: input.covers,
    bucket: input.bucket,
    fit_note: input.fitNote,
    effort: input.effort,
    dedupe_key: practiceGapDedupeKey(input.capability, input.stepType),
  };
}

const COVERED_WORK_RE =
  /\b(month-?end|management packs?|bookkeeping|cash reporting|profit reporting|cash and profit)\b/i;

/** Drop a note word without eating the answer that follows it. */
export function cleanFlowLine(step: string): string {
  let text = step.replace(/\s+/g, " ").trim();
  text = text.replace(/\b(?:Not stated|Still unclear|asked twice)\b\s*[:;,]?\s*\.?\s*/gi, "");
  text = text.replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();
  text = text.replace(/[;,]+\s*$/g, "").replace(/^[—–-]\s*/g, "").trim();
  return text;
}

/** Drop interviewer notes before a step is saved or shown. */
export function accountantFacingStep(step: string): string {
  return cleanFlowLine(step);
}

function planStepFromClassifier(
  text: string,
  row: {
    stepType: string;
    capability: string;
    covers: string;
    bucket: PracticeGapBucket;
    fitNote: string;
    effort: PracticeGapEffort;
  },
): PracticePlanStep {
  return stepOf(text, {
    stepType: row.stepType,
    capability: row.capability,
    covers: row.covers,
    bucket: row.bucket,
    fitNote: row.fitNote,
    effort: row.effort,
  });
}

const MOM_TEST_MARK = /\[\|(product_gap|client_setup)\]/;

function stripMomTestMark(text: string): string {
  return text.replace(/\s*\[\|(?:product_gap|client_setup)\]/g, " ").replace(/\s+/g, " ").trim();
}

/** Deterministic bucket for one practice workflow step. */
export function classifyPracticeStep(
  step: string,
  opts?: { manifest?: ImCapabilityManifest; country?: SetupPartnerCountry | null },
): PracticePlanStep {
  const forced = step.match(MOM_TEST_MARK)?.[1] as "product_gap" | "client_setup" | undefined;
  if (forced) {
    const plain = stripMomTestMark(step);
    const result = classifyPracticeStep(plain, opts);
    if (result.bucket === forced) return { ...result, step: plain || result.step };
    return stepOf(plain || step, {
      stepType: forced === "client_setup" ? "firm_setting" : practiceGapSlug(plain || "gap"),
      capability: forced === "client_setup" ? "practice-setup" : practiceGapSlug(plain || "gap"),
      covers:
        forced === "client_setup"
          ? "Practice setup — who reviews, who signs off, and how the firm keeps its own habits"
          : (plain || "Gap").slice(0, 120),
      bucket: forced,
      fitNote: forced === "product_gap" ? FIT_GAP : FIT_SETUP,
      effort: forced === "client_setup" ? "S" : "M",
    });
  }
  const manifest = opts?.manifest ?? buildCapabilityManifest(opts?.country);
  const text = accountantFacingStep(step.replace(/\s+/g, " ").trim());
  if (!text) {
    return stepOf(step, {
      stepType: "bespoke",
      capability: "bespoke",
      covers: "Not a Milōn capability",
      bucket: "bespoke",
      fitNote: FIT_BESPOKE,
      effort: "L",
    });
  }
  if (manifest.financeDeadlineSignals.test(text)) {
    const deadline = manifest.classifiers.find((row) => row.stepType === "deadlines");
    if (deadline) {
      return planStepFromClassifier(text, deadline);
    }
  }
  if (manifest.bespokeSignals.test(text) && !manifest.financeDeadlineSignals.test(text)) {
    return stepOf(text, {
      stepType: "bespoke",
      capability: "bespoke",
      covers: "Not a Milōn capability",
      bucket: "bespoke",
      fitNote: FIT_BESPOKE,
      effort: "L",
    });
  }
  if (/agree deadline tracking/i.test(text)) {
    return stepOf(text, {
      stepType: "firm_setting",
      capability: "practice-setup",
      covers: "Practice setup — where the firm keeps deadline tracking",
      bucket: "client_setup",
      fitNote: FIT_SETUP,
      effort: "S",
    });
  }
  if (COVERED_WORK_RE.test(text)) {
    const covered = matchManifestClassifier(text, manifest);
    if (covered?.bucket === "covered") {
      return planStepFromClassifier(text, covered);
    }
    return stepOf(text, {
      stepType: "reporting",
      capability: "analyst",
      covers: "Analyst — cash and profit reporting",
      bucket: "covered",
      fitNote: "Already in Milōn: Analyst: cash and profit reporting.",
      effort: "S",
    });
  }
  if (SETTING_RE.test(text) || TOOLS_RE.test(text) || FIRM_HABIT_RE.test(text)) {
    const tools = TOOLS_RE.test(text) || /\bspreadsheet\b/i.test(text);
    return stepOf(text, {
      stepType: tools ? "tools" : "firm_setting",
      capability: tools ? "ledger-connections" : "practice-setup",
      covers: tools
        ? "Ledger connections (Xero, QuickBooks, Sage) or a spreadsheet the firm still uses"
        : "Practice setup — who reviews, who signs off, and how the firm keeps its own habits",
      bucket: "client_setup",
      fitNote: FIT_SETUP,
      effort: "S",
    });
  }
  const gap = manifest.classifiers.find((row) => row.bucket === "product_gap" && row.re.test(text));
  if (gap) {
    return planStepFromClassifier(text, gap);
  }
  const covered = matchManifestClassifier(text, manifest);
  if (covered?.bucket === "covered") {
    return planStepFromClassifier(text, covered);
  }
  const finance = text.toLowerCase().match(FINANCE_RE);
  if (finance?.[1]) {
    const token = practiceGapSlug(finance[1]);
    return stepOf(text, {
      stepType: token,
      capability: token,
      covers: finance[1],
      bucket: "product_gap",
      fitNote: FIT_GAP,
      effort: "M",
    });
  }
  return stepOf(text, {
    stepType: "bespoke",
    capability: "bespoke",
    covers: "Not a Milōn capability",
    bucket: "bespoke",
    fitNote: FIT_BESPOKE,
    effort: "L",
  });
}

/**
 * A Mom Test answer is only client_setup or product_gap.
 * The practice classifier wins when it already chose one of those.
 * Covered work is configuration. Anything else follows the question.
 */
export function classifyMomTestAnswer(input: { questionId: string; answer: string }): PracticePlanStep {
  const answer = accountantFacingStep(input.answer);
  const classified = classifyPracticeStep(answer);
  const bucket: "product_gap" | "client_setup" =
    classified.bucket === "product_gap" || classified.bucket === "client_setup"
      ? classified.bucket
      : classified.bucket === "covered"
        ? "client_setup"
        : MOM_TEST_GAP_IDS.has(input.questionId) && !MOM_TEST_SETUP_IDS.has(input.questionId)
          ? "product_gap"
          : "client_setup";
  if (classified.bucket === bucket) return classified;
  return classifyPracticeStep(`${answer} [|${bucket}]`);
}

/** One flow line the existing plan builder can classify again on confirm. */
export function momTestFlowLine(step: Pick<PracticePlanStep, "step" | "bucket">): string {
  const bucket = step.bucket === "product_gap" ? "product_gap" : "client_setup";
  return `${accountantFacingStep(step.step)} [|${bucket}]`;
}

const BUCKET_LABEL: Record<PracticeGapBucket, string> = {
  covered: "Already covered",
  client_setup: "Client setup",
  product_gap: "Product gap",
  bespoke: "Bespoke",
};

export function practiceBucketLabel(bucket: PracticeGapBucket): string {
  return BUCKET_LABEL[bucket];
}

/**
 * One row per dedupe_key. client_setup and bespoke share a key across different
 * sentences, so those stay distinct by the step text.
 */
export function dedupePracticeSteps(steps: readonly PracticePlanStep[]): PracticePlanStep[] {
  const seen = new Set<string>();
  const out: PracticePlanStep[] = [];
  for (const step of steps) {
    const id =
      step.bucket === "product_gap"
        ? step.dedupe_key
        : `${step.dedupe_key}\n${step.step.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(step);
  }
  return out;
}

/** Generic checklist lines the interview already answered. Not a second step. */
export function redundantSetupLine(step: string, others: string): boolean {
  if (/note one client only/i.test(step)) return true;
  if (
    /name who reviews and who signs off/i.test(step) &&
    /review|sign-?off|signs off/i.test(others)
  ) {
    return true;
  }
  if (/agree deadline tracking/i.test(step) && /deadline|spreadsheet/i.test(others)) return true;
  const bottleneck = step.match(/^practice bottleneck:\s*(.+)$/i)?.[1]?.trim() ?? "";
  if (bottleneck && others.toLowerCase().includes(bottleneck.toLowerCase())) return true;
  return false;
}

export function buildPracticeImplementationPlan(
  map: SetupPartnerWorkflowMap,
): PracticeImplementationPlan {
  const raw = [...map.todaysFlow]
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const steps: PracticePlanStep[] = [];
  for (const step of raw) {
    const others = raw.filter((line) => line !== step).join("\n");
    if (redundantSetupLine(step, others)) continue;
    if (!accountantFacingStep(step)) continue;
    if (isInterviewerNote(step)) continue;
    steps.push(classifyPracticeStep(step));
  }
  return { steps: dedupePracticeSteps(steps) };
}

/**
 * Rebuild saved steps from active firm-level setup_partner_confirm rules.
 * Every confirmed bucket is stored. The step sentence is the text before the
 * fit note, and the bucket is the same classifier that wrote it.
 */
export function practicePlanFromConfirmRules(
  rows: readonly {
    rule_text?: string | null;
    client_id?: string | null;
    source_event?: string | null;
    status?: string | null;
  }[],
): PracticeImplementationPlan {
  const steps: PracticePlanStep[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.client_id) continue;
    if (row.source_event && row.source_event !== SETUP_PARTNER_SOURCE_EVENT) continue;
    if (row.status && row.status !== "active") continue;
    const text = (row.rule_text ?? "").replace(/\s+/g, " ").trim();
    if (!text.startsWith("Practice: ")) continue;
    const parsed = parsePracticeConfirmRule(text.slice("Practice: ".length));
    if (!parsed.step || seen.has(parsed.step.toLowerCase())) continue;
    seen.add(parsed.step.toLowerCase());
    const classified = classifyPracticeStep(parsed.step);
    steps.push(parsed.bucket ? { ...classified, step: parsed.step, bucket: parsed.bucket } : { ...classified, step: parsed.step });
  }
  return { steps: dedupePracticeSteps(steps) };
}

function clipAtSentence(text: string, max: number): string {
  const clean = text.replace(/[;]+\s*$/g, "").trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const end = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("; "));
  if (end < 20) return "";
  return slice.slice(0, end + 1).replace(/[;\s]+$/g, "").trim();
}

const FIT_NOTE_STARTS = [
  "Firm setting for the practice.",
  "Fits the universal finance function.",
  "Outside the universal finance function.",
  "Already in Milōn:",
];

const PRACTICE_BUCKETS = ["covered", "client_setup", "product_gap", "bespoke"] as const;

/** Drop a stored fit note. Leave a detail that sits after an em dash in the step. */
function stripStoredFitNote(text: string): string {
  const mark = text.lastIndexOf(" — ");
  if (mark <= 0) return text.trim();
  const tail = text.slice(mark + 3).trim();
  if (!FIT_NOTE_STARTS.some((start) => tail.startsWith(start))) return text.trim();
  return text.slice(0, mark).trim();
}

export function parsePracticeConfirmRule(body: string): { step: string; bucket: PracticeGapBucket | null } {
  let text = body.trim();
  let bucket: PracticeGapBucket | null = null;
  const marked = text.match(/ \[\|(covered|client_setup|product_gap|bespoke)\]/);
  if (marked && marked.index != null && (PRACTICE_BUCKETS as readonly string[]).includes(marked[1])) {
    bucket = marked[1] as PracticeGapBucket;
    text = `${text.slice(0, marked.index)} ${text.slice(marked.index + marked[0].length)}`.trim();
  }
  return { step: stripStoredFitNote(text), bucket };
}

/** Step text stays whole, including the detail after an em dash. A fit note is dropped rather than cut mid-sentence. */
export function practiceConfirmRuleText(step: string, fit: string, bucket?: PracticeGapBucket): string {
  const cleanStep = cleanFlowLine(step);
  const cleanFit = cleanFlowLine(fit).replace(/[;]+\s*$/g, "").trim();
  if (!cleanStep) return "";
  const marked = bucket ? `${cleanStep} [|${bucket}]` : cleanStep;
  const head = `Practice: ${marked}`;
  if (head.length > 500) {
    const cut = clipAtSentence(head, 500);
    return cut || head.slice(0, head.lastIndexOf(" ", 500)).trim();
  }
  if (!cleanFit) return head;
  const full = `${head} — ${cleanFit}`;
  if (full.length <= 500) return full;
  const room = 500 - head.length - 3;
  const clipped = room >= 24 ? clipAtSentence(cleanFit, room) : "";
  return clipped ? `${head} — ${clipped}` : head;
}

/** Firm-wide private rules. client_id stays null so the rule is not pinned to one example client. */
export function clientSetupBrainRows(input: {
  firmId: string;
  approverId: string;
  steps: readonly PracticePlanStep[];
}): MilonBrainRuleRow[] {
  const rows: MilonBrainRuleRow[] = [];
  for (const step of input.steps) {
    const rule_text = practiceConfirmRuleText(step.step, step.fit_note, step.bucket);
    if (!rule_text) continue;
    rows.push({
      firm_id: input.firmId,
      client_id: null,
      task_type: SETUP_PARTNER_TASK_WORKFLOW,
      source_event: SETUP_PARTNER_SOURCE_EVENT,
      source_row_id: null,
      decision: "approved",
      rule_text,
      approver_id: input.approverId,
      layer: "private",
      status: "active",
    });
  }
  return rows;
}

export type ProductGapSighting = {
  dedupeKey: string;
  capability: string;
  stepType: string;
  effort: PracticeGapEffort;
  fitNote: string;
  firmId: string;
  clientId: string | null;
  seenAt: string;
};

export type ParsedProductGap = {
  effort: PracticeGapEffort;
  count: number;
  seenAt: string;
  capability: string;
  stepType: string;
  firmIds: string[];
  clientIds: string[];
  fitNote: string;
};

function encodeProductGap(input: {
  effort: PracticeGapEffort;
  count: number;
  seenAt: string;
  capability: string;
  stepType: string;
  firmIds: string[];
  clientIds: string[];
  fitNote: string;
}): string {
  const head = [
    "pg",
    "b=product_gap",
    `e=${input.effort}`,
    `n=${input.count}`,
    `seen=${input.seenAt}`,
    `cap=${practiceGapSlug(input.capability)}`,
    `step=${practiceGapSlug(input.stepType)}`,
    `firms=${input.firmIds.slice(0, REF_CAP).join(",")}`,
    `clients=${input.clientIds.slice(0, REF_CAP).join(",")}`,
  ].join("|");
  const room = 500 - head.length - "|fit=".length;
  const fit = input.fitNote
    .replace(/[|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(0, room));
  return `${head}|fit=${fit}`;
}

export function parseProductGapRule(text: string): ParsedProductGap | null {
  if (!text.startsWith("pg|")) return null;
  const fitAt = text.indexOf("|fit=");
  if (fitAt < 0) return null;
  const parts = new Map<string, string>();
  for (const part of text.slice(0, fitAt).split("|")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    parts.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const effort = parts.get("e");
  if (effort !== "S" && effort !== "M" && effort !== "L") return null;
  const count = Number(parts.get("n"));
  if (!Number.isInteger(count) || count < 1) return null;
  const seenAt = parts.get("seen") ?? "";
  if (!seenAt) return null;
  const ids = (raw: string | undefined) =>
    (raw ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  return {
    effort,
    count,
    seenAt,
    capability: parts.get("cap") ?? "",
    stepType: parts.get("step") ?? "",
    firmIds: ids(parts.get("firms")),
    clientIds: ids(parts.get("clients")),
    fitNote: text.slice(fitAt + "|fit=".length),
  };
}

/** One row per dedupe_key. Append a new firm or client ref and bump n. Never a second row. */
export function mergeProductGap(
  existingText: string | null,
  sighting: ProductGapSighting,
): {
  rule_text: string;
  count: number;
  firmIds: string[];
  clientIds: string[];
  pattern_key: string;
} {
  const parsed = existingText ? parseProductGapRule(existingText) : null;
  const firmIds = parsed ? [...parsed.firmIds] : [];
  const clientIds = parsed ? [...parsed.clientIds] : [];
  let count = parsed?.count ?? 0;
  const push = (list: string[], id: string) => {
    if (list.includes(id) || list.length >= REF_CAP) return;
    list.push(id);
  };
  if (!parsed) {
    count = 1;
    push(firmIds, sighting.firmId);
    if (sighting.clientId) push(clientIds, sighting.clientId);
  } else if (sighting.clientId) {
    if (!clientIds.includes(sighting.clientId)) {
      push(clientIds, sighting.clientId);
      push(firmIds, sighting.firmId);
      count += 1;
    }
  } else if (!firmIds.includes(sighting.firmId)) {
    push(firmIds, sighting.firmId);
    count += 1;
  }
  const rule_text = encodeProductGap({
    effort: sighting.effort,
    count,
    seenAt: sighting.seenAt,
    capability: sighting.capability,
    stepType: sighting.stepType,
    firmIds,
    clientIds,
    fitNote: sighting.fitNote,
  });
  return { rule_text, count, firmIds, clientIds, pattern_key: sighting.dedupeKey };
}

export function productGapInsertRow(
  input: ProductGapSighting & { approverId: string | null },
): MilonBrainRuleRow {
  const merged = mergeProductGap(null, input);
  return {
    firm_id: null,
    client_id: null,
    task_type: SETUP_PARTNER_TASK_FEATURE,
    source_event: PRACTICE_PRODUCT_GAP_SOURCE,
    source_row_id: null,
    decision: "corrected",
    rule_text: merged.rule_text,
    approver_id: input.approverId,
    layer: "milon_wide",
    status: "pending",
    pattern_key: input.dedupeKey,
  };
}

/** Stored log. status retired so review queues and prompt injection skip it. */
export function bespokeLogRow(input: {
  firmId: string;
  clientId: string | null;
  approverId: string | null;
  step: PracticePlanStep;
}): MilonBrainRuleRow {
  return {
    firm_id: input.firmId,
    client_id: input.clientId,
    task_type: PRACTICE_BESPOKE_TASK,
    source_event: PRACTICE_BESPOKE_SOURCE,
    source_row_id: null,
    decision: "dismissed",
    rule_text: clipMilonBrainRuleText(`Bespoke (not queued): ${input.step.step}`),
    approver_id: input.approverId,
    layer: "private",
    status: "retired",
  };
}

/** True only for rows the existing brain-review queue selects. */
export function isPracticeGapQueued(row: {
  layer?: string | null;
  status?: string | null;
  task_type?: string | null;
  source_event?: string | null;
}): boolean {
  if (row.task_type === PRACTICE_BESPOKE_TASK || row.source_event === PRACTICE_BESPOKE_SOURCE)
    return false;
  if (row.layer === "milon_wide" && row.status === "pending") return true;
  if (
    row.layer === "private" &&
    row.task_type === SETUP_PARTNER_TASK_FEATURE &&
    row.status === "active"
  )
    return true;
  return false;
}

const DRAFT_HIDDEN = /\b(json|tool|supabase|rpc|function)\b/i;

/** Checklist lines a person still has to approve. No JSON and no tool names. */
export function approvalDraftTitles(map: Pick<SetupPartnerWorkflowMap, "checklist" | "todaysFlow">): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const line of [...(map.checklist ?? []), ...(map.todaysFlow ?? [])]) {
    const text = line.replace(/\s+/g, " ").trim();
    if (!text || text.includes("{") || text.includes("`") || DRAFT_HIDDEN.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(text);
    if (titles.length >= 8) break;
  }
  return titles;
}

const CLIENT_ID_IN_TEXT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function clientUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  return CLIENT_ID_IN_TEXT.test(text) && text.length === 36 ? text : null;
}

/** A draft line that names a client is about that client. */
export function clientNamedByDraft(title: string): string | null {
  const match = title.match(CLIENT_ID_IN_TEXT);
  return match ? match[0].toLowerCase() : null;
}

/**
 * The client an approval draft belongs to. A line that names a client wins.
 * Otherwise the client on the page. No client means the draft stays with the
 * firm and is not written onto a client row.
 */
export function approvalDraftClientId(input: {
  title: string;
  contextClientId?: string | null;
}): string | null {
  return clientNamedByDraft(input.title) ?? clientUuid(input.contextClientId);
}

/**
 * Read-only. First-seen rows use created_at. A merge keeps created_at and writes seen=<iso> on rule_text.
 * productGapsSinceYesterday applies the same 24h window to both.
 */
export const PRODUCT_GAPS_SINCE_YESTERDAY_SQL = `select id, pattern_key, rule_text, task_type, created_at
from public.milon_brain_rules
where layer = 'milon_wide'
  and status = 'pending'
  and task_type = 'feature_idea'
  and (
    created_at >= now() - interval '1 day'
    or substring(rule_text from 'seen=([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z)')::timestamptz >= now() - interval '1 day'
  )
order by created_at desc`;

const DAY_MS = 24 * 60 * 60 * 1000;

export function productGapsSinceYesterday<
  T extends {
    created_at?: string | null;
    rule_text?: string | null;
    layer?: string | null;
    status?: string | null;
    task_type?: string | null;
  },
>(rows: readonly T[], now: Date): T[] {
  const since = now.getTime() - DAY_MS;
  return rows.filter((row) => {
    if (row.layer && row.layer !== "milon_wide") return false;
    if (row.status && row.status !== "pending") return false;
    if (row.task_type && row.task_type !== SETUP_PARTNER_TASK_FEATURE) return false;
    const created = Date.parse(row.created_at ?? "");
    if (Number.isFinite(created) && created >= since) return true;
    const seen = Date.parse(parseProductGapRule(row.rule_text ?? "")?.seenAt ?? "");
    return Number.isFinite(seen) && seen >= since;
  });
}
