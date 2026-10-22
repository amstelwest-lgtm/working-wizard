/**
 * One [boot-timing] line per page load, with no email.
 * Run: pnpm test:boot-timing
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import {
  bootMarketLabel,
  markAuthReady,
  markBootContent,
  resetBootTimingForTests,
} from "../src/lib/shell-gate";
import { BOOT_TIMING_EMAIL, BOOT_TIMING_USER_ID } from "./boot-timing-auth";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

type BootLine = { ms: number; market: string; route: string };

const infos: string[] = [];
const originalInfo = console.info;
console.info = (...args: unknown[]) => {
  const line = args
    .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
    .join(" ");
  if (line.includes("[boot-timing]")) infos.push(line);
  originalInfo(...args);
};

function bootLines(): BootLine[] {
  return infos.map((line) => JSON.parse(line.slice(line.indexOf("{"))) as BootLine);
}

function assertClean(line: string) {
  assert(!line.includes("@"), `boot line contains @: ${line}`);
  assert(!line.includes(BOOT_TIMING_EMAIL), `boot line contains the email: ${line}`);
  assert(!line.includes(BOOT_TIMING_USER_ID), `boot line contains the user id: ${line}`);
  const payload = JSON.parse(line.slice(line.indexOf("{")));
  const keys = Object.keys(payload);
  assert(
    keys.length === 3 && keys.every((key) => key === "ms" || key === "market" || key === "route"),
    `boot line keys ${keys.join(",")}`,
  );
  assert(payload.market === "za" || payload.market === "us" || payload.market === "unknown", payload.market);
  assert(typeof payload.ms === "number" && payload.ms >= 0, `ms ${payload.ms}`);
}

const failures: string[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`FAIL  ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

await check("market label is za, us, or unknown", () => {
  assert(bootMarketLabel({ country: "ZA", note: "ada@example.com" }) === "za", "ZA");
  assert(bootMarketLabel({ country: "US", regionCode: "NY" }) === "us", "US");
  assert(bootMarketLabel({ country: "GB" }) === "unknown", "other country");
  assert(bootMarketLabel(null) === "unknown", "null");
  assert(bootMarketLabel("ZA") === "unknown", "a bare string is not a market");
});

await check("one line per load and the line has no @", () => {
  resetBootTimingForTests();
  infos.length = 0;
  markAuthReady();
  markAuthReady();
  markBootContent("/clients/ada@example.com", "us");
  markBootContent("/app", "za");
  assert(infos.length === 1, `expected 1 boot line, saw ${infos.length}`);
  assert(infos[0].startsWith("[boot-timing]"), infos[0]);
  assertClean(infos[0]);
  const payload = bootLines()[0];
  assert(payload.market === "us", `market ${payload.market}`);
  assert(payload.route === "client", `route ${payload.route}`);
  assert(performance.getEntriesByName("auth-ready").length === 1, "auth-ready mark");
  assert(performance.getEntriesByName("first-content").length === 1, "first-content mark");
});

await check("owner content uses the same once-per-load line", () => {
  resetBootTimingForTests();
  infos.length = 0;
  markAuthReady();
  markBootContent("/app", "us");
  markBootContent("/app", "za");
  assert(infos.length === 1, `expected 1 owner line, saw ${infos.length}`);
  assertClean(infos[0]);
  assert(bootLines()[0].route === "owner", bootLines()[0].route);
  assert(bootLines()[0].market === "us", bootLines()[0].market);
});

await check("auth and both shells call the marks", () => {
  const auth = readFileSync(new URL("../src/hooks/use-auth.tsx", import.meta.url), "utf8");
  const gate = readFileSync(new URL("../src/routes/_authenticated.gate.tsx", import.meta.url), "utf8");
  const owner = readFileSync(new URL("../src/routes/app.tsx", import.meta.url), "utf8");
  assert(auth.includes("markAuthReady()"), "auth marks auth-ready");
  assert(gate.includes("markBootContent("), "the gate marks first content");
  assert(owner.includes('markBootContent("/app"'), "the owner shell marks first content");
});

const dom = new Window({
  url: "http://127.0.0.1:5000/dashboard",
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

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { AuthGate } = await import("../src/routes/_authenticated.gate.tsx");

const rootRoute = createRootRoute({
  component: () => createElement(AuthGate),
});
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: () => createElement("p", null, "Practice home"),
});
const router = createRouter({
  routeTree: rootRoute.addChildren([dashboardRoute]),
  history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
  isServer: false,
} as never);

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

await check("the gate logs one boot line when it releases the skeleton", async () => {
  resetBootTimingForTests();
  infos.length = 0;
  markAuthReady();
  await router.load();
  (router as { isServer?: boolean }).isServer = false;
  (router as { _rendered?: unknown[] })._rendered = [];
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  await flush();
  await flush();
  assert(document.body.innerHTML.includes("Practice home"), "the practice page should render");
  assert(infos.length === 1, `expected 1 gate boot line, saw ${infos.join(" | ")}`);
  assertClean(infos[0]);
  const payload = bootLines()[0];
  assert(payload.route === "practice", `route ${payload.route}`);
  assert(payload.market === "za", `market ${payload.market}`);
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  await flush();
  markBootContent("/dashboard", "us");
  assert(infos.length === 1, `a second paint logged again: ${infos.join(" | ")}`);
});

await check("market that resolves after the gate opens is za or us", async () => {
  const { setBootTimingFirmMarket } = await import("@/contexts/accountant-profile");
  resetBootTimingForTests();
  infos.length = 0;
  setBootTimingFirmMarket(null, { loaded: false, failed: false });
  markAuthReady();
  await act(async () => {
    root.render(createElement(RouterProvider, { key: "market-pending", router }));
  });
  await flush();
  await flush();
  assert(document.body.innerHTML.includes("Practice home"), "the practice page should render");
  assert(infos.length === 0, `boot line fired before the market resolved: ${infos.join(" | ")}`);
  const shell = performance.getEntriesByName("first-content")[0];
  assert(shell != null, "the shell stamps first-content before the market arrives");
  const shellMs = Math.max(0, Math.round(shell.startTime));
  await new Promise((resolve) => setTimeout(resolve, 80));
  setBootTimingFirmMarket({ country: "US", note: BOOT_TIMING_EMAIL }, { loaded: true });
  await act(async () => {
    root.render(createElement(RouterProvider, { key: "market-ready", router }));
  });
  await flush();
  await flush();
  assert(infos.length === 1, `expected 1 resolved boot line, saw ${infos.join(" | ")}`);
  assertClean(infos[0]);
  const payload = bootLines()[0];
  assert(payload.market === "za" || payload.market === "us", `market ${payload.market}`);
  assert(payload.market === "us", `market ${payload.market}`);
  assert(payload.route === "practice", `route ${payload.route}`);
  assert(payload.ms === shellMs, `ms ${payload.ms} is not the shell at ${shellMs}`);
  assert(
    performance.getEntriesByName("first-content")[0]?.startTime === shell.startTime,
    "first-content moved when the market arrived",
  );
  await act(async () => {
    root.render(createElement(RouterProvider, { key: "market-ready", router }));
  });
  await flush();
  assert(infos.length === 1, `a resolved market logged again: ${infos.join(" | ")}`);
  setBootTimingFirmMarket({ country: "ZA", note: BOOT_TIMING_EMAIL }, { loaded: false });
});

console.info = originalInfo;

if (failures.length) {
  console.error(`boot-timing: ${failures.length} failed`);
  process.exit(1);
}
console.log("boot-timing ok");
