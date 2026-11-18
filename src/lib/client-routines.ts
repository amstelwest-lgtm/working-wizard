/**
 * Routines tab — parse routine_map artifacts and derived run timing. No prompts or rule ids in owner copy.
 */
import type { ImRoutineMapStep } from "./im-activation-planner.ts";
import {
  IM_ACTIVATION_DOC_TYPE,
  IM_ACTIVATION_MOVE_PREFIX,
  IM_ACTIVATION_SOURCE,
  hoursSavedDisplay,
  type ImRoutineMapArtifactMeta,
} from "./im-activation-persist.ts";

export type RoutineRunRow = {
  id: string;
  agent: string;
  status: string;
  action_item_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  queued_at: string | null;
};

export type RoutineActionRow = {
  id: string;
  title: string;
  status: string;
  source_move_key: string | null;
  sent_at: string | null;
};

export type AccountantRoutineStep = {
  id: string;
  title: string;
  ownerLabel: string;
  status: "waiting" | "running" | "done" | "needs_approval";
  approvalLabel: string;
  lastRunAt: string | null;
  nextRunLabel: string | null;
};

export function parseRoutineMapMeta(meta: unknown): ImRoutineMapArtifactMeta | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const row = meta as Record<string, unknown>;
  if (row.doc_type !== IM_ACTIVATION_DOC_TYPE) return null;
  if (row.source !== IM_ACTIVATION_SOURCE) return null;
  const routine = row.routine;
  if (routine !== "document_chase" && routine !== "monthly_pack") return null;
  const steps = Array.isArray(row.steps) ? row.steps : [];
  const parsedSteps: ImRoutineMapStep[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const s = step as Record<string, unknown>;
    const id = typeof s.id === "string" ? s.id : "";
    const title = typeof s.title === "string" ? s.title : "";
    const botOwner = typeof s.botOwner === "string" ? s.botOwner : "";
    if (!id || !title) continue;
    parsedSteps.push({
      id,
      title,
      botOwner,
      trigger: typeof s.trigger === "string" ? s.trigger : "",
      cadence: typeof s.cadence === "string" ? s.cadence : "",
      approvalGate: {
        kind: "human_send",
        description:
          typeof (s.approvalGate as { description?: string } | undefined)?.description === "string"
            ? ((s.approvalGate as { description: string }).description as string)
            : "Draft only until you approve.",
        sends: false,
      },
      sends: false,
    });
  }
  const hours = row.hours_saved_per_run;
  return {
    doc_type: IM_ACTIVATION_DOC_TYPE,
    source: IM_ACTIVATION_SOURCE,
    firm_id: typeof row.firm_id === "string" ? row.firm_id : "",
    routine,
    idempotency_key: typeof row.idempotency_key === "string" ? row.idempotency_key : "",
    steps: parsedSteps,
    hours_saved_per_run: typeof hours === "number" && Number.isFinite(hours) ? hours : null,
    accepted_at: typeof row.accepted_at === "string" ? row.accepted_at : "",
    design_model: typeof row.design_model === "string" ? row.design_model : "",
    execution_model: typeof row.execution_model === "string" ? row.execution_model : "",
  };
}

function moveKeyForStep(firmId: string, clientId: string, routine: string, stepId: string): string {
  return `${IM_ACTIVATION_MOVE_PREFIX}:${firmId}:${clientId}:${routine}:${stepId}`;
}

function stepStatus(
  action: RoutineActionRow | undefined,
  runs: RoutineRunRow[],
): AccountantRoutineStep["status"] {
  if (action?.sent_at) return "needs_approval";
  const open = runs.find((run) => run.status === "queued" || run.status === "running");
  if (open) return "running";
  const done = runs.find((run) =>
    ["succeeded", "partial", "skipped"].includes(run.status),
  );
  if (done) return "done";
  if (action?.status === "done") return "done";
  return "waiting";
}

function lastRunAt(runs: RoutineRunRow[]): string | null {
  const finished = runs
    .filter((run) => run.finished_at)
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));
  return finished[0]?.finished_at ?? null;
}

function nextRunLabel(runs: RoutineRunRow[], status: AccountantRoutineStep["status"]): string | null {
  if (status === "running") return "Running now";
  if (status === "done") return "On cadence";
  const queued = runs.find((run) => run.status === "queued");
  if (queued?.queued_at) return `Queued ${queued.queued_at.slice(0, 10)}`;
  return status === "waiting" ? "Waiting on books or trigger" : null;
}

export function accountantRoutineSteps(input: {
  firmId: string;
  clientId: string;
  meta: ImRoutineMapArtifactMeta;
  actions: readonly RoutineActionRow[];
  runs: readonly RoutineRunRow[];
}): AccountantRoutineStep[] {
  return input.meta.steps.map((step) => {
    const key = moveKeyForStep(input.firmId, input.clientId, input.meta.routine, step.id);
    const action = input.actions.find((row) => row.source_move_key === key);
    const relatedRuns = input.runs.filter(
      (run) => run.action_item_id && run.action_item_id === action?.id,
    );
    const status = stepStatus(action, relatedRuns);
    return {
      id: step.id,
      title: step.title,
      ownerLabel: step.botOwner,
      status,
      approvalLabel: step.approvalGate.description.replace(/\bMilōn\b/g, "Milōn"),
      lastRunAt: lastRunAt(relatedRuns),
      nextRunLabel: nextRunLabel(relatedRuns, status),
    };
  });
}

export type OwnerMonthLine = {
  id: string;
  text: string;
  waitingOnYou: boolean;
};

/** Plain owner copy — no bot names, models, triggers, or rule ids. */
export function ownerRoutineMonthLines(
  actions: readonly RoutineActionRow[],
  runs: readonly RoutineRunRow[],
): OwnerMonthLine[] {
  const activationItems = actions.filter(
    (row) =>
      row.driver_key === IM_ACTIVATION_SOURCE ||
      (row.source_move_key ?? "").startsWith(`${IM_ACTIVATION_MOVE_PREFIX}:`),
  );
  const lines: OwnerMonthLine[] = [];
  for (const item of activationItems) {
    const itemRuns = runs.filter((run) => run.action_item_id === item.id);
    const working = itemRuns.some((run) => run.status === "queued" || run.status === "running");
    const done = item.status === "done" || itemRuns.some((run) => run.status === "succeeded" || run.status === "partial");
    const waitingOnYou = Boolean(item.sent_at) || (done && !item.sent_at && item.status !== "done");
    let text: string;
    if (working) text = `Milōn is preparing: ${item.title}`;
    else if (waitingOnYou) text = `Waiting on you: ${item.title}`;
    else if (done) text = `Draft ready for review: ${item.title}`;
    else text = `Planned this month: ${item.title}`;
    lines.push({ id: item.id, text, waitingOnYou });
  }
  return lines;
}

export function routineHoursSavedLine(
  meta: ImRoutineMapArtifactMeta | null,
  completedRuns: number,
): string | null {
  if (!meta) return null;
  return hoursSavedDisplay(meta.hours_saved_per_run, completedRuns);
}