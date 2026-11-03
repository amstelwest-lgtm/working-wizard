/**
 * Send an agent: an agent click opens the mission step, the stored
 * report letter stays off the page, and each sent mission is a card.
 * Run: pnpm test:client-agent-send-ux
 */
import { Window } from "happy-dom";
import type { AgentSendRow } from "../src/lib/client-agent-send.functions";
import { missionsForAgent, type MissionKey, type SendAgentKey } from "../src/lib/client-agent-missions";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const window = new Window({
  url: "http://127.0.0.1:5000/clients/demo?section=send-agent",
  width: 1280,
  height: 900,
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
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
  "Element",
  "Node",
  "Document",
  "Event",
  "MouseEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "MutationObserver",
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

const LETTER = "Dear pietie, Thank you for your time today. Kind regards, the practice";

const send: AgentSendRow = {
  id: "send-1",
  expiresAt: "2026-11-17T00:00:00.000Z",
  revokedAt: null,
  consentAt: null,
  completedAt: "2026-11-04T00:00:00.000Z",
  reviewedAt: null,
  open: false,
  items: [],
  files: [],
  createdAt: "2026-11-03T08:00:00.000Z",
  agent: "financial_manager",
  missionKey: "collect_documents",
  missionTitle: "Collect documents",
  statusLabel: "Docs received",
  repliedAt: null,
  docsReceivedAt: "2026-11-04T00:00:00.000Z",
  firmNote: null,
  reportSummary: LETTER,
  sentBy: "accountant",
  openedAt: "2026-11-03T09:00:00.000Z",
  viewerIsSender: true,
  feed: [{ kind: "sent", at: "2026-11-03T08:00:00.000Z" }],
};

const { createElement, useState } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SendAgentCard } = await import("../src/components/send-agent-panel");

const calls = { open: 0, copy: 0, resend: 0, cancel: 0 };

function Harness() {
  const [agent, setAgent] = useState<SendAgentKey | null>(null);
  const [surface, setSurface] = useState<"pick" | "mission">("pick");
  const [missionKey, setMissionKey] = useState<MissionKey | null>(null);
  const missions = agent ? missionsForAgent(agent, "ZA") : [];
  return createElement(SendAgentCard, {
    country: "ZA",
    market: { locale: "en-ZA", timezone: "Africa/Johannesburg" },
    agents: ["financial_manager", "analyst", "advisor", "tax_specialist"],
    missions,
    agent,
    missionKey,
    firmNote: "",
    firstName: "",
    email: "",
    sends: [send],
    open: null,
    busy: false,
    ready: true,
    loaded: true,
    notice: null,
    surface,
    onAgent: (next: SendAgentKey) => {
      setAgent(next);
      setMissionKey(null);
      setSurface("mission");
    },
    onBack: () => setSurface("pick"),
    onMission: setMissionKey,
    onFirmNote: () => undefined,
    onFirstName: () => undefined,
    onEmail: () => undefined,
    onMint: () => undefined,
    onResend: () => {
      calls.resend += 1;
    },
    onRevoke: () => {
      calls.cancel += 1;
    },
    onOpenLink: () => {
      calls.open += 1;
    },
    linkFor: () => null,
    onCopyLink: () => {
      calls.copy += 1;
    },
    onReview: () => undefined,
    onOpenDocument: () => undefined,
  });
}

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
await act(async () => {
  root.render(createElement(Harness));
});

const text = () => document.body.textContent ?? "";
assert(!text().includes("Dear pietie"), "the report letter is not on the page");
assert(!text().includes("Kind regards"), "the letter close is not on the page");
assert(document.querySelector("[data-send-agent-step]")?.getAttribute("data-send-agent-step") === "pick", "the page opens on the picker");
assert(document.querySelector("[data-send-agent-picker]"), "the agent picker is on the first step");
assert(!document.querySelector("[data-send-mission]"), "missions are not under the picker");
const card = document.querySelector("[data-send-mission-card]");
assert(card instanceof HTMLElement, "the sent mission is a card");
assert(card?.querySelector("[data-send-mission-stage]")?.textContent === "Docs received", "the card shows the stage");
assert(card?.querySelector("[data-send-mission-sent]")?.textContent?.startsWith("Sent "), "the card shows the date sent");
assert(text().includes("Financial Manager"), "the card names the agent");
assert(text().includes("Collect documents"), "the card names the mission");

const agentButton = document.querySelector("[data-send-agent-picker] button");
assert(agentButton instanceof HTMLButtonElement, "an agent card is a button");
await act(async () => {
  agentButton.click();
});
assert(document.querySelector("[data-send-agent-step]")?.getAttribute("data-send-agent-step") === "mission", "clicking an agent opens the mission step");
assert(!document.querySelector("[data-send-agent-picker]"), "the picker is not on the mission step");
assert(document.querySelector("[data-send-mission]"), "mission options are on the next step");
assert(text().includes("Choose a mission"), "the step asks for a mission");
assert(text().includes("Collect documents"), "the agent's missions are listed");
assert(!text().includes("Choose who to send"), "the picker heading is not on the mission step");

const back = document.querySelector("[data-send-agent-back]");
assert(back instanceof HTMLButtonElement, "the mission step has a way back");
await act(async () => {
  back.click();
});
assert(document.querySelector("[data-send-agent-step]")?.getAttribute("data-send-agent-step") === "pick", "back returns to the picker");
assert(!document.querySelector("[data-send-mission]"), "leaving the step closes the missions");

const homeCard = document.querySelector("[data-send-mission-card]");
const actions = homeCard?.querySelector("button");
assert(actions instanceof HTMLButtonElement && actions.textContent === "Actions", "the card has an actions menu");
await act(async () => {
  actions.click();
});
const menu = document.querySelector("[data-send-mission-actions] [role='menu']");
assert(menu instanceof HTMLElement, "the menu opens");
const labels = [...menu.querySelectorAll("[role='menuitem']")].map((item) => item.textContent);
assert(labels.join("|") === "Open|Copy link|Resend|Cancel", "the menu is Open, Copy link, Resend, Cancel");

async function clickItem(name: string) {
  const item = [...document.querySelectorAll("[role='menuitem']")].find((node) => node.textContent === name);
  assert(item instanceof HTMLButtonElement, `${name} is a menu item`);
  await act(async () => {
    item.click();
  });
}

await clickItem("Open");
await act(async () => {
  actions.click();
});
await clickItem("Copy link");
await act(async () => {
  actions.click();
});
await clickItem("Resend");
await act(async () => {
  actions.click();
});
await clickItem("Cancel");
assert(calls.open === 1 && calls.copy === 1 && calls.resend === 1 && calls.cancel === 1, "each action calls its handler");
assert(!text().includes(LETTER), "opening the menu does not reveal the letter");

await act(async () => {
  root.unmount();
});
