/**
 * A hung firm list must not leave a later client file on the skeleton.
 * One automatic retry, then the existing Retry card. The card calls
 * refreshFirms. A timed-out or thrown read does not stick in the in-flight cache.
 *
 * Run: pnpm test:firm-load-retry
 */
import { Window } from "happy-dom";
import { SHELL_GATE_TIMEOUT_MS } from "../src/lib/shell-gate";
import {
  FIRM_LOAD_SECOND_CLIENT_ID,
  FIRM_LOAD_USER_ID,
  firmReadCount,
  resetFirmReads,
  setFirmReadMode,
} from "@/integrations/supabase/client";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const RETRY_BACKOFF_MS = 1_000;
const FIRM_LOAD_DEADLINE_MS = SHELL_GATE_TIMEOUT_MS * 2 + RETRY_BACKOFF_MS;
const CLIENT_PATH = `/clients/${FIRM_LOAD_SECOND_CLIENT_ID}`;

const dom = new Window({
  url: `http://127.0.0.1:5000${CLIENT_PATH}`,
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

const clock = installClock();

const warns: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  warns.push(args.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
};

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const failures: string[] = [];

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${message}`);
    console.log(`FAIL  ${name}: ${message}`);
  }
}

const { readUserFirms } = await import("../src/lib/firm-brand");

const HANG_USER = "44444444-4444-4444-8444-444444444444";
const THROW_USER = "55555555-5555-4555-8555-555555555555";

await check("timed-out firms read settles and the next call is fresh", async () => {
  setFirmReadMode("hang");
  resetFirmReads();
  let settled = false;
  let error: string | null = null;
  void readUserFirms(HANG_USER).then(
    (result) => {
      settled = true;
      error = result.error;
    },
    () => {
      settled = true;
      error = "rejected";
    },
  );
  await clock.advance(SHELL_GATE_TIMEOUT_MS);
  await flush();
  assert(settled, "a firms read that never resolves must settle by 8s");
  assert(error === "timeout", `a hung read is a timeout, saw ${error}`);
  assert(firmReadCount() === 1, `first read counted once, saw ${firmReadCount()}`);
  void readUserFirms(HANG_USER);
  await flush();
  assert(
    firmReadCount() === 2,
    `a timed-out read poisoned the in-flight cache, reads=${firmReadCount()}`,
  );
});

await check("thrown firms read settles and the next call is fresh", async () => {
  setFirmReadMode("throw");
  resetFirmReads();
  let rejected = false;
  let error: string | null = null;
  try {
    const result = await readUserFirms(THROW_USER);
    error = result.error;
  } catch {
    rejected = true;
  }
  assert(!rejected, "a thrown firms read must settle as an error result");
  assert(Boolean(error) && error !== "timeout", `a thrown read is an error, saw ${error}`);
  const afterFirst = firmReadCount();
  await readUserFirms(THROW_USER);
  assert(
    firmReadCount() === afterFirst + 1,
    `a failed read poisoned the in-flight cache, reads=${firmReadCount()} after ${afterFirst}`,
  );
});

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { AuthGate, setFirmBillingGateCheckForTests } = await import("../src/routes/_authenticated.gate.tsx");
const { AccountantProfileProvider } = await import("../src/contexts/accountant-profile");

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

function firmLoadLines() {
  return warns.filter((line) => line.includes("[firm-load]"));
}

const rootRoute = createRootRoute({
  component: () => createElement(AccountantProfileProvider, null, createElement(AuthGate)),
});
const clientRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clients/$clientId",
  component: () => createElement("p", null, "Client file"),
});
const router = createRouter({
  routeTree: rootRoute.addChildren([clientRoute]),
  history: createMemoryHistory({ initialEntries: [CLIENT_PATH] }),
  isServer: false,
} as never);

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);

let billingChecks = 0;
setFirmBillingGateCheckForTests(async () => {
  billingChecks += 1;
  return { entitled: true, reason: "active_subscription" };
});

await check(`hung firm list on ${CLIENT_PATH} shows Retry by 17s`, async () => {
  setFirmReadMode("hang");
  resetFirmReads();
  warns.length = 0;
  billingChecks = 0;
  await router.load();
  (router as { isServer?: boolean }).isServer = false;
  (router as { _rendered?: unknown[] })._rendered = [];
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert(
    !html().includes("Couldn't check billing"),
    "Retry must not show before the firm read has failed",
  );
  await advance(FIRM_LOAD_DEADLINE_MS - 1_000);
  assert(
    !html().includes("Couldn't check billing"),
    "Retry must wait for the 8s read plus one retry",
  );
  assert(html().includes("Loading"), "the page stays on the skeleton until the retry settles");
  await advance(1_000);
  const body = html();
  assert(
    body.includes("Couldn't check billing") && body.includes("Retry"),
    `a hung firm list must show Retry by ${FIRM_LOAD_DEADLINE_MS}ms, saw ${body.slice(0, 280)}`,
  );
  assert(!body.includes("Client file"), "the client file must not render before the firm row loads");
  assert(billingChecks === 0, `billing ran before the firm row loaded (${billingChecks})`);
});

await check("exactly one automatic retry, then Retry", async () => {
  assert(firmReadCount() === 2, `expected 2 firm reads, saw ${firmReadCount()}`);
  const lines = firmLoadLines();
  assert(lines.length === 2, `expected 2 firm-load lines, saw ${lines.join(" | ")}`);
  assert(lines.some((line) => line.includes('"attempt":1')), `missing attempt 1: ${lines.join(" | ")}`);
  assert(lines.some((line) => line.includes('"attempt":2')), `missing attempt 2: ${lines.join(" | ")}`);
  assert(!lines.some((line) => line.includes('"attempt":3')), `a third attempt ran: ${lines.join(" | ")}`);
});

await check("firm-load breadcrumb has no email or user id", async () => {
  const lines = firmLoadLines();
  assert(lines.length > 0, "missing the firm-load breadcrumb");
  for (const line of lines) {
    assert(!line.includes("@"), `breadcrumb contains @: ${line}`);
    assert(!line.includes(FIRM_LOAD_USER_ID), `breadcrumb contains the user id: ${line}`);
    assert(!line.includes("ada@example.com"), `breadcrumb contains the email: ${line}`);
    const payload = JSON.parse(line.slice(line.indexOf("{")));
    const keys = Object.keys(payload);
    assert(
      keys.every((key) => key === "attempt" || key === "routeBucket" || key === "firmId"),
      `breadcrumb keys ${keys.join(",")}`,
    );
    assert(payload.routeBucket === "client", `route bucket should be client, saw ${payload.routeBucket}`);
    assert(payload.attempt === 1 || payload.attempt === 2, `attempt ${payload.attempt}`);
  }
  assert(
    lines.some((line) => line.startsWith("[firm-load] timeout")),
    `expected a timeout breadcrumb, saw ${lines.join(" | ")}`,
  );
});

await check("Retry recovers through the billing check", async () => {
  setFirmReadMode("ok");
  const button = document.querySelector("button");
  assert(button?.textContent?.includes("Retry") === true, "Retry button is missing");
  await act(async () => {
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  const body = html();
  assert(billingChecks >= 1, "Retry must let the gate run the billing check");
  assert(body.includes("Client file"), `the page should render after Retry, saw ${body.slice(0, 280)}`);
  assert(!body.includes("Couldn't check billing"), "Retry should leave the billing card");
  assert(firmReadCount() === 3, `recovery should be one fresh read, saw ${firmReadCount()}`);
});

setFirmBillingGateCheckForTests(null);
console.warn = originalWarn;

if (failures.length) {
  console.error(`firm-load-retry: ${failures.length} failed`);
  process.exit(1);
}
console.log("firm-load-retry ok");
