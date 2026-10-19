/**
 * Whether Home should arm another poll tick.
 * The decision uses the snapshot just fetched, not the render that started the timer.
 * One finished run does not stop the poll while another run is still queued or running.
 * A hand-off note with no run is only waited out for about two minutes.
 */
export const HANDOFF_RUN_WAIT_MS = 2 * 60 * 1000;

/** True while a just-written hand-off may still be growing a run row. */
export function handoffStillAwaitingRun(openedAt: string | null | undefined, now = Date.now()): boolean {
  if (!openedAt) return false;
  const stamp = Date.parse(openedAt);
  if (Number.isNaN(stamp)) return false;
  return now - stamp <= HANDOFF_RUN_WAIT_MS;
}

export function pollAfterTick(
  freshRuns: readonly { status: string }[],
  waiting: readonly { openedAt?: string | null }[] = [],
  now = Date.now(),
): "continue" | "stop" {
  if (freshRuns.some((run) => run.status === "queued" || run.status === "running")) return "continue";
  if (waiting.some((row) => handoffStillAwaitingRun(row.openedAt, now))) return "continue";
  return "stop";
}

type HandoffClockRow = {
  id: string;
  open: boolean;
  agent?: string | null;
  openedAt?: string | null;
};

type HandoffClockRun = {
  action_item_id?: string | null;
  actionItemId?: string | null;
  agent: string;
  status: string;
};

/** Working only while a real run is queued or running, or the hand-off is still inside the wait. */
export function handoffRowStillWorking(
  row: HandoffClockRow,
  runs: readonly HandoffClockRun[],
  now = Date.now(),
): boolean {
  if (!row.open || !row.agent) return false;
  const live = runs.some((run) => {
    const id = run.action_item_id ?? run.actionItemId ?? "";
    return id === row.id && run.agent === row.agent && (run.status === "queued" || run.status === "running");
  });
  if (live) return true;
  return handoffStillAwaitingRun(row.openedAt, now);
}
