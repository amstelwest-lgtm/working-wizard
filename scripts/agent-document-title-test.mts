/**
 * The browser tab follows the open agent.
 * Tax Specialist is the title only while that shell is on screen.
 * Run: pnpm test:agent-document-title
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import {
  AGENT_TITLE_BRAND,
  agentDocumentTitle,
  agentTitleBaseline,
  isAgentDocumentTitle,
  titleAfterAgentLeaves,
} from "../src/lib/agent-document-title.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
  }
}

eq(agentDocumentTitle("Financial Manager"), "Financial Manager — Milōn", "financial manager");
eq(agentDocumentTitle("Analyst"), "Analyst — Milōn", "analyst");
eq(agentDocumentTitle("Advisor"), "Advisor — Milōn", "advisor");
eq(agentDocumentTitle("Tax Specialist"), "Tax Specialist — Milōn", "tax specialist");
eq(agentDocumentTitle("  Financial Manager  "), "Financial Manager — Milōn", "trimmed name");
eq(agentDocumentTitle(null), AGENT_TITLE_BRAND, "unknown agent is the brand");
eq(agentDocumentTitle("   "), AGENT_TITLE_BRAND, "blank agent is the brand");
assert(isAgentDocumentTitle("Tax Specialist — Milōn"), "tax title is an agent title");
assert(!isAgentDocumentTitle("Clients — Milōn"), "a page title is not an agent title");
assert(!isAgentDocumentTitle("Milōn"), "the brand alone is not an agent title");
eq(
  agentTitleBaseline("Clients — Milōn"),
  "Clients — Milōn",
  "leaving an agent restores the page title",
);
eq(
  agentTitleBaseline("Tax Specialist — Milōn"),
  AGENT_TITLE_BRAND,
  "a leftover Tax title is not restored",
);
eq(agentTitleBaseline("  "), AGENT_TITLE_BRAND, "an empty tab falls back to the brand");
eq(
  titleAfterAgentLeaves(
    "Financial Manager — Milōn",
    "Financial Manager — Milōn",
    "Clients — Milōn",
  ),
  "Clients — Milōn",
  "unmount puts the page title back",
);
eq(
  titleAfterAgentLeaves("Tax Specialist — Milōn", "Practice — Milōn", "Clients — Milōn"),
  "Practice — Milōn",
  "a route that already set its title is left alone",
);

const page = readFileSync("src/components/client-agent-link-page.tsx", "utf8");
const stage = readFileSync("src/components/milon-team/agent-stage.tsx", "utf8");
const owner = readFileSync("src/components/owner-door/owner-chat.tsx", "utf8");
assert(
  page.includes("useAgentDocumentTitle(sendLinkTitleName(shownView))"),
  "the send link titles the agent that is open",
);
assert(
  stage.includes("useAgentDocumentTitle(stageAgentShortName(agent))"),
  "the accountant agent desk titles the open agent",
);
assert(
  owner.includes("useAgentDocumentTitle(short)"),
  "the owner agent chat titles the open agent",
);

const window = new Window({
  url: "http://127.0.0.1:5000/a/token",
  width: 1280,
  height: 800,
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Document",
  "DocumentFragment",
  "MutationObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getComputedStyle",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: window[key],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
class StubIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
Object.defineProperty(window, "IntersectionObserver", {
  configurable: true,
  writable: true,
  value: StubIntersectionObserver,
});
Object.defineProperty(globalThis, "IntersectionObserver", {
  configurable: true,
  writable: true,
  value: StubIntersectionObserver,
});

const { createElement, useState } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useAgentDocumentTitle } = await import("../src/hooks/use-agent-document-title.ts");
const { AgentStage } = await import("../src/components/milon-team/agent-stage.tsx");
const { OwnerChat } = await import("../src/components/owner-door/owner-chat.tsx");

function LinkTitle({ name }: { name: string | null }) {
  useAgentDocumentTitle(name);
  return createElement("h1", null, name ?? "Opening");
}

function Switcher() {
  const [name, setName] = useState<string | null>("Tax Specialist");
  return createElement(
    "div",
    null,
    createElement(LinkTitle, { name }),
    createElement(
      "button",
      {
        type: "button",
        onClick: () => setName("Financial Manager"),
      },
      "fm",
    ),
    createElement(
      "button",
      {
        type: "button",
        onClick: () => setName("Analyst"),
      },
      "analyst",
    ),
    createElement(
      "button",
      {
        type: "button",
        onClick: () => setName(null),
      },
      "clear",
    ),
  );
}

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);

document.title = "Tax Specialist — Milōn";
await act(async () => {
  root.render(createElement(LinkTitle, { name: null }));
});
eq(document.title, "Milōn", "opening a link clears a stuck Tax title before the agent is known");

await act(async () => {
  root.render(createElement(LinkTitle, { name: "Financial Manager" }));
});
eq(document.title, "Financial Manager — Milōn", "Financial Manager link sets the tab");

await act(async () => {
  root.render(createElement(LinkTitle, { name: "Tax Specialist" }));
});
eq(document.title, "Tax Specialist — Milōn", "Tax link sets the Tax Specialist tab");

await act(async () => {
  root.render(createElement(LinkTitle, { name: "Advisor" }));
});
eq(document.title, "Advisor — Milōn", "Advisor link sets the tab");

await act(async () => {
  root.unmount();
});
eq(document.title, "Milōn", "leaving the link does not leave Tax Specialist behind");

document.title = "Clients — Milōn";
const switchHost = document.createElement("div");
document.body.appendChild(switchHost);
const switchRoot = createRoot(switchHost);
await act(async () => {
  switchRoot.render(createElement(Switcher));
});
eq(document.title, "Tax Specialist — Milōn", "the first agent paints its own title");
await act(async () => {
  switchHost
    .querySelector("button")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
});
eq(document.title, "Financial Manager — Milōn", "switching off Tax updates the tab");
const buttons = switchHost.querySelectorAll("button");
await act(async () => {
  buttons[1]?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
});
eq(document.title, "Analyst — Milōn", "switching again updates the tab");
await act(async () => {
  buttons[2]?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
});
eq(document.title, "Milōn", "clearing the agent drops the agent title");
await act(async () => {
  switchRoot.unmount();
});
eq(document.title, "Clients — Milōn", "the desk restores the page title it replaced");

document.title = "Practice — Milōn";
const stageHost = document.createElement("div");
document.body.appendChild(stageHost);
const stageRoot = createRoot(stageHost);

function Stage({
  agent,
}: {
  agent: "financial_manager" | "analyst" | "advisor" | "tax_specialist";
}) {
  return createElement(AgentStage, {
    agent,
    finding: null,
    marketCountry: "ZA",
    audience: "accountant",
    taxTab: true,
    onSelect() {},
  });
}

await act(async () => {
  stageRoot.render(createElement(Stage, { agent: "tax_specialist" }));
});
eq(document.title, "Tax Specialist — Milōn", "accountant tax desk titles Tax Specialist");
await act(async () => {
  stageRoot.render(createElement(Stage, { agent: "financial_manager" }));
});
eq(document.title, "Financial Manager — Milōn", "accountant desk switches to Financial Manager");
await act(async () => {
  stageRoot.render(createElement(Stage, { agent: "analyst" }));
});
eq(document.title, "Analyst — Milōn", "accountant desk switches to Analyst");
await act(async () => {
  stageRoot.unmount();
});
eq(document.title, "Practice — Milōn", "leaving the accountant desk restores Practice");

document.title = "Home — Milōn";
const ownerHost = document.createElement("div");
document.body.appendChild(ownerHost);
const ownerRoot = createRoot(ownerHost);

function Owner({ agent }: { agent: "financial_manager" | "analyst" | "advisor" }) {
  return createElement(OwnerChat, {
    agent,
    variant: "character",
    motion: "idle",
    sentence: "Ask about the books.",
    messages: [],
    draft: "",
    listening: false,
    busy: false,
    error: null,
    market: { locale: "en-ZA", timezone: "Africa/Johannesburg" },
    onDraft() {},
    onSend() {},
    onListen() {},
    onBack() {},
  });
}

await act(async () => {
  ownerRoot.render(createElement(Owner, { agent: "financial_manager" }));
});
eq(document.title, "Financial Manager — Milōn", "owner chat titles the Financial Manager");
await act(async () => {
  ownerRoot.render(createElement(Owner, { agent: "advisor" }));
});
eq(document.title, "Advisor — Milōn", "owner chat switches to the Advisor");
await act(async () => {
  ownerRoot.unmount();
});
eq(document.title, "Home — Milōn", "leaving owner chat restores Home");

console.log("agent document title ok");
