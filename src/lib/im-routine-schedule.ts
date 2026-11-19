/**
 * Implementation Manager routine schedule + event engine. Pure TS — Africa/Johannesburg.
 */
import type { ImRoutineMapStep } from "./im-activation-planner.ts";
import {
  computeMonthVariance,
  isMaterialVariance,
  normalizeTaxonomyTotals,
  type TaxonomyTotals,
} from "./budget.variance.ts";
import type { BudgetMonthResult } from "./budget.types.ts";
import { botOwnerToAgentKey, imActivationTriggerMet, type ImBooksContext } from "./im-activation-triggers.ts";
import { activationActionMoveKey, activationRunInputs } from "./im-activation-persist.ts";
import type { ImRoutineMapArtifactMeta } from "./im-activation-persist.ts";
import { calendarDateInTimeZone, calendarMonthBounds } from "./statement-period.ts";
import type { RoutineActionRow, RoutineRunRow } from "./client-routines.ts";
import { formatLastRun } from "./milon-team.ts";

export const IM_ROUTINE_TIME_ZONE = "Africa/Johannesburg";

export type ImRoutineEventContext = ImBooksContext & {
  now?: Date;
  /** Statement period / ledger snapshot on file. */
  periodOnFile?: boolean;
  /** Confirmed month actuals landed for the active period. */
  actualsLanded?: boolean;
  /** Budget-vs-actual drift breach (computed in code — not in a model). */
  varianceBreached?: boolean;
  /** Client library upload since period start. */
  documentUploaded?: boolean;
  /** Cash / collections pressure signal from ledger reads. */
  cashCollectionsRisk?: boolean;
};

export function imRoutinePeriodKey(now: Date = new Date()): string {
  const { year, month } = calendarDateInTimeZone(now, IM_ROUTINE_TIME_ZONE);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function ymdInTimeZone(now: Date, timeZone: string): string {
  const { year, month, day } = calendarDateInTimeZone(now, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isWeekdayInTimeZone(instant: Date, timeZone: string): boolean {
  // date-ok: weekday probe only for business-day math, not printed copy
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
  return day !== "Sat" && day !== "Sun";
}

function parseScheduleTrigger(
  trigger: string,
): { kind: "n_bd_before_month_end"; n: number } | { kind: "after_month_end" } | null {
  const before = /^schedule_(\d+)bd_before_month_end$/.exec(trigger);
  if (before) {
    const n = Number(before[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 15) return { kind: "n_bd_before_month_end", n };
  }
  if (trigger === "schedule_after_month_end") return { kind: "after_month_end" };
  return null;
}

/** Calendar day in JHB when an N-business-day-before-month-end schedule fires. */
export function scheduleBusinessDaysBeforeMonthEndYmd(n: number, now: Date, timeZone = IM_ROUTINE_TIME_ZONE): string {
  const { to: monthEndYmd } = calendarMonthBounds(now, 0, timeZone);
  let cursor = new Date(`${monthEndYmd}T12:00:00.000Z`);
  let counted = 0;
  while (counted < n) {
    cursor = new Date(cursor.getTime() - 86_400_000);
    if (isWeekdayInTimeZone(cursor, timeZone)) counted += 1;
  }
  return ymdInTimeZone(cursor, timeZone);
}

export function scheduleNBusinessDaysBeforeMonthEndMet(
  n: number,
  now: Date,
  timeZone = IM_ROUTINE_TIME_ZONE,
): boolean {
  const { to: monthEndYmd } = calendarMonthBounds(now, 0, timeZone);
  const triggerYmd = scheduleBusinessDaysBeforeMonthEndYmd(n, now, timeZone);
  const today = ymdInTimeZone(now, timeZone);
  return today >= triggerYmd && today <= monthEndYmd;
}

/** True once the prior calendar month has closed in `timeZone` (month-end close window). */
export function scheduleAfterMonthEndMet(now: Date, timeZone = IM_ROUTINE_TIME_ZONE): boolean {
  const { to: priorMonthEndYmd } = calendarMonthBounds(now, 1, timeZone);
  return ymdInTimeZone(now, timeZone) > priorMonthEndYmd;
}

/** Material drift — same threshold as the budget month engine (`isMaterialVariance`). */
export function imBudgetVarianceThresholdBreached(
  budget: Pick<
    BudgetMonthResult,
    "month" | "revenue" | "cogs" | "grossProfit" | "overheads" | "depreciation" | "ebit"
  >,
  actual: TaxonomyTotals,
): boolean {
  const report = computeMonthVariance(budget as BudgetMonthResult, normalizeTaxonomyTotals(actual), budget.month);
  return report.lines.some(isMaterialVariance);
}

export function imRoutineTriggerMet(trigger: string, context: ImRoutineEventContext, priorStepDone: boolean): boolean {
  if (trigger === "human_approval_gate" || trigger === "event_prior_step_succeeded") {
    return priorStepDone;
  }
  const schedule = parseScheduleTrigger(trigger);
  if (schedule?.kind === "n_bd_before_month_end") {
    return scheduleNBusinessDaysBeforeMonthEndMet(schedule.n, context.now ?? new Date());
  }
  if (schedule?.kind === "after_month_end") {
    return scheduleAfterMonthEndMet(context.now ?? new Date());
  }
  if (trigger === "event_period_on_file") return Boolean(context.periodOnFile ?? context.hasLedger);
  if (trigger === "event_actuals_landed") return Boolean(context.actualsLanded);
  if (trigger === "event_threshold_breached") return Boolean(context.varianceBreached);
  if (trigger === "event_budget_drift_check") {
    const breached = Boolean(context.varianceBreached);
    const actuals = Boolean(context.actualsLanded);
    const afterMonth = scheduleAfterMonthEndMet(context.now ?? new Date());
    return breached && (actuals || afterMonth);
  }
  if (trigger === "event_document_uploaded") return Boolean(context.documentUploaded ?? context.hasUpload);
  if (trigger === "event_cash_collections_risk") {
    return Boolean(context.cashCollectionsRisk && (context.hasLedger || context.hasUpload));
  }
  return imActivationTriggerMet(trigger, context);
}

/** True when `instant` falls in the JHB calendar month `periodKey` (YYYY-MM). */
export function imRoutineInstantInPeriod(instant: Date, periodKey: string): boolean {
  return imRoutinePeriodKey(instant) === periodKey;
}

export function runStampInRoutinePeriod(stamp: string | null | undefined, periodKey: string): boolean {
  if (!stamp) return false;
  const instant = new Date(stamp);
  if (Number.isNaN(instant.getTime())) return false;
  return imRoutineInstantInPeriod(instant, periodKey);
}

function runFinishedInPeriod(run: RoutineRunRow, periodKey: string): boolean {
  const stamp = run.finished_at ?? run.started_at ?? run.queued_at;
  return runStampInRoutinePeriod(stamp, periodKey);
}

function runsForStepInPeriod(runs: readonly RoutineRunRow[], periodKey: string): RoutineRunRow[] {
  return runs.filter((run) => runFinishedInPeriod(run, periodKey));
}

export function routineStepLastRunAt(runs: readonly RoutineRunRow[]): string | null {
  const finished = runs
    .filter((run) => run.finished_at)
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));
  return finished[0]?.finished_at ?? null;
}

export function routineStepNextRunLabel(input: {
  step: ImRoutineMapStep;
  runs: readonly RoutineRunRow[];
  context: ImRoutineEventContext;
  status: "waiting" | "running" | "done" | "needs_approval";
  now?: Date;
}): string | null {
  if (input.status === "running") return "Running now";
  if (input.status === "done") return "On cadence";
  const now = input.now ?? input.context.now ?? new Date();
  const periodKey = imRoutinePeriodKey(now);
  const periodRuns = runsForStepInPeriod(input.runs, periodKey);
  const queued = periodRuns.find((run) => run.status === "queued");
  if (queued?.queued_at) return `Queued ${formatLastRun(queued.queued_at) ?? "soon"}`;

  const schedule = parseScheduleTrigger(input.step.trigger);
  if (schedule?.kind === "n_bd_before_month_end") {
    const ymd = scheduleBusinessDaysBeforeMonthEndYmd(schedule.n, now);
    return `Scheduled ${ymd} (SAST)`;
  }
  if (schedule?.kind === "after_month_end") {
    const { to } = calendarMonthBounds(now, 0, IM_ROUTINE_TIME_ZONE);
    return `After month end (${to})`;
  }
  if (imRoutineTriggerMet(input.step.trigger, { ...input.context, now }, false)) {
    return "Trigger met — draft queue pending";
  }
  return "Waiting on books or trigger";
}

export function scheduledRunInputs(actionItemId: string, periodKey: string): string {
  return `${activationRunInputs(actionItemId)}:${periodKey}`;
}

export type ImRoutineEnqueuePlan = {
  routine: ImRoutineMapArtifactMeta["routine"];
  stepId: string;
  actionMoveKey: string;
  agent: "financial_manager" | "analyst" | "advisor";
  trigger: string;
  periodKey: string;
};

export function planImRoutineEnqueues(input: {
  firmId: string;
  clientId: string;
  meta: ImRoutineMapArtifactMeta;
  actions: readonly RoutineActionRow[];
  runs: readonly RoutineRunRow[];
  context: ImRoutineEventContext;
  now?: Date;
}): ImRoutineEnqueuePlan[] {
  if (!input.meta.accepted_at) return [];
  const now = input.now ?? input.context.now ?? new Date();
  const periodKey = imRoutinePeriodKey(now);
  const enqueues: ImRoutineEnqueuePlan[] = [];
  let priorSucceeded = true;

  for (const step of input.meta.steps) {
    const moveKey = activationActionMoveKey(input.firmId, input.clientId, input.meta.routine, step.id);
    const action = input.actions.find((row) => row.source_move_key === moveKey);
    const relatedRuns = input.runs.filter(
      (run) => run.action_item_id && run.action_item_id === action?.id,
    );
    const periodRuns = runsForStepInPeriod(relatedRuns, periodKey);
    const succeeded = periodRuns.some((run) =>
      ["succeeded", "partial", "skipped"].includes(run.status),
    );
    const open = periodRuns.some((run) => run.status === "queued" || run.status === "running");
    if (succeeded) {
      priorSucceeded = true;
      continue;
    }
    if (open) break;

    const agent = botOwnerToAgentKey(step.botOwner);
    if (!agent) {
      priorSucceeded = false;
      continue;
    }

    const triggerMet = imRoutineTriggerMet(step.trigger, { ...input.context, now }, priorSucceeded);
    if (!triggerMet) {
      priorSucceeded = false;
      break;
    }

    if (enqueues.some((row) => row.stepId === step.id)) break;
    enqueues.push({
      routine: input.meta.routine,
      stepId: step.id,
      actionMoveKey: moveKey,
      agent,
      trigger: step.trigger,
      periodKey,
    });
    break;
  }
  return enqueues;
}

/** Accepted artifact present — declined routines never write routine_map meta. */
export function routineMapIsAccepted(meta: ImRoutineMapArtifactMeta | null): boolean {
  return Boolean(meta?.accepted_at);
}