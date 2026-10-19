/**
 * Whether Home should arm another poll tick.
 * The decision uses the snapshot just fetched, not the render that started the timer.
 * One finished run does not stop the poll while another run is still queued or running.
 */
export function pollAfterTick(
  freshRuns: readonly { status: string }[],
  pageOpen = false,
): "continue" | "stop" {
  if (freshRuns.some((run) => run.status === "queued" || run.status === "running")) return "continue";
  // A hand-off still on the page has not been settled by this snapshot.
  if (pageOpen) return "continue";
  return "stop";
}
