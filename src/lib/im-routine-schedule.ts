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
import {
  imActivationTriggerMet,
  imRoutineRunnerAgentForStep,
  type ImBooksContext,
} from "./im-activation-triggers.ts";
import { activationActionMoveKey, activationRunInputs } from "./im-activation-persist.ts";
import type { ImRoutineMapArtifactMeta } from "./im-activation-persist.ts";
import { calendarDateInTimeZone, calendarMonthBounds } from "./statement-period.ts";
import type { RoutineActionKind, RoutineActionRow, RoutineRunRow } from "./client-routines.ts";
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
  /** VAT/EMP or company tax due within the approaching window (ZA). */
  taxDeadlineApproaching?: boolean;
};

export function imRoutinePeriodKey(now: Date = new Date()): string {
  const { year, month } = calendarDateInTimeZone(now, IM_ROUTINE_TIME_ZONE);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function ymdInTimeZone(now: Date, timeZone: string): string {
  const { year, month, day } = calendarDateInTimeZone(now, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekdayShortInTimeZone(instant: Date, timeZone: string): string {
  // date-ok: weekday probe only for business-day math, not printed copy
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
}

function isWeekdayInTimeZone(instant: Date, timeZone: string): boolean {
  const day = weekdayShortInTimeZone(instant, timeZone);
  return day !== "Sat" && day !== "Sun";
}

/**
 * South African public holidays for 2026 and 2027.
 * A holiday that falls on Sunday is also observed on the Monday.
 */
const SA_PUBLIC_HOLIDAYS = new Set([
  "2026-01-01",
  "2026-03-21",
  "2026-04-03",
  "2026-04-06",
  "2026-04-27",
  "2026-05-01",
  "2026-06-16",
  "2026-08-09",
  "2026-08-10",
  "2026-09-24",
  "2026-12-16",
  "2026-12-25",
  "2026-12-26",
  "2027-01-01",
  "2027-03-21",
  "2027-03-22",
  "2027-03-26",
  "2027-03-29",
  "2027-04-27",
  "2027-05-01",
  "2027-06-16",
  "2027-08-09",
  "2027-09-24",
  "2027-12-16",
  "2027-12-25",
  "2027-12-26",
  "2027-12-27",
]);

function isBusinessDayInTimeZone(instant: Date, timeZone: string): boolean {
  if (!isWeekdayInTimeZone(instant, timeZone)) return false;
  return !SA_PUBLIC_HOLIDAYS.has(ymdInTimeZone(instant, timeZone));
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
    if (isBusinessDayInTimeZone(cursor, timeZone)) counted += 1;
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

/**
 * Accountant-set schedule. The two triggers above stay as they are.
 * These options use the real calendar month, not the open-month clamp.
 */
export type RoutineSchedule =
  | { kind: "last_business_day" }
  | { kind: "n_bd_before_month_end"; n: number }
  | { kind: "nth_bd_after_month_end"; n: number }
  | { kind: "every_monday" }
  | { kind: "books_close" };

function realMonthSpanYmd(now: Date, timeZone: string): { start: string; end: string } {
  const { year, month } = calendarDateInTimeZone(now, timeZone);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

function noonOnYmd(ymd: string): Date {
  return new Date(`${ymd}T12:00:00.000Z`);
}

/** Last business day of the calendar month. Skips weekends and SA public holidays. */
export function lastBusinessDayOfMonthYmd(now: Date, timeZone = IM_ROUTINE_TIME_ZONE): string {
  const { end } = realMonthSpanYmd(now, timeZone);
  let cursor = noonOnYmd(end);
  while (!isBusinessDayInTimeZone(cursor, timeZone)) {
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return ymdInTimeZone(cursor, timeZone);
}

/** N weekdays before the real month-end date. Does not replace `scheduleBusinessDaysBeforeMonthEndYmd`. */
export function scheduleBusinessDaysBeforeRealMonthEndYmd(
  n: number,
  now: Date,
  timeZone = IM_ROUTINE_TIME_ZONE,
): string {
  const { end } = realMonthSpanYmd(now, timeZone);
  let cursor = noonOnYmd(end);
  let counted = 0;
  while (counted < n) {
    cursor = new Date(cursor.getTime() - 86_400_000);
    if (isBusinessDayInTimeZone(cursor, timeZone)) counted += 1;
  }
  return ymdInTimeZone(cursor, timeZone);
}

/** Nth business day of the current month (the Nth business day after the prior month ended). */
export function nthBusinessDayAfterMonthEndYmd(n: number, now: Date, timeZone = IM_ROUTINE_TIME_ZONE): string {
  const { start } = realMonthSpanYmd(now, timeZone);
  let cursor = new Date(noonOnYmd(start).getTime() - 86_400_000);
  let counted = 0;
  while (counted < n) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    if (isBusinessDayInTimeZone(cursor, timeZone)) counted += 1;
  }
  return ymdInTimeZone(cursor, timeZone);
}

export function scheduleEveryMondayMet(now: Date, timeZone = IM_ROUTINE_TIME_ZONE): boolean {
  return weekdayShortInTimeZone(now, timeZone) === "Mon";
}

/** Monday of the SAST week containing `now`, including today when today is Monday. */
export function recentMondayYmd(now: Date, timeZone = IM_ROUTINE_TIME_ZONE): string {
  let cursor = noonOnYmd(ymdInTimeZone(now, timeZone));
  for (let i = 0; i < 7; i += 1) {
    if (weekdayShortInTimeZone(cursor, timeZone) === "Mon") return ymdInTimeZone(cursor, timeZone);
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return ymdInTimeZone(now, timeZone);
}

function scheduleWindowThroughMonthEnd(triggerYmd: string, now: Date, timeZone: string): boolean {
  const today = ymdInTimeZone(now, timeZone);
  const { end } = realMonthSpanYmd(now, timeZone);
  return today >= triggerYmd && today <= end;
}

export function routineScheduleMet(
  schedule: RoutineSchedule,
  context: ImRoutineEventContext,
  timeZone = IM_ROUTINE_TIME_ZONE,
): boolean {
  const now = context.now ?? new Date();
  if (schedule.kind === "last_business_day") {
    return scheduleWindowThroughMonthEnd(lastBusinessDayOfMonthYmd(now, timeZone), now, timeZone);
  }
  if (schedule.kind === "n_bd_before_month_end") {
    return scheduleWindowThroughMonthEnd(
      scheduleBusinessDaysBeforeRealMonthEndYmd(schedule.n, now, timeZone),
      now,
      timeZone,
    );
  }
  if (schedule.kind === "nth_bd_after_month_end") {
    return scheduleWindowThroughMonthEnd(nthBusinessDayAfterMonthEndYmd(schedule.n, now, timeZone), now, timeZone);
  }
  if (schedule.kind === "every_monday") return scheduleEveryMondayMet(now, timeZone);
  return Boolean(context.actualsLanded);
}

export function routineScheduleTrigger(schedule: RoutineSchedule): string {
  if (schedule.kind === "last_business_day") return "schedule_last_business_day";
  if (schedule.kind === "n_bd_before_month_end") return `schedule_${schedule.n}bd_before_month_end`;
  if (schedule.kind === "nth_bd_after_month_end") return `schedule_${schedule.n}bd_after_month_end`;
  if (schedule.kind === "every_monday") return "schedule_every_monday";
  return "schedule_books_close";
}

/** Agent for a new action. Existing routine kinds keep the step's bot. */
export function draftingAgentForAction(
  action: RoutineActionKind,
): "financial_manager" | "analyst" | "advisor" | null {
  if (action === "client_update_draft") return "advisor";
  if (action === "report_cash") return "financial_manager";
  if (action === "report_pack" || action === "report_waterfall" || action === "report_budget") return "analyst";
  return null;
}

export function routineOccurrenceKey(schedule: RoutineSchedule | null | undefined, now: Date): string {
  if (schedule?.kind === "every_monday") return recentMondayYmd(now);
  return imRoutinePeriodKey(now);
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
  if (trigger === "event_tax_deadline_approaching") {
    return Boolean(context.taxDeadlineApproaching && (context.hasLedger || context.hasUpload));
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) return ymdInTimeZone(instant, IM_ROUTINE_TIME_ZONE) === periodKey;
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

function savedScheduleLabel(schedule: RoutineSchedule, now: Date, context: ImRoutineEventContext): string {
  if (routineScheduleMet(schedule, { ...context, now })) return "Trigger met — draft queue pending";
  if (schedule.kind === "every_monday") return `Every Monday (next ${nextMondayYmd(now)})`;
  if (schedule.kind === "books_close") return "When the books close";
  const ymd =
    schedule.kind === "last_business_day"
      ? lastBusinessDayOfMonthYmd(now)
      : schedule.kind === "n_bd_before_month_end"
        ? scheduleBusinessDaysBeforeRealMonthEndYmd(schedule.n, now)
        : nthBusinessDayAfterMonthEndYmd(schedule.n, now);
  return `Scheduled ${ymd} (SAST)`;
}

function nextMondayYmd(now: Date): string {
  if (scheduleEveryMondayMet(now)) return ymdInTimeZone(now, IM_ROUTINE_TIME_ZONE);
  const recent = recentMondayYmd(now);
  return ymdInTimeZone(new Date(noonOnYmd(recent).getTime() + 7 * 86_400_000), IM_ROUTINE_TIME_ZONE);
}

export function routineStepNextRunLabel(input: {
  step: ImRoutineMapStep;
  runs: readonly RoutineRunRow[];
  context: ImRoutineEventContext;
  status: "waiting" | "running" | "done" | "needs_approval";
  now?: Date;
  schedule?: RoutineSchedule | null;
}): string | null {
  if (input.status === "running") return "Running now";
  if (input.status === "done") return "On cadence";
  const now = input.now ?? input.context.now ?? new Date();
  const periodKey = routineOccurrenceKey(input.schedule, now);
  const periodRuns = runsForStepInPeriod(input.runs, periodKey);
  const queued = periodRuns.find((run) => run.status === "queued");
  if (queued?.queued_at) return `Queued ${formatLastRun(queued.queued_at) ?? "soon"}`;

  if (input.schedule) return savedScheduleLabel(input.schedule, now, input.context);

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
  botOwner: string;
  trigger: string;
  periodKey: string;
  actionKind: RoutineActionKind | null;
};

/** Cash-collections stub: books on file but risk signal false — count before planning drops the step. */
export function countImRoutineStubSkips(input: {
  meta: ImRoutineMapArtifactMeta & { schedule?: RoutineSchedule | null };
  actions: readonly RoutineActionRow[];
  runs: readonly RoutineRunRow[];
  context: ImRoutineEventContext;
  firmId: string;
  clientId: string;
  now?: Date;
}): number {
  if (!input.meta.accepted_at || input.meta.routine !== "cash_debtor_early_warning") return 0;
  const now = input.now ?? input.context.now ?? new Date();
  const periodKey = routineOccurrenceKey(input.meta.schedule, now);
  let priorSucceeded = true;
  let schedulePending = Boolean(input.meta.schedule);
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
      schedulePending = false;
      continue;
    }
    if (open) break;
    if (
      !schedulePending &&
      step.trigger === "event_cash_collections_risk" &&
      priorSucceeded &&
      (input.context.hasLedger || input.context.hasUpload) &&
      !input.context.cashCollectionsRisk &&
      !imRoutineTriggerMet(step.trigger, { ...input.context, now }, priorSucceeded)
    ) {
      return 1;
    }
    priorSucceeded = false;
    break;
  }
  return 0;
}

export function planImRoutineEnqueues(input: {
  firmId: string;
  clientId: string;
  meta: ImRoutineMapArtifactMeta & {
    schedule?: RoutineSchedule | null;
    action?: RoutineActionKind | null;
  };
  actions: readonly RoutineActionRow[];
  runs: readonly RoutineRunRow[];
  context: ImRoutineEventContext;
  now?: Date;
}): ImRoutineEnqueuePlan[] {
  if (!input.meta.accepted_at) return [];
  const now = input.now ?? input.context.now ?? new Date();
  const savedSchedule = input.meta.schedule ?? null;
  const periodKey = routineOccurrenceKey(savedSchedule, now);
  const enqueues: ImRoutineEnqueuePlan[] = [];
  let priorSucceeded = true;
  let schedulePending = Boolean(savedSchedule);

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
      schedulePending = false;
      continue;
    }
    if (open) break;

    let agent = imRoutineRunnerAgentForStep(step.botOwner);
    if (!agent) {
      priorSucceeded = false;
      continue;
    }

    const schedule = schedulePending ? savedSchedule : null;
    const triggerMet = schedule
      ? routineScheduleMet(schedule, { ...input.context, now })
      : imRoutineTriggerMet(step.trigger, { ...input.context, now }, priorSucceeded);
    if (!triggerMet) {
      priorSucceeded = false;
      break;
    }

    const actionKind = schedule ? input.meta.action ?? null : null;
    if (actionKind) {
      const override = draftingAgentForAction(actionKind);
      if (override) agent = override;
    }

    if (enqueues.some((row) => row.stepId === step.id)) break;
    enqueues.push({
      routine: input.meta.routine,
      stepId: step.id,
      actionMoveKey: moveKey,
      agent,
      botOwner: step.botOwner,
      trigger: schedule ? routineScheduleTrigger(schedule) : step.trigger,
      periodKey,
      actionKind,
    });
    break;
  }
  return enqueues;
}

/** Accepted artifact present — declined routines never write routine_map meta. */
export function routineMapIsAccepted(meta: ImRoutineMapArtifactMeta | null): boolean {
  return Boolean(meta?.accepted_at);
}
