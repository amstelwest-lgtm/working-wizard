/**
 * Dashboard reads must settle. A hung PostgREST call cannot hold "Loading…".
 */

export type Settled<T> =
  | { status: "value"; value: T }
  | { status: "timeout" }
  | { status: "error"; error: unknown };

/** One quiet retry after a timed-out or failed client read, before the error card. */
export const CLIENTS_LOAD_RETRY_BACKOFF_MS = 600;

/** One automatic retry after a timed-out or failed firm list, before Retry. */
export const FIRM_LOAD_RETRY_BACKOFF_MS = 1_000;

/**
 * Runs `read` once. A timeout or a thrown read waits `backoffMs`, then runs
 * once more. A value is returned as-is. The second result is final.
 */
export async function readWithOneRetry<T>(
  read: () => Promise<Settled<T>>,
  backoffMs: number,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
): Promise<Settled<T>> {
  let first: Settled<T>;
  try {
    first = await read();
  } catch (error) {
    first = { status: "error", error };
  }
  if (first.status === "value") return first;
  await wait(backoffMs);
  try {
    return await read();
  } catch (error) {
    return { status: "error", error };
  }
}

/** Resolves when `work` settles, or with status "timeout" after `timeoutMs`. `work` is not cancelled. */
export function settleWithin<T>(work: PromiseLike<T>, timeoutMs: number): Promise<Settled<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Settled<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs);
    work.then(
      (value) => finish({ status: "value", value }),
      (error) => finish({ status: "error", error }),
    );
  });
}

export type PracticeClientsPhase = "loading" | "error" | "empty" | "ready" | "partial";

/**
 * Books merge on the clients table. Pending is the shell: names may paint,
 * numeric cells stay a skeleton. The table is ready only after the merge.
 */
export type PracticeFiguresPhase = "pending" | "merged" | "failed";

/**
 * Clients list. A timeout wins over a spinner when nothing has arrived.
 * A shell with rows is not ready: a timeout, or a books merge that has not
 * landed, must not look like a finished table of dashes.
 */
export function practiceClientsPhase(input: {
  loading: boolean;
  timedOut: boolean;
  rowCount: number;
  /** Omitted only for a caller that has no separate books read. */
  figures?: PracticeFiguresPhase;
}): PracticeClientsPhase {
  const figures = input.figures ?? "merged";
  if (input.timedOut && input.rowCount === 0) return "error";
  if (figures === "failed") return "error";
  if (input.timedOut && figures !== "merged") return "error";
  if (input.loading && input.rowCount === 0) return "loading";
  if (input.rowCount === 0) return "empty";
  if (figures === "pending" || input.loading) return "partial";
  return "ready";
}

export type OpenQueriesPhase = "loading" | "error" | "empty" | "ready";

/**
 * Open queries. The loading line is not allowed to outlast the deadline,
 * even while the client list itself is still loading.
 */
export function openQueriesPhase(input: {
  bookLoading: boolean;
  rowsReady: boolean;
  timedOut: boolean;
  rowCount: number;
}): OpenQueriesPhase {
  if (input.timedOut && input.rowCount === 0) return "error";
  if (input.bookLoading || !input.rowsReady) return "loading";
  if (input.rowCount === 0) return "empty";
  return "ready";
}

export const CLIENTS_LOAD_ERROR = "Couldn't load clients. Refresh to try again.";
export const FIGURES_LOAD_ERROR = "Couldn't load figures. Retry.";
export const OPEN_QUERIES_LOAD_ERROR = "Couldn't load open queries. Refresh to try again.";
