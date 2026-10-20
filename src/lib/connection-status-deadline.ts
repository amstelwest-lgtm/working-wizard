/** Status probes give up the spinner at three seconds and paint a fallback. */
export const CONNECTION_STATUS_DEADLINE_MS = 3_000;

export const CONNECTION_NOT_CONNECTED = "Not connected";

/** A row exists, but the status probe has not confirmed it. */
export const CONNECTION_CONNECTED_UNVERIFIED = "Connected";

export const CONNECTION_STATUS_UNVERIFIED = "Status unverified";

export type ConnectionPhase =
  | "checking"
  | "live"
  | "stored"
  | "none"
  | "coming_soon"
  | "unverified"
  | "retry";

/** Cheap `xero_connections` / `qbo_connections` / `sage_connections` read. */
export type ConnectionRowFact = "unknown" | "present" | "absent";

/**
 * First paint. "Not connected" only when a row read has already found nothing.
 * Unknown and present stay on the skeleton so a connected client never flashes
 * a Connect button. Sage coming soon is the absent-row resting phase.
 */
export function connectionRestingPhase(input?: {
  comingSoon?: boolean;
  row?: ConnectionRowFact;
}): ConnectionPhase {
  if (input?.row === "absent") return input.comingSoon ? "coming_soon" : "none";
  return "checking";
}

/** Visible card copy. Only the absent-row phase says "Not connected". */
export function connectionVisibleLabel(phase: ConnectionPhase): string | null {
  if (phase === "none") return CONNECTION_NOT_CONNECTED;
  if (phase === "unverified") return CONNECTION_CONNECTED_UNVERIFIED;
  return null;
}

export type ConnectionStatusView<T> = {
  phase: ConnectionPhase;
  value: T | null;
};

export type ConnectionCheck<T> = {
  id: string;
  probe: () => Promise<T | null>;
  stored: T | null;
  /** Sage times out to the existing coming-soon panel when the row is absent. */
  comingSoon?: boolean;
  /**
   * Updated by the cheap row select while the status probe is in flight.
   * The deadline reads `.current`, so a row that arrives before the timeout
   * is the fallback.
   */
  rowFact?: { current: ConnectionRowFact };
};

export type ConnectionCheckOptions = {
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function probeHasStatus(live: unknown): boolean {
  if (!live || typeof live !== "object") return false;
  if (!("status" in live)) return true;
  return Boolean((live as { status?: unknown }).status);
}

function absentPhase(comingSoon?: boolean): ConnectionPhase {
  return comingSoon ? "coming_soon" : "none";
}

/**
 * A live status wins. A failed or unfinished probe falls back to the row fact:
 * present stays Connected (unverified), absent is Not connected, unknown is a
 * neutral retry. It does not paint "Not connected" just because the probe failed.
 */
export function resolveConnectionStatus<T>(input: {
  elapsedMs: number;
  settled: boolean;
  failed?: boolean;
  live: T | null;
  stored: T | null;
  row?: ConnectionRowFact;
  comingSoon?: boolean;
  deadlineMs?: number;
}): ConnectionStatusView<T> {
  const deadline = input.deadlineMs ?? CONNECTION_STATUS_DEADLINE_MS;
  const row = input.row ?? "unknown";
  if (input.settled && !input.failed && probeHasStatus(input.live)) {
    return { phase: "live", value: input.live };
  }
  if (
    input.settled &&
    !input.failed &&
    input.live &&
    typeof input.live === "object" &&
    (input.live as { configured?: boolean | null }).configured === false
  ) {
    return { phase: "live", value: input.live };
  }
  if (input.settled) {
    if (row === "present" || (input.stored && probeHasStatus(input.stored))) {
      return input.stored && probeHasStatus(input.stored)
        ? { phase: "stored", value: input.stored }
        : { phase: "unverified", value: input.stored };
    }
    if (row === "absent") return { phase: absentPhase(input.comingSoon), value: null };
    if (!input.failed && input.live) return { phase: "live", value: input.live };
    return { phase: "retry", value: null };
  }
  if (row === "absent") return { phase: absentPhase(input.comingSoon), value: null };
  if (input.elapsedMs < deadline) return { phase: "checking", value: null };
  if (input.stored && probeHasStatus(input.stored)) return { phase: "stored", value: input.stored };
  if (row === "present") return { phase: "unverified", value: input.stored };
  return { phase: "retry", value: null };
}

type ProbeRow<T> = {
  check: ConnectionCheck<T>;
  pending: Promise<void>;
  read: () => { settled: boolean; failed: boolean; live: T | null };
};

/**
 * Starts every probe before waiting. Each card resolves at the deadline from
 * the live row, the stored row, or not-connected. `finished` replaces that
 * fallback when a slow probe later returns.
 */
export function startConnectionChecks<T>(
  checks: readonly ConnectionCheck<T>[],
  options?: ConnectionCheckOptions,
): {
  settled: Promise<Record<string, ConnectionStatusView<T>>>;
  finished: Promise<Record<string, ConnectionStatusView<T>>>;
} {
  const deadline = options?.deadlineMs ?? CONNECTION_STATUS_DEADLINE_MS;
  const sleep = options?.sleep ?? defaultSleep;
  const rows: ProbeRow<T>[] = checks.map((check) => {
    let settled = false;
    let failed = false;
    let live: T | null = null;
    let result: Promise<T | null>;
    try {
      result = Promise.resolve(check.probe());
    } catch {
      settled = true;
      failed = true;
      result = Promise.resolve(null);
    }
    const pending = result.then(
      (value) => {
        settled = true;
        live = value ?? null;
      },
      () => {
        settled = true;
        failed = true;
        live = null;
      },
    );
    return { check, pending, read: () => ({ settled, failed, live }) };
  });

  const snapshot = (): Record<string, ConnectionStatusView<T>> => {
    const out: Record<string, ConnectionStatusView<T>> = {};
    for (const row of rows) {
      const snap = row.read();
      out[row.check.id] = resolveConnectionStatus({
        elapsedMs: snap.settled ? 0 : deadline,
        settled: snap.settled,
        failed: snap.failed,
        live: snap.live,
        stored: row.check.stored,
        row: row.check.rowFact?.current ?? "unknown",
        comingSoon: row.check.comingSoon,
        deadlineMs: deadline,
      });
    }
    return out;
  };

  const settled = (async () => {
    await Promise.race([Promise.all(rows.map((row) => row.pending)), sleep(deadline)]);
    await Promise.resolve();
    return snapshot();
  })();
  const finished = Promise.all(rows.map((row) => row.pending)).then(async () => {
    await Promise.resolve();
    return snapshot();
  });
  return { settled, finished };
}

type Waiter = {
  check: ConnectionCheck<unknown>;
  onView: (view: ConnectionStatusView<unknown>) => void;
  resolve: (view: ConnectionStatusView<unknown>) => void;
  options?: ConnectionCheckOptions;
};

const queue: Waiter[] = [];
let flushScheduled = false;

/** Test isolation. Production never needs to drop a batch. */
export function resetConnectionStatusQueue(): void {
  queue.splice(0, queue.length);
  flushScheduled = false;
}

/**
 * Cards call this in the same turn. The queue flushes once, so QuickBooks and
 * Sage start together instead of one waiting for the other.
 */
export function enqueueConnectionCheck<T>(
  check: ConnectionCheck<T>,
  onView: (view: ConnectionStatusView<T>) => void,
  options?: ConnectionCheckOptions,
): Promise<ConnectionStatusView<T>> {
  return new Promise((resolve) => {
    queue.push({
      check: check as ConnectionCheck<unknown>,
      onView: onView as (view: ConnectionStatusView<unknown>) => void,
      resolve: resolve as (view: ConnectionStatusView<unknown>) => void,
      options,
    });
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const batch = queue.splice(0, queue.length);
      for (const item of batch) {
        let delivered = false;
        const started = startConnectionChecks([item.check], item.options);
        const deliver = (views: Record<string, ConnectionStatusView<unknown>>) => {
          const view = views[item.check.id] ?? { phase: "none" as const, value: null };
          item.onView(view);
          if (!delivered) {
            delivered = true;
            item.resolve(view);
          }
        };
        void started.settled.then(deliver);
        void started.finished.then(deliver);
      }
    });
  });
}
