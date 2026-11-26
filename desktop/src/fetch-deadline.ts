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

/** Hanging sockets abort instead of pinning sign-in. The desktop app passes Electron's net.fetch. */
export function fetchWithDeadline(timeoutMs = SIGN_IN_TIMEOUT_MS, baseFetch: FetchLike = fetch): FetchLike {
  return (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = combineSignals(controller.signal, init?.signal);
    return baseFetch(input, { ...init, signal }).finally(() => clearTimeout(timer));
  };
}
