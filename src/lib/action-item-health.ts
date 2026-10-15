/**
 * Action-row health. A past due date is Overdue. No due date and no progress
 * is Not started — that is not On track.
 */

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
  },
  now = new Date(),
): ActionItemHealth {
  if (it.status === "done") return "complete";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (it.due_date && new Date(`${it.due_date}T00:00:00`) < today) return "overdue";
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
