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
  runId?: string | null;
};

type HandoffClockRun = {
  id?: string;
  action_item_id?: string | null;
  actionItemId?: string | null;
  agent: string;
  status: string;
};

function runActionId(run: { action_item_id?: string | null; actionItemId?: string | null }): string {
  return run.action_item_id ?? run.actionItemId ?? "";
}

/** The run this row is waiting on. A run id only matches that row's action. */
export function handoffRunForAction<T extends HandoffClockRun>(
  runs: readonly T[],
  actionItemId: string,
  runId?: string | null,
): T | null {
  const mine = runs.filter((run) => runActionId(run) === actionItemId);
  if (runId) return mine.find((run) => run.id === runId) ?? null;
  return mine[0] ?? null;
}

/** Working only while this action's run is queued or running, or the hand-off is still inside the wait. */
export function handoffRowStillWorking(
  row: HandoffClockRow,
  runs: readonly HandoffClockRun[],
  now = Date.now(),
): boolean {
  if (!row.open || !row.agent) return false;
  if (row.runId) {
    const match = handoffRunForAction(runs, row.id, row.runId);
    if (!match || match.agent !== row.agent) return handoffStillAwaitingRun(row.openedAt, now);
    return match.status === "queued" || match.status === "running";
  }
  const live = runs.some((run) => {
    return runActionId(run) === row.id && run.agent === row.agent && (run.status === "queued" || run.status === "running");
  });
  if (live) return true;
  return handoffStillAwaitingRun(row.openedAt, now);
}
