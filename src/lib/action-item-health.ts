/**
 * Action-row health. A past due date is Overdue. An open item with no due
 * date is Overdue when the plan target has passed. No due date and no
 * progress, while the target is still ahead, is Not started — that is not
 * On track.
 */
import { actionIsOverdue } from "./action-plan-counts.ts";

export type ActionItemHealth =
  | "on_track"
  | "at_risk"
  | "off_track"
  | "overdue"
  | "complete"
  | "not_started";

export function deriveActionHealth(
  it: {
    status: string;
    due_date: string | null;
    progress_pct: number;
    created_at: string;
    plan_target?: string | null;
  },
  now = new Date(),
): ActionItemHealth {
  if (it.status === "done") return "complete";
  if (
    actionIsOverdue(
      { status: it.status, dueDate: it.due_date, planTarget: it.plan_target ?? null },
      now,
    )
  ) {
    return "overdue";
  }
  if (it.status === "blocked") return "off_track";
  if (!it.due_date) return (it.progress_pct ?? 0) <= 0 ? "not_started" : "on_track";
  const pace = actionPace(it, now);
  if (pace >= 0.9) return "on_track";
  if (pace >= 0.6) return "at_risk";
  return "off_track";
}

/** Actual progress ÷ expected progress by `now`. No due date is not a full pace. */
export function actionPace(
  it: { due_date: string | null; progress_pct: number; created_at: string },
  now = new Date(),
): number {
  if (!it.due_date) return (it.progress_pct ?? 0) > 0 ? 1 : 0;
  const created = new Date(it.created_at).getTime();
  const due = new Date(`${it.due_date}T23:59:59`).getTime();
  const clock = now.getTime();
  const expected = Math.max((100 * (clock - created)) / Math.max(due - created, 1), 5);
  return it.progress_pct / expected;
}
