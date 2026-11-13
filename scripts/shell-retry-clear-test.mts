/**
 * The shell Retry timer is cleared once the gate chunk resolves, so it
 * cannot flash after the gate is on screen.
 * Run: pnpm test:shell-retry-clear
 */
import { Window } from "happy-dom";
import { createElement } from "react";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const dom = new Window({
  url: "http://127.0.0.1:5000/practice/setup",
  width: 1280,
  height: 800,
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});

for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Element", "Document"] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: dom[key as keyof Window],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

type Task = { id: number; at: number; delay: number; fn: () => void };

function installClock() {
  const realSet = globalThis.setTimeout.bind(globalThis);
  const realClear = globalThis.clearTimeout.bind(globalThis);
  let now = 0;
  let seq = 1_000_000;
  const tasks: Task[] = [];
  const patchedSet = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const delay = Number(ms ?? 0);
    if (!Number.isFinite(delay) || delay < 40) return realSet(fn, delay, ...(args as []));
    const id = seq++;
    tasks.push({
      id,
      at: now + delay,
      delay,
      fn: () => {
        if (typeof fn === "function") fn(...(args as []));
      },
    });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const patchedClear = ((id: ReturnType<typeof setTimeout>) => {
    const index = tasks.findIndex((task) => task.id === (id as unknown as number));
    if (index >= 0) {
      tasks.splice(index, 1);
      return;
    }
    realClear(id);
  }) as typeof clearTimeout;
  globalThis.setTimeout = patchedSet;
  globalThis.clearTimeout = patchedClear;
  window.setTimeout = patchedSet;
  window.clearTimeout = patchedClear;
  return {
    pending8s: () => tasks.filter((task) => task.delay === 8_000).length,
    async advance(ms: number, wrap: (fn: () => void) => Promise<void>) {
      const targetAt = now + ms;
      while (true) {
        const next = tasks
          .filter((task) => task.at <= targetAt)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        now = next.at;
        const index = tasks.findIndex((task) => task.id === next.id);
        if (index >= 0) tasks.splice(index, 1);
        await wrap(next.fn);
      }
      now = targetAt;
    },
  };
}

const clock = installClock();
const { act, createElement: reactCreate } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AppChromeReadyContext } = await import("../src/contexts/app-chrome-ready.tsx");
const { AuthenticatedShell, setAuthenticatedGateLoaderForTests } = await import(
  "../src/routes/_authenticated.tsx"
);

setAuthenticatedGateLoaderForTests(async () => ({
  AuthGate: () => reactCreate("p", { "data-gate": "ready" }, "Gate ready"),
}));

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);

await act(async () => {
  root.render(
    reactCreate(
      AppChromeReadyContext.Provider,
      { value: true },
      reactCreate(AuthenticatedShell),
    ),
  );
});
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

assert(document.body.innerHTML.includes('data-gate="ready"'), "the gate paints when its chunk resolves");
assert(!document.body.innerHTML.includes("data-shell-retry"), "Retry is not up when the gate resolves");
assert(clock.pending8s() === 0, "resolving the gate clears the shell timer");

await clock.advance(8_500, async (fn) => {
  await act(async () => {
    fn();
  });
});
assert(!document.body.innerHTML.includes("data-shell-retry"), "Retry does not flash after the gate has resolved");
assert(document.body.innerHTML.includes('data-gate="ready"'), "the resolved gate stays on screen");

setAuthenticatedGateLoaderForTests(null);
await act(async () => {
  root.render(createElement("div"));
});
console.log("shell-retry-clear ok");
