/**
 * The Implementation Manager page the practice sees: no triage labels or JSON,
 * and past interviews stay a collapsed Q/A log.
 * Run: pnpm test:im-page-client-view
 */
import { Window } from "happy-dom";
import { classifyPracticeStep, type PracticePlanStep } from "../src/lib/setup-partner-plan.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const window = new Window({
  url: "http://127.0.0.1:5000/practice/setup",
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
Object.defineProperty(globalThis, "IntersectionObserver", {
  configurable: true,
  writable: true,
  value: IntersectionObserverStub,
});
if (!window.matchMedia) {
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
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } =
  await import("@tanstack/react-router");
const { PracticeSetupInterview } = await import("../src/components/practice-setup-panel.tsx");

function tagged(text: string, bucket: PracticePlanStep["bucket"]): PracticePlanStep {
  const base = classifyPracticeStep(text);
  return { ...base, step: text, bucket, dedupe_key: `${bucket}:${text}` };
}

const recordedAt = "2026-11-16T12:00:00.000Z";
const question = "How does sign-off work?";
const answer = "The partner signs in the thread.";
const live = "What happens the next morning?";

const rootRoute = createRootRoute({ component: () => createElement(Outlet) });
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () =>
    createElement(PracticeSetupInterview, {
      firmId: "firm-1",
      firmMarket: { country: "ZA" },
      loadSaved: async () => ({
        steps: [
          tagged("Who signs the pack", "client_setup"),
          tagged("Build the missing tax form", "product_gap"),
          tagged("A custom website for the firm", "bespoke"),
        ],
      }),
      loadDraft: async () => ({
        messages: [
          { role: "assistant" as const, content: question },
          { role: "user" as const, content: answer },
          { role: "assistant" as const, content: live },
        ],
        question: live,
        modelTurns: 2,
        recordedAt,
      }),
      askTurn: async () => ({ question: live, done: false, modelTurns: 2 }),
      buildMap: async () => {
        throw new Error("no map");
      },
      confirmMap: async () => {
        throw new Error("no confirm");
      },
    }),
});
const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute]),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
await router.load();
(router as { _rendered?: unknown[] })._rendered ??= [];

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
await act(async () => {
  root.render(createElement(RouterProvider, { router }));
});
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const text = document.body.textContent ?? "";
const html = host.innerHTML;
assert(text.includes("Who signs the pack"), "the client step is a next step");
assert(text.includes("Recommended next steps"), "next steps have a heading");
assert(!text.includes("Build the missing tax form"), "a product gap step is not on the page");
assert(!text.includes("custom website"), "a bespoke step is not on the page");
for (const label of ["Product gap", "Bespoke", "Client setup", "Already covered", "Locked cap"]) {
  assert(!text.includes(label), `client view hides ${label}`);
}
assert(!html.includes("<pre"), "client view does not render a JSON block");
assert(!text.includes("{"), "client view does not print JSON");
assert(document.querySelectorAll("h2.setup-partner__question").length === 1, "one question heading");
assert(document.querySelector("h2.setup-partner__question")?.textContent === live, "the heading is the live question");

const log = document.querySelector("[data-past-interviews]");
assert(log?.tagName === "DETAILS", "past interviews render when answers exist");
assert((log as { open?: boolean }).open === false, "past interviews start collapsed");
assert(log.querySelector("strong")?.textContent === question, "the past question is bold");
assert(log.querySelector(".setup-partner__log-a")?.textContent === answer, "the answer sits under the question");
const when = log.querySelector("time");
assert(
  when?.getAttribute("datetime") === recordedAt || when?.getAttribute("dateTime") === recordedAt,
  "the pair shows its date",
);
assert(when?.textContent === "16 Nov 2026", "the date is readable");
assert(!document.querySelector("[data-past-interviews][open]"), "the details element is not open");

await act(async () => {
  root.unmount();
});

console.log("im-page-client-view ok");
