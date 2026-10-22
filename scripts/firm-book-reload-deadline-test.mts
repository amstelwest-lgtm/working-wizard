/**
 * The firm-id book reload clears its 8s deadlines when figures land.
 * A fast load must not warn. A hung clients or figures read still warns at 8s.
 * A slow action_items read must not.
 * Run: pnpm test:firm-book-reload
 */
import { Window } from "happy-dom";
import { FIGURES_LOAD_ERROR } from "../src/lib/bounded-load";
import { forgetPaintedBook } from "../src/lib/practice-book-cache";
import { SHELL_GATE_TIMEOUT_MS } from "../src/lib/shell-gate";
import { FIRM_BOOK_USER_ID } from "./firm-book-reload-auth";
import { FIRM_BOOK_FIRM_ID, setFirmBookFirmId } from "./firm-book-reload-profile";
import {
  FIRM_BOOK_ACTION_DELAY_MS,
  releaseFirmBookFigures,
  setFirmBookClientsHang,
  setFirmBookFiguresHang,
  setFirmBookSlowActions,
} from "./firm-book-reload-supabase";
import { clientErrorReports, resetClientErrorReports } from "./firm-book-reload-monitoring";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const dom = new Window({
  url: "http://127.0.0.1:5000/practice",
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
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
}
class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
if (typeof globalThis.MutationObserver === "undefined") {
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
}
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(0), 16)) as typeof requestAnimationFrame;
}
if (typeof globalThis.cancelAnimationFrame !== "function") {
  globalThis.cancelAnimationFrame = ((id: number) => {
    window.clearTimeout(id);
  }) as typeof cancelAnimationFrame;
}
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (() => ({
    matches: false,
    media: "",
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  })) as typeof window.matchMedia;
}

type Task = { id: number; at: number; delay: number; fn: () => void };

function installClock(target: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }) {
  const realSet = target.setTimeout.bind(target);
  const realClear = target.clearTimeout.bind(target);
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

const clock = installClock(window);

const warns: string[] = [];
const errors: string[] = [];
const originalWarn = console.warn;
const originalError = console.error;
console.warn = (...args: unknown[]) => {
  warns.push(args.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
  originalWarn(...args);
};
console.error = (...args: unknown[]) => {
  errors.push(args.map((part) => (typeof part === "string" ? part : String(part))).join(" "));
  originalError(...args);
};

const CLIENT_WARNING = "[practice-board] client book timed out";
const RELOAD_WARNING = "[practice-board] firm book reload timed out";
const FOLLOW_UP_COUNT = "1 with open Action Plan work";

function reloadWarnings(): string[] {
  return warns.filter((line) => line.includes(RELOAD_WARNING));
}

function clientWarnings(): string[] {
  return warns.filter((line) => line.includes(CLIENT_WARNING));
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

function resetSignals() {
  warns.length = 0;
  errors.length = 0;
  resetClientErrorReports();
  forgetPaintedBook(FIRM_BOOK_USER_ID, FIRM_BOOK_FIRM_ID);
}

function reloadReports(): string[] {
  return clientErrorReports.filter((line) => line.includes("practice book reload timed out"));
}

const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    failures.push(`${name}: ${message}`);
    console.error(`FAIL  ${name}: ${message}`);
  }
}

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Outlet, createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { PracticeBoard } = await import("../src/components/practice-board.tsx");
const { AnalyticsProvider } = await import("../src/contexts/analytics.tsx");
const { NotesProvider } = await import("../src/contexts/notes.tsx");

function PracticeHarness() {
  return createElement(
    AnalyticsProvider,
    null,
    createElement(NotesProvider, { previewNotes: [] }, createElement(PracticeBoard, { view: "practice" })),
  );
}

const rootRoute = createRootRoute({
  component: () => createElement(Outlet),
});
const practiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice",
  component: PracticeHarness,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([practiceRoute]),
  history: createMemoryHistory({ initialEntries: ["/practice"] }),
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

async function mount() {
  await router.load();
  (router as { isServer?: boolean }).isServer = false;
  (router as { _rendered?: unknown[] })._rendered = [];
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  await flush();
  await flush();
  await flush();
}

async function advance(ms: number) {
  await clock.advance(ms, async (fn) => {
    await act(async () => {
      fn();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
  await flush();
}

function timedOut(): string | null {
  return document.body.querySelector("[data-book-timed-out]")?.getAttribute("data-book-timed-out") ?? null;
}

async function rerender(key: string) {
  (router as { isServer?: boolean }).isServer = false;
  (router as { _rendered?: unknown[] })._rendered = [];
  await act(async () => {
    root.render(createElement(RouterProvider, { key, router }));
  });
  await flush();
  await flush();
  await flush();
}

await check("a load that resolves at once does not warn after 8s", async () => {
  resetSignals();
  setFirmBookFirmId(FIRM_BOOK_FIRM_ID);
  setFirmBookClientsHang(false);
  await mount();
  assert(timedOut() === "false", `bookTimedOut before the deadline: ${timedOut()} html ${document.body.innerHTML.slice(0, 240)}`);
  await advance(SHELL_GATE_TIMEOUT_MS);
  assert(reloadWarnings().length === 0, `fast load warned: ${reloadWarnings().join(" | ")} errors ${errors.slice(0, 4).join(" | ")}`);
  assert(reloadReports().length === 0, `fast load reported: ${reloadReports().join(" | ")}`);
  assert(clientErrorReports.length === 0, `fast load sent an error report: ${clientErrorReports.join(" | ")}`);
  assert(timedOut() === "false", `bookTimedOut after a fast load: ${timedOut()}`);
});

await check("a hung firm reload still warns at 8s", async () => {
  resetSignals();
  await act(async () => {
    setFirmBookFirmId(FIRM_BOOK_FIRM_ID);
  });
  setFirmBookClientsHang(true);
  await rerender("hung-book");
  await advance(SHELL_GATE_TIMEOUT_MS - 1);
  assert(reloadWarnings().length === 0, `warned before 8s: ${reloadWarnings().join(" | ")}`);
  assert(timedOut() === "false", `bookTimedOut before 8s: ${timedOut()}`);
  await advance(1);
  assert(reloadWarnings().length === 1, `hung load warnings: ${warns.join(" | ")} errors ${errors.slice(0, 6).join(" | ")}`);
  assert(reloadReports().length === 1, `hung load reports: ${clientErrorReports.join(" | ")}`);
  assert(timedOut() === "true", `bookTimedOut after a hang: ${timedOut()}`);
});

function bookProblems(when: string, text: string): string[] {
  const problems: string[] = [];
  if (warns.length) problems.push(`warnings: ${warns.join(" | ")}`);
  if (clientErrorReports.length) problems.push(`sentry: ${clientErrorReports.join(" | ")}`);
  if (text.includes(FIGURES_LOAD_ERROR)) problems.push("figures error shown");
  if (!text.includes("2 clients need attention.")) problems.push("figures not shown");
  if (timedOut() !== "false") problems.push(`bookTimedOut=${timedOut()}`);
  if (errors.some((line) => /practice book|figures/i.test(line))) {
    problems.push(`console error: ${errors.slice(0, 4).join(" | ")}`);
  }
  return problems.map((problem) => `${when}: ${problem}`);
}

await check("slow action_items does not fail figures after the firm id arrives", async () => {
  resetSignals();
  setFirmBookSlowActions(FIRM_BOOK_ACTION_DELAY_MS);
  await act(async () => {
    setFirmBookFirmId(null);
  });
  await rerender("slow-actions");
  await act(async () => {
    setFirmBookFirmId(FIRM_BOOK_FIRM_ID);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await flush();
  await flush();
  await flush();
  const problems: string[] = [];
  await advance(SHELL_GATE_TIMEOUT_MS);
  const atEight = bodyText();
  problems.push(...bookProblems("+8s", atEight));
  if (atEight.includes(FOLLOW_UP_COUNT)) problems.push("+8s: follow-ups appeared before action_items");
  await advance(FIRM_BOOK_ACTION_DELAY_MS - SHELL_GATE_TIMEOUT_MS + 1_000);
  const atTwelve = bodyText();
  problems.push(...bookProblems("+12s", atTwelve));
  if (!atTwelve.includes(FOLLOW_UP_COUNT)) problems.push("+12s: follow-up count missing");
  assert(problems.length === 0, problems.join("\n"));
});

await check("a hung figures read shows the error at 8s and clears when figures land", async () => {
  resetSignals();
  await act(async () => {
    setFirmBookFirmId(FIRM_BOOK_FIRM_ID);
  });
  setFirmBookFiguresHang();
  await rerender("hung-figures");
  await advance(SHELL_GATE_TIMEOUT_MS - 1);
  assert(!bodyText().includes(FIGURES_LOAD_ERROR), `figures error before 8s: ${bodyText().slice(0, 240)}`);
  assert(reloadWarnings().length === 0, `firm warning before 8s: ${reloadWarnings().join(" | ")}`);
  assert(clientWarnings().length === 0, `client warning before 8s: ${clientWarnings().join(" | ")}`);
  assert(timedOut() === "false", `bookTimedOut before 8s: ${timedOut()}`);
  await advance(1);
  assert(bodyText().includes(FIGURES_LOAD_ERROR), `missing figures error at 8s: ${bodyText().slice(0, 320)}`);
  assert(reloadWarnings().length === 1, `hung figures firm warnings: ${warns.join(" | ")}`);
  assert(clientWarnings().length === 1, `hung figures client warnings: ${warns.join(" | ")}`);
  assert(reloadReports().length === 1, `hung figures firm reports: ${clientErrorReports.join(" | ")}`);
  assert(timedOut() === "true", `bookTimedOut after figures hang: ${timedOut()}`);
  await act(async () => {
    releaseFirmBookFigures();
  });
  await flush();
  await flush();
  await flush();
  assert(!bodyText().includes(FIGURES_LOAD_ERROR), `figures error stuck after the read landed: ${bodyText().slice(0, 320)}`);
  assert(bodyText().includes("2 clients need attention."), `figures missing after the read landed: ${bodyText().slice(0, 320)}`);
  assert(timedOut() === "false", `bookTimedOut after figures landed: ${timedOut()}`);
  assert(reloadWarnings().length === 1, `figures landing warned again: ${warns.join(" | ")}`);
  assert(clientWarnings().length === 1, `figures landing warned again: ${warns.join(" | ")}`);
});

await act(async () => {
  root.unmount();
});

console.warn = originalWarn;
console.error = originalError;

if (failures.length) {
  console.error(`firm-book-reload: ${failures.length} failed`);
  process.exit(1);
}
console.log("firm-book-reload ok");
