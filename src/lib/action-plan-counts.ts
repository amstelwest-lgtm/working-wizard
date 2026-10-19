/**
 * One count for the Action Plan, the firm dashboard, and the portfolio.
 * Open is anything not done. Overdue is an open item whose own due date
 * is past, or an open item with no due date whose plan target is past.
 * A suggested due (created + 14 days) is that item's own due date.
 */

import { effectiveActionDue } from "./action-plan-automation.ts";

export type ActionCountInput = {
  status?: string | null;
  dueDate?: string | null;
  planTarget?: string | null;
};

export type ActionPlanCounts = {
  total: number;
  open: number;
  done: number;
  overdue: number;
};

function isoDay(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function dayOf(value: string | Date): string {
  if (value instanceof Date) return isoDay(value);
  return value.slice(0, 10);
}

function isCalendarDay(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
}

function isDoneStatus(status: string | null | undefined): boolean {
  const text = (status ?? "").trim().toLowerCase();
  return text === "done" || text === "complete";
}

/**
 * The one overdue input. A stored date wins. With none, the suggestion is
 * the due date. The plan target applies only when that due date is absent.
 */
export function actionOverdueInput(
  item: {
    status?: string | null;
    dueDate?: string | null;
    createdAt?: string | null;
    planTarget?: string | null;
  },
  today: string | Date = new Date(),
): ActionCountInput {
  const day = dayOf(today);
  const due = effectiveActionDue(
    { dueDate: item.dueDate ?? null, createdAt: item.createdAt ?? null },
    /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : isoDay(new Date()),
  );
  return {
    status: item.status,
    dueDate: due,
    planTarget: due ? null : (item.planTarget ?? null),
  };
}

export function actionIsOverdue(item: ActionCountInput, today: string | Date = new Date()): boolean {
  if (isDoneStatus(item.status)) return false;
  const day = dayOf(today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  if (isCalendarDay(item.dueDate)) return item.dueDate.slice(0, 10) < day;
  if (isCalendarDay(item.planTarget)) return item.planTarget.slice(0, 10) < day;
  return false;
}

export function countActionPlan(
  items: readonly ActionCountInput[],
  today: string | Date = new Date(),
): ActionPlanCounts {
  let open = 0;
  let done = 0;
  let overdue = 0;
  for (const item of items) {
    if (isDoneStatus(item.status)) {
      done += 1;
      continue;
    }
    open += 1;
    if (actionIsOverdue(item, today)) overdue += 1;
  }
  return { total: items.length, open, done, overdue };
}

/** "3 actions · 2 open, including 2 overdue · 1 done" */
export function formatActionPlanCounts(counts: ActionPlanCounts): string {
  const actions = counts.total === 1 ? "1 action" : `${counts.total} actions`;
  let text = `${actions} · ${counts.open} open`;
  if (counts.overdue > 0) text += `, including ${counts.overdue} overdue`;
  if (counts.done > 0) text += ` · ${counts.done} done`;
  return text;
}

export function overdueActionsLabel(n: number): string {
  return n === 1 ? "1 overdue action" : `${n} overdue actions`;
}

export function currentQuarterLabel(now = new Date()): string {
  return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
}

const PLACEHOLDER_GOAL = /set your outcome goal for this quarter/i;

/** A stored quarter stays. The untouched placeholder shows the quarter of `now`. */
export function displayedPlanPeriod(
  stored: string | null | undefined,
  goal: string | null | undefined,
  now = new Date(),
): string {
  if (PLACEHOLDER_GOAL.test((goal ?? "").trim())) return currentQuarterLabel(now);
  const text = (stored ?? "").trim();
  return text || currentQuarterLabel(now);
}

/**
 * The date the goal header shows. A placeholder goal uses the last day of
 * the quarter on the label. A real goal keeps the stored target.
 */
export function displayedPlanTarget(
  stored: string | null | undefined,
  goal: string | null | undefined,
  now = new Date(),
): string {
  const storedDay = (stored ?? "").slice(0, 10);
  if (!PLACEHOLDER_GOAL.test((goal ?? "").trim())) return storedDay;
  const label = displayedPlanPeriod(stored, goal, now);
  const match = /^Q([1-4])\s+(\d{4})$/.exec(label.trim());
  if (!match) return storedDay;
  const quarter = Number(match[1]);
  const year = Number(match[2]);
  return isoDay(new Date(year, quarter * 3, 0));
}

/** Quarter end, moved forward when that day is today or already past. Local calendar, not UTC. */
export function defaultTargetDate(now = new Date()): string {
  const quarter = Math.floor(now.getMonth() / 3);
  let end = new Date(now.getFullYear(), quarter * 3 + 3, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (end.getTime() <= today.getTime()) {
    end = new Date(now.getFullYear(), quarter * 3 + 6, 0);
  }
  return isoDay(end);
}
