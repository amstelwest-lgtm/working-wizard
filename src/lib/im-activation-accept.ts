/**
 * Accept one activation routine for pilot clients — pure idempotency and enqueue plan.
 */
import type { ImRoutineMap } from "./im-activation-planner.ts";
import {
  activationActionMoveKey,
  activationArtifactKey,
  type ImActivationRoutine,
} from "./im-activation-persist.ts";
import { botOwnerToAgentKey, type ImBooksContext } from "./im-activation-triggers.ts";
import { imRoutineTriggerMet } from "./im-routine-schedule.ts";

export type ImActivationAcceptInput = {
  firmId: string;
  clientId: string;
  routine: ImActivationRoutine;
  map: ImRoutineMap;
  books: ImBooksContext;
  existingActionKeys: ReadonlySet<string>;
  existingArtifactKeys: ReadonlySet<string>;
};

export type ImActivationEnqueuePlan = {
  routine: ImActivationRoutine;
  stepId: string;
  actionMoveKey: string;
  agent: "financial_manager" | "analyst" | "advisor";
  trigger: string;
};

export type ImActivationAcceptPlan = {
  writeArtifact: boolean;
  artifactKey: string;
  actionKeys: string[];
  enqueue: ImActivationEnqueuePlan[];
};

export function planActivationAccept(input: ImActivationAcceptInput): ImActivationAcceptPlan {
  const artifactKey = activationArtifactKey(input.firmId, input.clientId, input.routine);
  const writeArtifact = !input.existingArtifactKeys.has(artifactKey);
  const actionKeys: string[] = [];
  const enqueue: ImActivationEnqueuePlan[] = [];
  for (const step of input.map.steps) {
    const moveKey = activationActionMoveKey(input.firmId, input.clientId, input.routine, step.id);
    if (!input.existingActionKeys.has(moveKey)) actionKeys.push(moveKey);
    const agent = botOwnerToAgentKey(step.botOwner);
    if (!agent) continue;
    if (!imRoutineTriggerMet(step.trigger, { ...input.books, now: new Date() }, true)) continue;
    if (enqueue.some((row) => row.routine === input.routine)) continue;
    enqueue.push({
      routine: input.routine,
      stepId: step.id,
      actionMoveKey: moveKey,
      agent,
      trigger: step.trigger,
    });
  }
  return { writeArtifact, artifactKey, actionKeys, enqueue };
}

/** Decline or no-accept must write nothing and enqueue nothing. */
export function activationAcceptWritesNothing(plan: ImActivationAcceptPlan | null): boolean {
  return !plan || (!plan.writeArtifact && plan.actionKeys.length === 0 && plan.enqueue.length === 0);
}