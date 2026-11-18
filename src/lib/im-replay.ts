/**
 * Replay a confirmed Implementation Manager plan from saved rules and/or
 * interview JSON — no live questionnaire.
 */
import { interviewDraftFromRuleText, type FirmInterviewDraft } from "./firm-interview-draft.ts";
import { buildCapabilityManifest } from "./im-capability-manifest.ts";
import {
  buildPracticeImplementationPlan,
  practicePlanFromConfirmRules,
  type PracticeImplementationPlan,
} from "./setup-partner-plan.ts";
import {
  SETUP_PARTNER_SOURCE_EVENT,
  SETUP_PARTNER_TASK_WORKFLOW,
  setupPartnerCoverage,
  type SetupPartnerCountry,
  type SetupPartnerWorkflowMap,
} from "./setup-partner.ts";

export type ImReplayBrainRule = {
  rule_text?: string | null;
  client_id?: string | null;
  source_event?: string | null;
  status?: string | null;
  task_type?: string | null;
};

export type ImReplayFixtureMeta = {
  label?: string;
  country?: SetupPartnerCountry;
  hours_saved_estimate?: number | null;
  pilot_client_ids?: string[];
};

export type ImReplayInput = {
  confirmRules?: readonly ImReplayBrainRule[];
  interviewJson?: string | FirmInterviewDraft | null;
  meta?: ImReplayFixtureMeta | null;
};

export type ImReplayReady = {
  status: "ready";
  label: string | null;
  country: SetupPartnerCountry;
  plan: PracticeImplementationPlan;
  workflowMap: SetupPartnerWorkflowMap;
  meta: ImReplayFixtureMeta;
};

export type ImReplayNeedsQuestions = {
  status: "needs_questions";
  missingQuestions: string[];
  partialPlan?: PracticeImplementationPlan;
};

export type ImReplayResult = ImReplayReady | ImReplayNeedsQuestions;

const REQUIRED_META_PROMPTS: readonly { id: keyof ImReplayFixtureMeta; prompt: string }[] = [
  { id: "country", prompt: "Which country is the practice in (US or ZA)?" },
];

export function normalizeReplayRules(rules: readonly ImReplayBrainRule[]): ImReplayBrainRule[] {
  return rules.filter(
    (row) =>
      row.status !== "retired" &&
      (row.task_type == null || row.task_type === SETUP_PARTNER_TASK_WORKFLOW) &&
      (row.source_event == null || row.source_event === SETUP_PARTNER_SOURCE_EVENT),
  );
}

export function parseReplayMetadata(input: ImReplayInput): ImReplayFixtureMeta {
  const meta: ImReplayFixtureMeta = { ...(input.meta ?? {}) };
  if (!meta.country && input.interviewJson) {
    const raw =
      typeof input.interviewJson === "string" ? interviewDraftFromRuleText(input.interviewJson) : input.interviewJson;
    const blob = raw?.messages?.map((row) => row.content).join(" ") ?? "";
    if (/\bUnited States\b|\bUS CPA\b|\bQuickBooks only\b/i.test(blob)) meta.country = "US";
    if (/\bSouth Africa\b|\bSARS\b|\bVAT201\b/i.test(blob)) meta.country = "ZA";
  }
  return meta;
}

export function missingReplayQuestions(
  meta: ImReplayFixtureMeta,
  plan: PracticeImplementationPlan,
): string[] {
  const missing: string[] = [];
  for (const row of REQUIRED_META_PROMPTS) {
    if (meta[row.id] == null || meta[row.id] === "") missing.push(row.prompt);
  }
  if (plan.steps.length === 0) {
    missing.push("Confirm at least one practice workflow step before replaying the plan.");
  }
  return missing;
}

function workflowMapFromPlan(
  plan: PracticeImplementationPlan,
  country: SetupPartnerCountry,
): SetupPartnerWorkflowMap {
  return {
    todaysFlow: plan.steps.map((step) => step.step),
    milonCoverage: setupPartnerCoverage(country),
    gaps: plan.steps.filter((step) => step.bucket === "product_gap").map((step) => step.step),
    checklist: [],
  };
}

/** Rebuild a confirmed plan without running the interview questionnaire. */
export function replayImplementationPlan(input: ImReplayInput): ImReplayResult {
  const rules = normalizeReplayRules(input.confirmRules ?? []);
  const fromRules = practicePlanFromConfirmRules(rules);
  const meta = parseReplayMetadata(input);
  const manifest = buildCapabilityManifest(meta.country);
  void manifest;

  let plan = fromRules;
  if (plan.steps.length === 0 && input.interviewJson) {
    const draft =
      typeof input.interviewJson === "string"
        ? interviewDraftFromRuleText(input.interviewJson)
        : input.interviewJson;
    const answers = draft?.messages.filter((row) => row.role === "user").map((row) => row.content) ?? [];
    if (answers.length) {
      const map = buildPracticeImplementationPlan({
        todaysFlow: answers,
        milonCoverage: setupPartnerCoverage(meta.country),
        gaps: [],
        checklist: [],
      });
      plan = map;
    }
  }

  const missing = missingReplayQuestions(meta, plan);
  if (missing.length) {
    return { status: "needs_questions", missingQuestions: missing, partialPlan: plan.steps.length ? plan : undefined };
  }

  const country = meta.country ?? "ZA";
  return {
    status: "ready",
    label: meta.label ?? null,
    country,
    plan,
    workflowMap: workflowMapFromPlan(plan, country),
    meta: { ...meta, country },
  };
}