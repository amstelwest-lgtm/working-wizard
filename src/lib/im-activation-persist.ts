/**
 * Activation persistence shapes — action_items backlog tags and routine_map artifacts.
 * Pure helpers; the server function writes rows.
 */
import type { ImRoutineMap, ImRoutineMapStep } from "./im-activation-planner.ts";
import { CLAUDE_OPUS_55, CLAUDE_SONNET_55 } from "./claude-request.ts";

export const IM_ACTIVATION_SOURCE = "setup_partner_activation";
export const IM_ACTIVATION_DOC_TYPE = "im_routine_map";
export const IM_ACTIVATION_MOVE_PREFIX = "im_activation";

/** Count only a newly inserted agent_run toward activation enqueue totals. */
export type DraftRunEnqueue = { runId: string; created: boolean };

export function countNewlyEnqueuedRun(result: DraftRunEnqueue | null): number {
  return result?.created ? 1 : 0;
}

export type ImActivationRoutine = ImRoutineMap["routine"];

export function activationActionMoveKey(
  firmId: string,
  clientId: string,
  routine: ImActivationRoutine,
  stepId: string,
): string {
  return `${IM_ACTIVATION_MOVE_PREFIX}:${firmId}:${clientId}:${routine}:${stepId}`;
}

export function activationArtifactKey(
  firmId: string,
  clientId: string,
  routine: ImActivationRoutine,
): string {
  return `${IM_ACTIVATION_MOVE_PREFIX}:map:${firmId}:${clientId}:${routine}`;
}

export function activationRunInputs(actionItemId: string): string {
  return `${IM_ACTIVATION_MOVE_PREFIX}:run:${actionItemId}`;
}

export type ImActivationActionDraft = {
  client_id: string;
  plan_id: string;
  seq: number;
  title: string;
  status: "not_started";
  source: "manual";
  source_move_key: string;
  driver_key: string;
  outcome_why: string;
};

export type ImRoutineMapArtifactMeta = {
  doc_type: typeof IM_ACTIVATION_DOC_TYPE;
  source: typeof IM_ACTIVATION_SOURCE;
  firm_id: string;
  routine: ImActivationRoutine;
  idempotency_key: string;
  steps: ImRoutineMapStep[];
  hours_saved_per_run: number | null;
  accepted_at: string;
  design_model: string;
  execution_model: string;
};

export function routineMapArtifactMeta(input: {
  firmId: string;
  clientId: string;
  map: ImRoutineMap;
  hoursSavedPerRun: number | null;
  acceptedAt: string;
}): ImRoutineMapArtifactMeta {
  return {
    doc_type: IM_ACTIVATION_DOC_TYPE,
    source: IM_ACTIVATION_SOURCE,
    firm_id: input.firmId,
    routine: input.map.routine,
    idempotency_key: activationArtifactKey(input.firmId, input.clientId, input.map.routine),
    steps: input.map.steps,
    hours_saved_per_run: input.hoursSavedPerRun,
    accepted_at: input.acceptedAt,
    design_model: CLAUDE_OPUS_55,
    execution_model: CLAUDE_SONNET_55,
  };
}

export function activationActionDrafts(input: {
  firmId: string;
  clientId: string;
  planId: string;
  map: ImRoutineMap;
  seqStart: number;
}): ImActivationActionDraft[] {
  return input.map.steps.map((step, index) => ({
    client_id: input.clientId,
    plan_id: input.planId,
    seq: input.seqStart + index,
    title: step.title,
    status: "not_started" as const,
    source: "manual" as const,
    source_move_key: activationActionMoveKey(input.firmId, input.clientId, input.map.routine, step.id),
    driver_key: IM_ACTIVATION_SOURCE,
    outcome_why: `${IM_ACTIVATION_SOURCE}:waiting:${input.map.routine}:${step.id}`,
  }));
}

/** Partner-entered estimate only. Never invent hours. */
export function hoursSavedDisplay(
  hoursPerRun: number | null | undefined,
  completedRuns: number,
): string | null {
  if (hoursPerRun == null || !Number.isFinite(hoursPerRun) || hoursPerRun <= 0) return null;
  if (completedRuns <= 0) return null;
  const total = Math.round(hoursPerRun * completedRuns * 10) / 10;
  return `${total} hours saved (${hoursPerRun} × ${completedRuns} runs)`;
}