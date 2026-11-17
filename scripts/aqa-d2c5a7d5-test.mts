/**
 * Accepted #969: data-request days at display and write, plan overdue/owner
 * select, and the unanswered interview shape.
 * Run: pnpm test:aqa-d2c5a7d5
 */
import { Window } from "happy-dom";
import { displayedDataRequestReason } from "../src/lib/data-requests.ts";
import { guardQuotedRatios } from "../src/lib/ratios.ts";
import { liveRecordForDraft } from "../src/lib/agent-draft-decision.ts";
import { planAutomation } from "../src/lib/action-plan-automation.ts";
import { countActionPlan, formatActionPlanCounts } from "../src/lib/action-plan-counts.ts";
import { ownerSelectOptions } from "../src/components/action-plan.tsx";
import { classifyPracticeStep, type PracticePlanStep } from "../src/lib/setup-partner-plan.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const PROD =
  "gross margin is 95.4%, creditor days are -248 days and inventory days are -93 days";

const title = guardQuotedRatios(PROD);
const reason = displayedDataRequestReason(PROD);
for (const shown of [title, reason]) {
  assert(!shown.includes("-248"), `display keeps -248: ${shown}`);
  assert(!shown.includes("-93"), `display keeps -93: ${shown}`);
  assert(shown.includes("95.4%"), `display keeps the margin: ${shown}`);
  assert(shown.includes("not enough data"), `display replaces the days: ${shown}`);
}
assert(displayedDataRequestReason("above the 45-day benchmark").includes("40-day benchmark"), "the benchmark rewrite stays");

const written = liveRecordForDraft({
  kind: "data_request_draft",
  title: PROD,
  detail: PROD,
  severity: "watch",
  clientId: "client-1",
  userId: "user-1",
  seat: "owner",
  firmId: "firm-1",
  findingId: "finding-1",
});
assert(written.ok, "the data request draft writes");
if (written.ok) {
  const row = written.record.row;
  for (const field of [String(row.title), String(row.reason)]) {
    assert(!field.includes("-248") && !field.includes("-93"), `write path stays dirty: ${field}`);
    assert(field.includes("not enough data"), `write path replaces the days: ${field}`);
  }
}

const DONE = "Done by Financial Manager · 27 Oct. See result.";
const today = "2026-11-17";
const items = [
  { id: "a", title: "Send the bank letter", ownerId: "e1", ownerName: "Sam", dueDate: "2026-10-01", status: "not_started", createdAt: "2026-09-01", pickupLabel: DONE },
  { id: "b", title: "File the VAT pack", ownerId: "e1", ownerName: "Sam", dueDate: "2026-10-02", status: "in_progress", createdAt: "2026-09-01", pickupLabel: DONE },
  { id: "c", title: "Call the supplier", ownerId: "e1", ownerName: "Sam", dueDate: "2026-10-03", status: "not_started", createdAt: "2026-09-01" },
];
const planned = planAutomation(items, [], today);
const overdueRows = planned.rows.filter((row) => row.overdue);
assert(overdueRows.map((row) => row.title).join("|") === "Call the supplier", `suggested overdue rows: ${overdueRows.map((row) => row.title).join("|")}`);
const summary = formatActionPlanCounts(countActionPlan(items, today));
assert(summary === "3 actions · 3 open, including 1 overdue", `summary names every overdue row: ${summary}`);

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
const { ActionPlanAutomation } = await import("../src/components/action-plan-automation.tsx");

const suggestHost = document.createElement("div");
document.body.appendChild(suggestHost);
const suggestRoot = createRoot(suggestHost);
await act(async () => {
  suggestRoot.render(
    createElement(ActionPlanAutomation, {
      rows: planned.rows,
      duplicates: planned.duplicates,
      contradictions: planned.contradictions,
      canEdit: false,
      onConfirm: () => {},
      onDrop: () => {},
    }),
  );
});
const suggested = suggestHost.textContent ?? "";
assert(suggested.includes("Overdue") && suggested.includes("Call the supplier"), `suggested block misses the open row: ${suggested}`);
assert(!suggested.includes("Send the bank letter"), "a finished bot run is not in Suggested");
assert(!suggested.includes("File the VAT pack"), "a finished bot run is not in Suggested");
await act(async () => {
  suggestRoot.unmount();
});

const agent = "agent:Financial Manager";
const selectHost = document.createElement("div");
document.body.appendChild(selectHost);
const selectRoot = createRoot(selectHost);
await act(async () => {
  selectRoot.render(
    createElement(
      "select",
      { value: agent, onChange: () => {} },
      ownerSelectOptions([{ id: "e1", name: "Sam" }], agent).map((option) =>
        createElement("option", { key: option.value || "all-owners", value: option.value }, option.label),
      ),
    ),
  );
});
const select = selectHost.querySelector("select");
assert(select?.value === agent, `owner select value is ${select?.value}`);
await act(async () => {
  selectRoot.unmount();
});

const { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } =
  await import("@tanstack/react-router");
const { PracticeSetupInterview } = await import("../src/components/practice-setup-panel.tsx");

function tagged(text: string): PracticePlanStep {
  const base = classifyPracticeStep(text);
  return { ...base, step: text, bucket: "client_setup", dedupe_key: `client_setup:${text}` };
}

const saved = async () => ({ steps: [tagged("Who signs the pack")] });

async function mountInterview(draft: {
  messages: { role: "assistant" | "user"; content: string }[];
  question: string;
  modelTurns: number;
}) {
  const rootRoute = createRootRoute({ component: () => createElement(Outlet) });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () =>
      createElement(PracticeSetupInterview, {
        firmId: "firm-1",
        firmMarket: { country: "ZA" },
        firmsReady: true,
        loadSaved: saved,
        loadDraft: async () => draft,
        askTurn: async () => ({ question: draft.question, done: false, modelTurns: draft.modelTurns }),
        buildMap: async () => {
          throw new Error("no map");
        },
        confirmMap: async () => {
          throw new Error("no confirm");
        },
        discardRedo: async () => {},
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
  return {
    host,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const opening = "What kinds of clients make up your practice book?";
const unanswered = await mountInterview({
  messages: [{ role: "assistant", content: opening }],
  question: opening,
  modelTurns: 1,
});
const unansweredText = unanswered.host.textContent ?? "";
assert(!unanswered.host.querySelector("[data-past-interviews]"), "zero answers render no past interviews");
assert(!unansweredText.includes("Past interviews"), "zero answers render no past-interviews heading");
assert(unansweredText.split(opening).length === 2, "the live question is not repeated");
assert(!unansweredText.includes("Redo interview"), "an open interview does not offer redo");
await unanswered.unmount();

const answeredQ = "How does sign-off work?";
const answered = await mountInterview({
  messages: [
    { role: "assistant", content: answeredQ },
    { role: "user", content: "The partner signs in the thread." },
  ],
  question: answeredQ,
  modelTurns: 1,
});
const log = answered.host.querySelector("[data-past-interviews]");
assert(log?.tagName === "DETAILS", "answered pairs render past interviews");
assert((log as { open?: boolean } | null)?.open === false, "past interviews start collapsed");
assert(log?.querySelector("summary")?.textContent?.includes("1 interview"), "the count is one interview");
assert((answered.host.textContent ?? "").includes("Redo interview"), "redo is on the saved idle screen");
await answered.unmount();

console.log("aqa-d2c5a7d5 ok");
