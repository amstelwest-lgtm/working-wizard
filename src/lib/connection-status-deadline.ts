/** Status probes give up the spinner at three seconds and paint a fallback. */
export const CONNECTION_STATUS_DEADLINE_MS = 3_000;

export const CONNECTION_NOT_CONNECTED = "Not connected";

export type ConnectionPhase = "checking" | "live" | "stored" | "none" | "coming_soon";

/**
 * First paint when this client has no stored connection row.
 * QuickBooks and Xero read "Not connected". Sage stays coming soon.
 * The probe may upgrade a real row later. It must not pass through "Checking…".
 */
export function connectionRestingPhase(comingSoon?: boolean): ConnectionPhase {
  return comingSoon ? "coming_soon" : "none";
}

export type ConnectionStatusView<T> = {
  phase: ConnectionPhase;
  value: T | null;
};

export type ConnectionCheck<T> = {
  id: string;
  probe: () => Promise<T | null>;
  stored: T | null;
  /** Sage times out to the existing coming-soon panel when nothing is stored. */
  comingSoon?: boolean;
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

/**
 * Live result wins. Past the deadline, use the stored row, then coming soon,
 * then not connected. A probe that has not finished stays on checking.
 */
export function resolveConnectionStatus<T>(input: {
  elapsedMs: number;
  settled: boolean;
  live: T | null;
  stored: T | null;
  comingSoon?: boolean;
  deadlineMs?: number;
}): ConnectionStatusView<T> {
  const deadline = input.deadlineMs ?? CONNECTION_STATUS_DEADLINE_MS;
  if (input.settled) {
    if (input.live) return { phase: "live", value: input.live };
    return { phase: "none", value: null };
  }
  if (input.elapsedMs < deadline) return { phase: "checking", value: null };
  if (input.stored) return { phase: "stored", value: input.stored };
  if (input.comingSoon) return { phase: "coming_soon", value: null };
  return { phase: "none", value: null };
}

type ProbeRow<T> = {
  check: ConnectionCheck<T>;
  pending: Promise<void>;
  read: () => { settled: boolean; live: T | null };
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
    let live: T | null = null;
    let result: Promise<T | null>;
    try {
      result = Promise.resolve(check.probe());
    } catch {
      settled = true;
      result = Promise.resolve(null);
    }
    const pending = result.then(
      (value) => {
        settled = true;
        live = value ?? null;
      },
      () => {
        settled = true;
        live = null;
      },
    );
    return { check, pending, read: () => ({ settled, live }) };
  });

  const snapshot = (): Record<string, ConnectionStatusView<T>> => {
    const out: Record<string, ConnectionStatusView<T>> = {};
    for (const row of rows) {
      const snap = row.read();
      out[row.check.id] = resolveConnectionStatus({
        elapsedMs: snap.settled ? 0 : deadline,
        settled: snap.settled,
        live: snap.live,
        stored: row.check.stored,
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
