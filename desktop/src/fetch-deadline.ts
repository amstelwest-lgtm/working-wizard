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

/** Node fetch used by the desktop Supabase client. Hanging sockets abort instead of pinning sign-in. */
export function fetchWithDeadline(
  timeoutMs = SIGN_IN_TIMEOUT_MS,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = combineSignals(controller.signal, init?.signal);
    return fetch(input, { ...init, signal }).finally(() => clearTimeout(timer));
  };
}
