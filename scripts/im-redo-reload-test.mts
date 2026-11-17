/**
 * A redo survives reload, discard restores the saved plan, and retired
 * interviews stay listed. The draft JSON is the real row shape.
 * Run: pnpm test:im-redo-reload
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { interviewDraftFromRuleText } from "../src/lib/firm-interview-draft.ts";
import { classifyPracticeStep } from "../src/lib/setup-partner-plan.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InterviewExchange } from "../src/components/interview-exchange.tsx";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const question = "What should the redo ask next?";
const answer = "We close on the fifth.";
const savedAnswer = "The partner signs in the thread.";
const raw = JSON.stringify({
  messages: [
    { role: "assistant", content: question },
    { role: "user", content: answer },
    { role: "assistant", content: question },
  ],
  question,
  modelTurns: 2,
  sessionId: "sess-redo-1",
  savedAt: "2026-11-17T12:00:00.000Z",
  sessionKind: "redo",
});
const redoDraft = interviewDraftFromRuleText(raw);
assert(redoDraft?.sessionKind === "redo", "the stored row keeps sessionKind redo");
assert(redoDraft?.messages.some((message) => message.content === question), "the live question is already in the transcript");

const retired = interviewDraftFromRuleText(
  JSON.stringify({
    messages: [
      { role: "assistant", content: "How does sign-off work?" },
      { role: "user", content: savedAnswer },
    ],
    question: "How does sign-off work?",
    modelTurns: 1,
    sessionId: "sess-saved-1",
    savedAt: "2026-11-13T08:00:00.000Z",
  }),
);
assert(retired != null, "the retired transcript parses");

const thinking = renderToStaticMarkup(
  createElement(InterviewExchange, { question: "", thinking: true, questionIndex: 1 }),
);
assert(!thinking.includes("Question 1"), "thinking does not keep the previous question number");
assert(thinking.includes("Implementation Manager is thinking"), "the thinking line stays");

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

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } =
  await import("@tanstack/react-router");
const { PracticeSetupInterview } = await import("../src/components/practice-setup-panel.tsx");

const savedStep = classifyPracticeStep("Who signs the pack");

async function mount(draft: unknown, discardRedo?: (firmId: string) => Promise<void>) {
  const rootRoute = createRootRoute({ component: () => createElement(Outlet) });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () =>
      createElement(PracticeSetupInterview, {
        firmId: "firm-1",
        firmMarket: { country: "ZA" },
        firmsReady: true,
        loadSaved: async () => ({ steps: [savedStep] }),
        loadDraft: async () => draft,
        askTurn: async () => ({ question, done: false, modelTurns: 2 }),
        buildMap: async () => {
          throw new Error("no map");
        },
        confirmMap: async () => {
          throw new Error("no confirm");
        },
        discardRedo,
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
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (node) => (node.textContent ?? "").replace(/\s+/g, " ").trim() === label,
  );
}

const withoutFlag = interviewDraftFromRuleText(
  JSON.stringify({
    messages: [
      { role: "assistant", content: question },
      { role: "user", content: answer },
      { role: "assistant", content: question },
    ],
    question,
    modelTurns: 2,
    sessionId: "sess-redo-plain",
    savedAt: "2026-11-17T12:00:00.000Z",
  }),
);
assert(withoutFlag != null && withoutFlag.sessionKind !== "redo", "an older redo row has no flag");

let discarded = false;
const plain = await mount(withoutFlag);
assert(document.querySelector("[data-im-status]")?.textContent?.trim() === "Redo in progress", "a draft beside a saved plan is a redo");
assert(button("Discard redo, keep saved plan")?.tagName === "BUTTON", "discard is there without a redo flag");
await plain.unmount();

const redo = await mount(redoDraft, async () => {
  discarded = true;
});
assert(document.querySelector("[data-im-status]")?.textContent?.trim() === "Redo in progress", "reload mid-redo stays a redo");
assert(button("Discard redo, keep saved plan")?.tagName === "BUTTON", "discard is on the reloaded redo");
assert(document.body.textContent?.includes("Who signs the pack"), "the saved plan is still on the page");
await act(async () => {
  (button("Discard redo, keep saved plan") as { click?: () => void } | undefined)?.click?.();
});
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});
assert(discarded, "discard retires the draft");
assert(document.querySelector("[data-im-status]")?.textContent?.trim() === "Saved", "discard returns to the saved plan");
assert(!button("Discard redo, keep saved plan"), "discard leaves the saved screen");
assert(document.body.textContent?.includes("Who signs the pack"), "saved rules stay after discard");
await redo.unmount();

const saved = await mount({ messages: [], question: "", modelTurns: 0, past: [retired] });
const log = document.querySelector("[data-past-interviews]");
assert(log?.tagName === "DETAILS", "a retired transcript is listed on the saved plan");
assert(log?.textContent?.includes(savedAnswer), "the saved answer is in the log");
assert((log as { open?: boolean }).open === false, "the log starts collapsed");
assert(document.querySelector("[data-im-status]")?.textContent?.trim() === "Saved", "the saved plan is not an interview");
await saved.unmount();

const empty = await mount({
  messages: [],
  question: "",
  modelTurns: 0,
  past: [
    {
      messages: [{ role: "assistant", content: "Only a question." }],
      question: "Only a question.",
      modelTurns: 1,
    },
  ],
});
assert(!document.querySelector("[data-past-interviews]"), "a transcript with no answer is not an empty card");
await empty.unmount();

const edge = readFileSync("supabase/functions/setup-partner/index.ts", "utf8");
assert(edge.includes('action === "discard_redo"'), "discard goes through setup-partner");
const discardAt = edge.indexOf('action === "discard_redo"');
const discardBody = edge.slice(discardAt, discardAt + 500);
assert(discardBody.includes("retireFirmInterviewDraft"), "discard retires the draft");
assert(!discardBody.includes("retirePriorOnboarding"), "discard does not touch the saved rules");

console.log("im-redo-reload ok");
