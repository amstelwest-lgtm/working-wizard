/**
 * Routines tab — parse routine_map artifacts and derived run timing. No prompts or rule ids in owner copy.
 */
import type { ImRoutineKind, ImRoutineMapStep } from "./im-activation-planner.ts";
import {
  imRoutinePeriodKey,
  routineStepLastRunAt,
  routineStepNextRunLabel,
  type ImRoutineEventContext,
  type RoutineSchedule,
} from "./im-routine-schedule.ts";
import {
  IM_ACTIVATION_DOC_TYPE,
  IM_ACTIVATION_META_KIND,
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
  driver_key: string | null;
};

/** The five activation templates, Draft client update email, and Build a report (pack, cash, waterfall, budget). */
export const ROUTINE_ACTION_KINDS = [
  "document_chase",
  "monthly_pack",
  "cash_debtor_early_warning",
  "budget_actual_drift",
  "tax_deadline_watch",
  "client_update_draft",
  "report_pack",
  "report_cash",
  "report_waterfall",
  "report_budget",
] as const;

export type RoutineActionKind = (typeof ROUTINE_ACTION_KINDS)[number];

const REPORT_ACTIONS = ["report_pack", "report_cash", "report_waterfall", "report_budget"] as const;

export type AccountantRoutineStep = {
  id: string;
  title: string;
  ownerLabel: string;
  status: "waiting" | "running" | "done" | "needs_approval";
  approvalLabel: string;
  lastRunAt: string | null;
  nextRunLabel: string | null;
};

export function parseRoutineAction(value: unknown): RoutineActionKind | null {
  if (typeof value !== "string") return null;
  return (ROUTINE_ACTION_KINDS as readonly string[]).includes(value) ? (value as RoutineActionKind) : null;
}

export function parseRoutineSchedule(value: unknown): RoutineSchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind === "last_business_day" || row.kind === "every_monday" || row.kind === "books_close") {
    return { kind: row.kind };
  }
  if (row.kind === "n_bd_before_month_end" || row.kind === "nth_bd_after_month_end") {
    const n = row.n;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 15) return null;
    return { kind: row.kind, n };
  }
  return null;
}

export type ParsedRoutineMapMeta = ImRoutineMapArtifactMeta & {
  schedule: RoutineSchedule | null;
  action: RoutineActionKind | null;
};

export function parseRoutineMapMeta(meta: unknown): ParsedRoutineMapMeta | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const row = meta as Record<string, unknown>;
  if (row.doc_type !== IM_ACTIVATION_DOC_TYPE) return null;
  if (row.source !== IM_ACTIVATION_SOURCE) return null;
  const routine = row.routine;
  const allowed: ImRoutineKind[] = [
    "document_chase",
    "monthly_pack",
    "cash_debtor_early_warning",
    "budget_actual_drift",
    "tax_deadline_watch",
  ];
  if (!allowed.includes(routine as ImRoutineKind)) return null;
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
    im_kind: IM_ACTIVATION_META_KIND,
    type: IM_ACTIVATION_META_KIND,
    firm_id: typeof row.firm_id === "string" ? row.firm_id : "",
    routine: routine as ImRoutineKind,
    idempotency_key: typeof row.idempotency_key === "string" ? row.idempotency_key : "",
    steps: parsedSteps,
    hours_saved_per_run: typeof hours === "number" && Number.isFinite(hours) ? hours : null,
    accepted_at: typeof row.accepted_at === "string" ? row.accepted_at : "",
    design_model: typeof row.design_model === "string" ? row.design_model : "",
    execution_model: typeof row.execution_model === "string" ? row.execution_model : "",
    schedule: parseRoutineSchedule(row.schedule),
    action: parseRoutineAction(row.action),
  };
}

/** Write schedule and action onto an existing routine map. Does not change kind or the template id. */
export function mergeRoutineSettingsMeta(
  raw: unknown,
  settings: { schedule: unknown; action: unknown },
): Record<string, unknown> | null {
  if (!parseRoutineMapMeta(raw) || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const schedule = parseRoutineSchedule(settings.schedule);
  const action = parseRoutineAction(settings.action);
  if (!schedule || !action) return null;
  return { ...(raw as Record<string, unknown>), schedule, action };
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

export function accountantRoutineSteps(input: {
  firmId: string;
  clientId: string;
  meta: ImRoutineMapArtifactMeta & { schedule?: RoutineSchedule | null };
  actions: readonly RoutineActionRow[];
  runs: readonly RoutineRunRow[];
  scheduleContext?: ImRoutineEventContext;
}): AccountantRoutineStep[] {
  const now = input.scheduleContext?.now ?? new Date();
  const scheduleContext: ImRoutineEventContext = {
    hasLedger: input.scheduleContext?.hasLedger ?? false,
    hasUpload: input.scheduleContext?.hasUpload ?? false,
    ...input.scheduleContext,
    now,
  };
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
      lastRunAt: routineStepLastRunAt(relatedRuns),
      nextRunLabel: routineStepNextRunLabel({
        step,
        runs: relatedRuns,
        context: scheduleContext,
        status,
        now,
        schedule: input.meta.schedule,
      }),
    };
  });
}

export function routineTitle(routine: ImRoutineKind): string {
  if (routine === "document_chase") return "Document chase routine";
  if (routine === "monthly_pack") return "Monthly pack routine";
  if (routine === "cash_debtor_early_warning") return "Cash and debtor early warning";
  if (routine === "budget_actual_drift") return "Budget-versus-actual drift check";
  if (routine === "tax_deadline_watch") return "Tax deadline watch (Tax Specialist)";
  return "Pilot routine";
}

export function routineActionTitle(action: RoutineActionKind): string {
  if (action === "client_update_draft") return "Draft client update email";
  if (action === "report_pack") return "Build a report: pack";
  if (action === "report_cash") return "Build a report: cash";
  if (action === "report_waterfall") return "Build a report: waterfall";
  if (action === "report_budget") return "Build a report: budget";
  return routineTitle(action);
}

/** Queued-run summary. Tax stays a review draft. Nothing here is sent. */
export function routineDraftSummary(action: RoutineActionKind | null | undefined, botOwner: string): string {
  if (botOwner.toLowerCase().includes("tax")) return "Implementation Manager routine — draft for review.";
  if (action === "client_update_draft") return "Implementation Manager routine — client_update_draft, unsent draft.";
  if (action && (REPORT_ACTIONS as readonly string[]).includes(action)) {
    return `Implementation Manager routine — ${action}, unsent draft.`;
  }
  return "Implementation Manager routine — draft only.";
}

export { imRoutinePeriodKey };

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