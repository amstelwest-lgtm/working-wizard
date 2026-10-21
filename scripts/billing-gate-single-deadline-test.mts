/**
 * Billing wall, one deadline.
 * (a) A hung getFirmBillingEntitlement settles the gate by 8s.
 * (b) A hung getClaims rejects within 3s, and the gate handles that inside 8s.
 * (c) A stored entitled plan returns without awaiting the Stripe list.
 *
 * Run: pnpm test:billing-gate-single-deadline
 */
import { Window } from "happy-dom";
import type Stripe from "stripe";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
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

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;
process.env.STRIPE_SECRET_KEY ??= "sk_test_billing_gate_single_deadline";

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

function installClock(target: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }) {
  const realSet = target.setTimeout.bind(target);
  const realClear = target.clearTimeout.bind(target);
  let now = 0;
  let seq = 1_000_000;
  const tasks: Task[] = [];
  let shellDeadlines = 0;

  target.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const delay = Number(ms ?? 0);
    if (!Number.isFinite(delay) || delay < 500) return realSet(fn, delay, ...(args as []));
    const id = seq++;
    if (delay === 8_000) shellDeadlines += 1;
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
    shellDeadlines: () => shellDeadlines,
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

const windowClock = installClock(window);

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { AuthGate, setFirmBillingGateCheckForTests } = await import("../src/routes/_authenticated.gate.tsx");
const { clearCachedFirmEntitlement, noteFirmEntitlement } = await import(
  "../src/lib/firm-entitlement-client.ts"
);
const { BILLING_DEADLINE_USER_ID } = await import("./billing-deadline-auth.ts");
const { BILLING_DEADLINE_FIRM_ID } = await import("./billing-deadline-profile.ts");
const { setAuthGetClaimsForTests, requireSupabaseAuth } = await import(
  "../src/integrations/supabase/auth-middleware.ts"
);
const { setFirmBillingPlanReadForTests } = await import("../src/lib/firm-billing-plan.server.ts");
const { setStripeClientForTests } = await import("../src/lib/stripe.server.ts");
const { resolveFirmBillingEntitlement } = await import("../src/lib/stripe-checkout.functions.ts");

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function fire(fn: () => void) {
  await act(async () => {
    fn();
  });
}

function html() {
  return document.body.innerHTML;
}

function settledSurface(markup: string): "card" | "content" | "skeleton" {
  if (markup.includes("Couldn't check billing")) return "card";
  if (markup.includes("Client file")) return "content";
  return "skeleton";
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
});

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
  await flush();
  await flush();
}

async function unmountGate() {
  await act(async () => {
    root.render(createElement("div"));
  });
  await flush();
}

let calls = 0;

function hangCheck() {
  calls += 1;
  return new Promise(() => {});
}

await check("(a) no stored plan settles onto the card by 8s, once", async () => {
  calls = 0;
  clearCachedFirmEntitlement();
  setFirmBillingGateCheckForTests(async () => hangCheck() as never);
  const before = windowClock.shellDeadlines();
  try {
    await mountGate();
    assert(settledSurface(html()) === "skeleton", `a hung check starts on the skeleton, saw ${settledSurface(html())}`);
    await windowClock.advance(8_500, fire);
    const atDeadline = settledSurface(html());
    assert(
      atDeadline === "card",
      `a hung check must show Couldn't check billing by 8.5s, saw ${atDeadline}`,
    );
    await windowClock.advance(15_500, fire);
    assert(settledSurface(html()) === "card", "the card stays after a second 8s would have fired");
    assert(
      windowClock.shellDeadlines() - before === 1,
      `the gate armed ${windowClock.shellDeadlines() - before} shell deadlines; only one 8s deadline is allowed`,
    );
    assert(calls === 1, `the hung check ran ${calls} times; a second quiet deadline must not retry it`);
  } finally {
    await unmountGate();
    setFirmBillingGateCheckForTests(null);
    clearCachedFirmEntitlement();
  }
});

await check("(a) stored plan opens by 8s with no second quiet deadline", async () => {
  calls = 0;
  clearCachedFirmEntitlement();
  // A failed recheck keeps the tab's last entitled plan without filling the
  // fresh cache, so the server fn still has to run.
  noteFirmEntitlement(
    BILLING_DEADLINE_USER_ID,
    { entitled: true, reason: "active_subscription", checkFailed: "timeout" },
    BILLING_DEADLINE_FIRM_ID,
  );
  setFirmBillingGateCheckForTests(async () => hangCheck() as never);
  const before = windowClock.shellDeadlines();
  try {
    await mountGate();
    assert(calls === 1, "the hung server fn is the check the deadline is waiting on");
    await windowClock.advance(8_500, fire);
    const atDeadline = settledSurface(html());
    assert(
      atDeadline === "content" || atDeadline === "card",
      `a hung check must settle by 8.5s, saw ${atDeadline}`,
    );
    assert(atDeadline !== "skeleton", "the gate must not sit on a skeleton past 8.5s");
    await windowClock.advance(15_500, fire);
    assert(
      windowClock.shellDeadlines() - before === 1,
      `the gate armed ${windowClock.shellDeadlines() - before} shell deadlines after a stored plan; no second quiet deadline`,
    );
  } finally {
    await unmountGate();
    setFirmBillingGateCheckForTests(null);
    clearCachedFirmEntitlement();
  }
});

await check("(b) the gate handles an auth-timeout inside the 8s budget", async () => {
  clearCachedFirmEntitlement();
  setFirmBillingGateCheckForTests(async () => {
    throw new Error("auth-timeout");
  });
  const before = windowClock.shellDeadlines();
  try {
    await mountGate();
    await flush();
    const surface = settledSurface(html());
    assert(
      surface === "card",
      `an auth-timeout must show Couldn't check billing without waiting out 8s, saw ${surface}`,
    );
    await windowClock.advance(8_500, fire);
    assert(
      windowClock.shellDeadlines() - before <= 1,
      "an auth-timeout must not arm a second quiet deadline",
    );
    assert(settledSurface(html()) === "card", "the auth-timeout card is still up at 8.5s");
  } finally {
    await unmountGate();
    setFirmBillingGateCheckForTests(null);
    clearCachedFirmEntitlement();
  }
});

function withRequest<T>(authorization: string, run: () => Promise<T>): Promise<T> {
  const request = new Request("https://milon.test/fn", {
    headers: { authorization },
  });
  const storage = (
    globalThis as typeof globalThis & {
      [key: symbol]: { run: <R>(store: unknown, fn: () => R) => R };
    }
  )[Symbol.for("tanstack-start:event-storage")];
  assert(Boolean(storage?.run), "tanstack request storage is installed");
  return storage.run({ h3Event: { req: request } }, run);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof Response !== "undefined" && error instanceof Response) return `status ${error.status}`;
  return String(error);
}

await check("(b) hung getClaims rejects within 3s before the handler", async () => {
  const server = (requireSupabaseAuth as { options?: { server?: (ctx: unknown) => Promise<unknown> } }).options
    ?.server;
  assert(typeof server === "function", "requireSupabaseAuth exposes its server function");
  const globalClock = installClock(globalThis);
  let handlerRan = false;
  let settled: { error: unknown } | { value: unknown } | null = null;
  setAuthGetClaimsForTests(() => new Promise(() => {}));
  const run = withRequest("Bearer token", () =>
    server({
      data: { refresh: true, firmId: BILLING_DEADLINE_FIRM_ID },
      next: async () => {
        handlerRan = true;
        return resolveFirmBillingEntitlement(
          { userId: BILLING_DEADLINE_USER_ID, claims: { email: "ben@example.com" }, supabase: null },
          true,
          BILLING_DEADLINE_FIRM_ID,
        );
      },
    }),
  );
  void run.then(
    (value) => {
      settled = { value };
    },
    (error) => {
      settled = { error };
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  await globalClock.advance(2_999);
  assert(settled === null, "a hung getClaims must still be in flight just before 3s");
  await globalClock.advance(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(settled !== null, "a hung getClaims must reject or settle by 3s");
  const settledError = settled && "error" in settled ? settled.error : null;
  assert(settledError != null, "a hung getClaims must reject rather than return a plan");
  assert(
    errorText(settledError).toLowerCase().includes("auth-timeout"),
    `the rejection must be a clear auth-timeout, saw ${errorText(settledError)}`,
  );
  assert(handlerRan === false, "the entitlement handler must not run after the auth timeout");
  setAuthGetClaimsForTests(null);
});

const USER = BILLING_DEADLINE_USER_ID;
const FIRM = BILLING_DEADLINE_FIRM_ID;

function firmSupabase() {
  const row = { id: FIRM, owner_user_id: USER };
  return {
    auth: {
      getUser: async () => ({ data: { user: { email: "ben@example.com" } } }),
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return { limit: async () => ({ data: [row] }) };
            },
          };
        },
      };
    },
  };
}

function billingActor(email: string) {
  return { userId: USER, claims: { email }, supabase: firmSupabase() };
}

await check("(c) stored entitled plan returns before the Stripe list", async () => {
  let listStarted = false;
  let listSettled = false;
  let releaseList: (value: { data: unknown[] }) => void = () => {};
  const listPromise = new Promise<{ data: unknown[] }>((resolve) => {
    releaseList = (value) => {
      listSettled = true;
      resolve(value);
    };
  });
  setFirmBillingPlanReadForTests(async () => "entitled");
  setStripeClientForTests({
    customers: {
      list: async () => ({ data: [{ id: "cus_ben" }] }),
    },
    subscriptions: {
      list: () => {
        listStarted = true;
        return listPromise;
      },
    },
  } as unknown as Stripe);
  const pending = resolveFirmBillingEntitlement(billingActor("stored-entitled@example.com"), true, FIRM);
  let raced: { kind: "value"; value: { entitled?: boolean; reason?: string } } | { kind: "pending" } = {
    kind: "pending",
  };
  try {
    raced = await Promise.race([
      pending.then((value) => ({ kind: "value" as const, value })),
      new Promise<{ kind: "pending" }>((resolve) => setTimeout(() => resolve({ kind: "pending" }), 200)),
    ]);
    assert(raced.kind === "value", "a stored entitled plan must return without awaiting the Stripe list");
    if (raced.kind !== "value") return;
    assert(raced.value.entitled === true, "the stored plan answer is entitled");
    assert(raced.value.reason === "active_subscription", "paying firms stay entitled");
    for (let i = 0; i < 20 && !listStarted; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert(listStarted, "the Stripe refresh starts");
    assert(listSettled === false, "the handler returns while the Stripe list is still pending");
  } finally {
    releaseList({ data: [] });
    await Promise.race([pending.then(() => undefined, () => undefined), new Promise((r) => setTimeout(r, 500))]);
    setStripeClientForTests(null);
    setFirmBillingPlanReadForTests(null);
  }
});

await check("(c) no stored plan still awaits the live Stripe check", async () => {
  let releaseList: (value: { data: unknown[] }) => void = () => {};
  const listPromise = new Promise<{ data: unknown[] }>((resolve) => {
    releaseList = resolve;
  });
  setFirmBillingPlanReadForTests(async () => null);
  setStripeClientForTests({
    customers: {
      list: async () => ({ data: [{ id: "cus_none" }] }),
    },
    subscriptions: {
      list: () => listPromise,
    },
  } as unknown as Stripe);
  const pending = resolveFirmBillingEntitlement(billingActor("no-plan@example.com"), true, FIRM);
  try {
    const early = await Promise.race([
      pending.then(() => "value" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 150)),
    ]);
    assert(early === "pending", "a firm with no stored plan must not answer before the live check");
    releaseList({ data: [] });
    const value = await pending;
    assert(value.entitled === false, "no subscription and no stored plan stays unpaid");
    assert(value.reason === "no_active_subscription", "the live check still decides an unpaid firm");
  } finally {
    releaseList({ data: [] });
    await Promise.race([pending.then(() => undefined, () => undefined), new Promise((r) => setTimeout(r, 500))]);
    setStripeClientForTests(null);
    setFirmBillingPlanReadForTests(null);
  }
});

const unhandled: string[] = [];
process.on("unhandledRejection", (reason) => {
  unhandled.push(reason instanceof Error ? reason.message : String(reason));
});

await check("(c) a failed Stripe refresh does not reject the stored plan", async () => {
  setFirmBillingPlanReadForTests(async () => "entitled");
  setStripeClientForTests({
    customers: {
      list: async () => ({ data: [{ id: "cus_refresh" }] }),
    },
    subscriptions: {
      list: async () => {
        throw new Error("stripe down");
      },
    },
  } as unknown as Stripe);
  try {
    const value = await resolveFirmBillingEntitlement(billingActor("refresh-fail@example.com"), true, FIRM);
    assert(value.entitled === true, "a stored entitled plan stays entitled when Stripe throws");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(
      unhandled.length === 0,
      `the Stripe refresh must be caught, unhandled: ${unhandled.join("; ")}`,
    );
  } finally {
    setStripeClientForTests(null);
    setFirmBillingPlanReadForTests(null);
  }
});

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nbilling-gate-single-deadline ok");
