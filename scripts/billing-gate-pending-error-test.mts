/**
 * The billing gate must not show "Couldn't check billing" while the first
 * entitlement read is still pending.
 * Run: pnpm test:billing-gate-pending-error
 */
import { Window } from "happy-dom";

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

  target.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
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

  target.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    const index = tasks.findIndex((task) => task.id === (id as unknown as number));
    if (index >= 0) {
      tasks.splice(index, 1);
      return;
    }
    realClear(id);
  }) as typeof clearTimeout;

  return {
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

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { AuthGate, setFirmBillingGateCheckForTests } = await import("../src/routes/_authenticated.gate.tsx");
const { clearCachedFirmEntitlement } = await import("../src/lib/firm-entitlement-client.ts");
const { setStrike7FirmDelay, setStrike7FirmPick } = await import("@/contexts/accountant-profile");

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

async function mountGate() {
  await router.load();
  (router as { isServer?: boolean }).isServer = false;
  (router as { _rendered?: unknown[] })._rendered = [];
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

clearCachedFirmEntitlement();
setStrike7FirmPick("my-practice");
setStrike7FirmDelay(9_000);
setFirmBillingGateCheckForTests(() => new Promise(() => {}));

await mountGate();
await advance(8_500);
assert(
  !html().includes("Couldn't check billing"),
  "initial firm load must not flash the billing error before the check can start",
);

clearCachedFirmEntitlement();
setStrike7FirmDelay(50);
setFirmBillingGateCheckForTests(async () => {
  throw new Error("auth-timeout");
});
await act(async () => {
  root.render(createElement("div"));
});
document.body.replaceChildren(host);
await mountGate();
await advance(100);
assert(html().includes("Couldn't check billing"), "a failed check shows the billing error");

clearCachedFirmEntitlement();
setFirmBillingGateCheckForTests(async () => ({
  entitled: true,
  reason: "active_subscription",
}));
await act(async () => {
  root.render(createElement("div"));
});
document.body.replaceChildren(host);
await mountGate();
await advance(200);
const settled = html();
assert(settled.includes("Client file"), `a successful check opens the file, saw ${settled.slice(0, 200)}`);
assert(!settled.includes("Couldn't check billing"), "a successful check does not flash the billing error");

setFirmBillingGateCheckForTests(null);
clearCachedFirmEntitlement();

console.log("billing-gate-pending-error ok");