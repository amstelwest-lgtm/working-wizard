/**
 * Cold-tab billing gate. Auth finishes before the firm row, so firmId is
 * null for the first 50ms. The check then resolves entitled at 200ms.
 * At 8.5s the page must still be the client file, not "Couldn't check billing".
 * Unmount clears the 8s timer.
 *
 * Run: pnpm test:strike7-gate
 */
import { Window } from "happy-dom";
import { STRIKE7_BEN_ID, STRIKE7_MY_PRACTICE_ID } from "./strike7-firms";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const dom = new Window({
  url: "http://127.0.0.1:5000/clients/second-file",
  width: 1280,
  height: 800,
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});

for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Element", "Document"] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: dom[key as keyof Window],
  });
}
Object.defineProperty(globalThis, "scrollTo", { configurable: true, writable: true, value: () => {} });
Object.defineProperty(globalThis, "self", { configurable: true, writable: true, value: dom });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

type Task = { id: number; at: number; delay: number; fn: () => void };

function installClock(target: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }) {
  const realSet = target.setTimeout.bind(target);
  const realClear = target.clearTimeout.bind(target);
  let now = 0;
  let seq = 1_000_000;
  const tasks: Task[] = [];
  let armed8s = 0;
  let cleared8s = 0;

  target.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const delay = Number(ms ?? 0);
    if (!Number.isFinite(delay) || delay < 40) return realSet(fn, delay, ...(args as []));
    const id = seq++;
    if (delay === 8_000) armed8s += 1;
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

  target.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    const index = tasks.findIndex((task) => task.id === (id as unknown as number));
    if (index >= 0) {
      if (tasks[index]?.delay === 8_000) cleared8s += 1;
      tasks.splice(index, 1);
      return;
    }
    realClear(id);
  }) as typeof clearTimeout;

  return {
    armed8s: () => armed8s,
    cleared8s: () => cleared8s,
    pending8s: () => tasks.filter((task) => task.delay === 8_000).length,
    async advance(ms: number, wrap?: (fn: () => void) => Promise<void>) {
      const targetAt = now + ms;
      while (true) {
        const next = tasks
          .filter((task) => task.at <= targetAt)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        now = next.at;
        const index = tasks.findIndex((task) => task.id === next.id);
        if (index >= 0) tasks.splice(index, 1);
        if (wrap) await wrap(next.fn);
        else next.fn();
      }
      now = targetAt;
    },
  };
}

const clock = installClock(window);

const warns: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  warns.push(args.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
  originalWarn(...args);
};

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { AuthGate, setFirmBillingGateCheckForTests } = await import("../src/routes/_authenticated.gate.tsx");
const { clearCachedFirmEntitlement } = await import("../src/lib/firm-entitlement-client.ts");
const { setStrike7FirmPick } = await import("@/contexts/accountant-profile");

async function fire(fn: () => void) {
  await act(async () => {
    fn();
  });
}

async function advance(ms: number) {
  await clock.advance(ms, fire);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function html() {
  return document.body.innerHTML;
}

const rootRoute = createRootRoute({
  component: () => createElement(AuthGate),
});
const clientRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clients/$clientId",
  component: () => createElement("p", null, "Client file"),
});
const router = createRouter({
  routeTree: rootRoute.addChildren([clientRoute]),
  history: createMemoryHistory({ initialEntries: ["/clients/second-file"] }),
  isServer: false,
} as never);

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
let routerLoaded = false;

async function mountGate() {
  if (!routerLoaded) {
    await router.load();
    routerLoaded = true;
  }
  (router as { isServer?: boolean }).isServer = false;
  (router as { _rendered?: unknown[] })._rendered = [];
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function unmountGate() {
  await act(async () => {
    root.render(createElement("div"));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function entitledAt200ms() {
  return new Promise<{ entitled: boolean; reason: string }>((resolve) => {
    window.setTimeout(() => resolve({ entitled: true, reason: "active_subscription" }), 200);
  });
}

const firms = [
  { name: "My practice", id: STRIKE7_MY_PRACTICE_ID, pick: "my-practice" as const },
  { name: "Ben", id: STRIKE7_BEN_ID, pick: "ben" as const },
];

for (const firm of firms) {
  warns.length = 0;
  clearCachedFirmEntitlement();
  setStrike7FirmPick(firm.pick);
  setFirmBillingGateCheckForTests(async () => entitledAt200ms());
  const armedBefore = clock.armed8s();
  await mountGate();
  assert(
    !html().includes("Couldn't check billing"),
    `${firm.name} must not show the billing card before the firm row loads`,
  );
  await advance(50);
  await advance(200);
  await advance(8_500);
  const body = html();
  assert(
    body.includes("Client file"),
    `${firm.name} (${firm.id}) should show the client file after the entitled check, saw ${body.slice(0, 240)}`,
  );
  assert(
    !body.includes("Couldn't check billing"),
    `${firm.name} (${firm.id}) showed Couldn't check billing after 8.5s`,
  );
  assert(
    !warns.some((line) => line.includes("[billing-gate] timeout")),
    `${firm.name} logged a billing timeout: ${warns.join(" | ")}`,
  );
  assert(
    clock.armed8s() - armedBefore === 1,
    `${firm.name} should arm the 8s timer once, after the firm id exists`,
  );
  await unmountGate();
  setFirmBillingGateCheckForTests(null);
}

warns.length = 0;
clearCachedFirmEntitlement();
setStrike7FirmPick("my-practice");
setFirmBillingGateCheckForTests(
  () => new Promise(() => {}),
);
const clearedBefore = clock.cleared8s();
await mountGate();
await advance(50);
assert(clock.pending8s() === 1, "the 8s timer is armed once the firm id exists");
await unmountGate();
assert(
  clock.cleared8s() > clearedBefore && clock.pending8s() === 0,
  "unmount clears the 8s timer",
);
await advance(8_500);
assert(!html().includes("Couldn't check billing"), "unmount must not leave the billing card");
assert(
  !warns.some((line) => line.includes("[billing-gate] timeout")),
  "unmount must not let the 8s timer log a timeout",
);

setFirmBillingGateCheckForTests(null);
clearCachedFirmEntitlement();
console.warn = originalWarn;
console.log("strike7 gate ok");
