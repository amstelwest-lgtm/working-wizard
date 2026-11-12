/**
 * Earlier answers must not survive a client switch or a fresh start.
 * Run: pnpm test:interview-history-reset
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const window = new Window({
  url: "http://127.0.0.1:5000/clients/client-a",
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
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "Node",
  "Event",
  "InputEvent",
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

const { createElement, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { SetupPartnerPanel } = await import("../src/components/setup-partner-panel.tsx");
const { PracticeSetupInterview } = await import("../src/components/practice-setup-panel.tsx");

const summary = {
  headline: "Books are in",
  ledger: {
    xero: { connected: false, sync_status: null, last_synced_at: null },
    qbo: { connected: false, sync_status: null, last_synced_at: null },
    sage: { connected: false, sync_status: null, last_synced_at: null },
  },
  signals: {
    period_label: null,
    revenue: null,
    messy_accounts: false,
    ar_aged_hint: false,
    ap_aged_hint: false,
    recon_lag_hint: false,
    invoice_cadence_hint: false,
  },
  bullets: [] as string[],
  no_ledger: false,
};
const secret = "Client A secret answer about payroll";

function ClientPage({ clientId }: { clientId: string }) {
  return createElement(SetupPartnerPanel, {
    clientId,
    loadSummary: async () => summary,
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function typeAnswer(text: string) {
  const box = document.querySelector("textarea");
  assert(box instanceof HTMLTextAreaElement, "the answer box is ready");
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    const tracker = (box as { _valueTracker?: { setValue: (value: string) => void } })._valueTracker;
    tracker?.setValue("");
    setValue?.call(box, text);
    box.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
await act(async () => {
  root.render(createElement(ClientPage, { clientId: "client-a" }));
});
await settle();
const start = [...document.querySelectorAll("button")].find((button) => button.textContent === "Start interview");
assert(start instanceof HTMLButtonElement, "the interview can start");
await act(async () => {
  start.click();
});
await typeAnswer(secret);
const next = [...document.querySelectorAll("button")].find((button) => button.textContent === "Next");
assert(next instanceof HTMLButtonElement && !next.disabled, "next accepts the answer");
await act(async () => {
  next.click();
});
assert(document.body.textContent?.includes(secret), "the answer is in Earlier answers");

await act(async () => {
  root.render(createElement(ClientPage, { clientId: "client-b" }));
});
await settle();
assert(!document.body.textContent?.includes(secret), "switching clients clears Earlier answers");
const restart = [...document.querySelectorAll("button")].find((button) => button.textContent === "Start interview");
assert(restart instanceof HTMLButtonElement, "the new client can start");
await act(async () => {
  restart.click();
});
assert(!document.body.textContent?.includes(secret), "starting again does not restore the previous answers");
await act(async () => {
  root.unmount();
});

const firmSecret = "Firm A WhatsApp sign-off answer";
function FirmPage() {
  const [firmId, setFirmId] = useState("firm-a");
  return createElement(
    "div",
    null,
    createElement(PracticeSetupInterview, {
      firmId,
      firmMarket: null,
      loadSaved: async () => null,
      loadDraft: async (current: string) =>
        current === "firm-a"
          ? {
              messages: [
                { role: "assistant" as const, content: "How does sign-off work?" },
                { role: "user" as const, content: firmSecret },
              ],
              question: "What happens the next morning?",
              modelTurns: 1,
            }
          : null,
      askTurn: async () => ({ question: "What is new for this firm?", done: false, modelTurns: 1 }),
      buildMap: async () => {
        throw new Error("no map");
      },
      confirmMap: async () => {
        throw new Error("no confirm");
      },
    }),
    createElement("button", { type: "button", onClick: () => setFirmId("firm-b") }, "Switch firm"),
  );
}

const firmHost = document.createElement("div");
document.body.appendChild(firmHost);
const firmRoot = createRoot(firmHost);
await act(async () => {
  firmRoot.render(createElement(FirmPage));
});
await settle();
assert(document.body.textContent?.includes(firmSecret), "the first firm shows its answer");
const switchFirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "Switch firm");
assert(switchFirm instanceof HTMLButtonElement, "the firm can be switched");
await act(async () => {
  switchFirm.click();
});
await settle();
assert(!document.body.textContent?.includes(firmSecret), "switching firms clears the interview");
await act(async () => {
  firmRoot.unmount();
});

const clientRoute = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const practicePanel = readFileSync("src/components/practice-setup-panel.tsx", "utf8");
const clientPanel = readFileSync("src/components/setup-partner-panel.tsx", "utf8");
assert(
  clientRoute.includes("<SetupPartnerPanel key={clientId} clientId={clientId} />"),
  "the client route remounts on clientId",
);
assert(practicePanel.includes('key={firmId ?? "no-firm"}'), "the practice page remounts on firmId");
assert(clientPanel.includes("setHistory([]);"), "load and start both clear the earlier answers");

console.log("interview-history-reset ok");
