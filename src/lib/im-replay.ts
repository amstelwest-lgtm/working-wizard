/**
 * Replay a saved practice interview into an activation plan.
 * Questions are asked only when no saved answers exist.
 */
import { interviewDraftFromRuleText, type FirmInterviewDraft } from "@/lib/firm-interview-draft.ts";
import {
  buildCapabilityManifest,
  type CapabilityManifest,
  type ManifestTool,
} from "@/lib/im-capability-manifest.ts";
import {
  classifyWithManifest,
  planActivation,
  type ActivationPlan,
  type PilotClient,
} from "@/lib/im-activation.ts";
import {
  practicePlanFromConfirmRules,
  type PracticeImplementationPlan,
} from "@/lib/setup-partner-plan.ts";
import { SETUP_PARTNER_TASK_WORKFLOW } from "@/lib/setup-partner.ts";

export type ReplayRule = {
  rule_text: string;
  status?: string | null;
  task_type?: string | null;
  source_event?: string | null;
  client_id?: string | null;
};

const MISSING_QUESTIONS = [
  "How does a typical client month end?",
  "Who reviews the work, and who signs off?",
];

export type ReplayResult = ActivationPlan & {
  questions: string[];
  answersPresent: boolean;
};

export function interviewHasAnswers(interview: FirmInterviewDraft | null): boolean {
  return Boolean(interview?.messages.some((message) => message.role === "user" && message.content.trim()));
}

export function rulesHaveAnswers(rules: readonly ReplayRule[]): boolean {
  return rules.some(
    (rule) =>
      (rule.task_type ?? SETUP_PARTNER_TASK_WORKFLOW) === SETUP_PARTNER_TASK_WORKFLOW &&
      (rule.rule_text ?? "").trim().startsWith("Practice:"),
  );
}

export function loadInterview(raw: string | null | undefined): FirmInterviewDraft | null {
  if (!raw) return null;
  return interviewDraftFromRuleText(raw);
}

export function replayPractice(input: {
  rules: readonly ReplayRule[];
  interview?: FirmInterviewDraft | null;
  clients: readonly PilotClient[];
  manifest?: CapabilityManifest;
  extraTools?: readonly ManifestTool[];
  partnerHoursEstimate?: number | null;
  completedRuns?: number | null;
}): ReplayResult {
  const tools = input.extraTools?.length
    ? [...(input.manifest?.tools ?? buildCapabilityManifest().tools), ...input.extraTools]
    : input.manifest?.tools;
  const manifest = input.manifest ?? buildCapabilityManifest(tools ? { tools } : undefined);
  const answersPresent = rulesHaveAnswers(input.rules) || interviewHasAnswers(input.interview ?? null);
  const questions = answersPresent ? [] : MISSING_QUESTIONS;
  const stored = practicePlanFromConfirmRules(input.rules);
  const plan: PracticeImplementationPlan = {
    steps: stored.steps.map((step) => classifyWithManifest(step.step, manifest)),
  };
  const activation = planActivation({
    plan,
    clients: input.clients,
    manifest,
    partnerHoursEstimate: input.partnerHoursEstimate,
    completedRuns: input.completedRuns,
  });
  return { ...activation, questions, answersPresent };
}

/** Reasons the harness rejects a replay. Empty means the persona passed. */
export function replayFailures(result: ReplayResult): string[] {
  const failures: string[] = [];
  if (result.answersPresent && result.questions.length > 0) {
    failures.push("asked a new interview when saved answers exist");
  }
  if (!result.answersPresent) return failures;
  if (result.plan.steps.length === 0) failures.push("no integrated plan");
  if (result.tasks.length === 0) failures.push("stopped at a recommendation list with no tasks");
  if (result.checklist.length === 0) failures.push("no partner checklist");
  if (!result.firstValue || result.firstValue.sent) failures.push("no unsent first value");
  if (result.routines.length < 2) failures.push("routine maps missing");
  for (const map of result.routines) {
    if (map.filing) failures.push(`${map.id} files a return`);
    for (const step of map.steps) {
      if (!step.botOwner.trim()) failures.push(`${map.id} has a step with no bot owner`);
      if (step.sent) failures.push(`${map.id} sends a step`);
    }
  }
  return failures;
}
