import { SIGN_IN_TIMEOUT_MS } from "./sign-in-error";

function combineSignals(timeout: AbortSignal, parent?: AbortSignal | null): AbortSignal {
  if (!parent) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([timeout, parent]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (timeout.aborted || parent.aborted) {
    controller.abort();
    return controller.signal;
  }
  timeout.addEventListener("abort", abort, { once: true });
  parent.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function deadlineError(): Error {
  const error = new Error("timeout");
  error.name = "TimeoutError";
  return Object.assign(error, { code: "timeout" });
}

/**
 * Hanging sockets abort instead of pinning sign-in. The desktop app passes
 * Electron's net.fetch. The signal is aborted at the deadline, and the race
 * still rejects if net.fetch ignores the signal.
 */
export function fetchWithDeadline(timeoutMs = SIGN_IN_TIMEOUT_MS, baseFetch: FetchLike = fetch): FetchLike {
  return (input, init) => {
    const controller = new AbortController();
    const signal = combineSignals(controller.signal, init?.signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(deadlineError());
      }, timeoutMs);
    });
    const request = Promise.resolve()
      .then(() => baseFetch(input, { ...init, signal }))
      .finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
    void request.catch(() => {
      /* The deadline may already have settled the race. */
    });
    return Promise.race([request, deadline]);
  };
}
