/**
 * When the trial-ended plan card cannot load plans, the thread still offers
 * the billing page the upgrade CTA already uses. No Retry.
 *
 * Accountant Analyst chat and Bot: /settings#firm-billing
 * Owner /app ask-ai: /app?screen=plan
 *
 * Run: pnpm test:ask-ai-trial-ended-billing
 */
import { Window } from "happy-dom";
import {
  STARTER_TRIAL_ENDED_CODE,
  STARTER_TRIAL_ENDED_MESSAGE,
} from "../src/lib/starter-trial-constants.ts";

const ACCOUNTANT_BILLING = "/settings#firm-billing";
const OWNER_BILLING = "/app?screen=plan";
const LOAD_FAILURE = "Plans could not be loaded. Refresh and try again.";
const BILLING_LABEL = "Plan & billing";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const window = new Window({
  url: "http://127.0.0.1:5000/clients/demo",
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
  "HTMLAnchorElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
  "Element",
  "Node",
  "Document",
  "Event",
  "CustomEvent",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "MutationObserver",
  "sessionStorage",
  "localStorage",
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

function failPlanDisplay(): Promise<never> {
  return Promise.reject(new Error("getFirmPlanDisplay failed"));
}

globalThis.fetch = failPlanDisplay;

const { createElement } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ChatTrialEndedPlan, TrialEndedPlanCard } =
  await import("../src/components/trial-ended-plan-block.tsx");
const { renderToStaticMarkup } = await import("react-dom/server");
const { mountAskAi } = await import("../src/lib/ask-ai.js");

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function until(host: ParentNode, predicate: () => boolean, label: string) {
  const started = Date.now();
  while (Date.now() - started < 3000) {
    await tick();
    if (predicate()) return;
  }
  throw new Error(`${label}\n${host instanceof Element ? host.innerHTML : ""}`);
}

function assertBillingLink(root: ParentNode, href: string, where: string) {
  const title = root.querySelector(".trial-ended-title");
  assert(
    title?.textContent === STARTER_TRIAL_ENDED_MESSAGE,
    `${where} shows the trial-ended title`,
  );
  assert(root.textContent?.includes(LOAD_FAILURE), `${where} keeps the load-failure note`);
  const link = root.querySelector("a.trial-ended-billing");
  assert(link instanceof HTMLAnchorElement, `${where} renders a billing link`);
  assert(link.getAttribute("href") === href, `${where} links to ${href}`);
  assert(link.textContent === BILLING_LABEL, `${where} labels the link Plan & billing`);
  assert(root.querySelector("button.ask-ai-retry") == null, `${where} has no Retry button`);
  assert(!root.textContent?.includes("Retry"), `${where} does not say Retry`);
  assert(root.querySelector(".ask-ai-error") == null, `${where} is not a red error`);
}

const accountantHost = document.createElement("div");
document.body.appendChild(accountantHost);
const accountantRoot = createRoot(accountantHost);
await act(async () => {
  accountantRoot.render(
    createElement(ChatTrialEndedPlan, {
      firmId: "11111111-1111-4111-8111-111111111111",
      audience: "accountant",
    }),
  );
});
await until(
  accountantHost,
  () => Boolean(accountantHost.textContent?.includes(LOAD_FAILURE)),
  "accountant plan load did not fail closed",
);
assertBillingLink(accountantHost, ACCOUNTANT_BILLING, "accountant getFirmPlanDisplay failure");
await act(async () => {
  accountantRoot.unmount();
});
accountantHost.remove();

const ownerHost = document.createElement("div");
document.body.appendChild(ownerHost);
const ownerRoot = createRoot(ownerHost);
await act(async () => {
  ownerRoot.render(
    createElement(ChatTrialEndedPlan, {
      firmId: "22222222-2222-4222-8222-222222222222",
      audience: "owner",
    }),
  );
});
await until(
  ownerHost,
  () => Boolean(ownerHost.textContent?.includes(LOAD_FAILURE)),
  "owner plan load did not fail closed",
);
assertBillingLink(ownerHost, OWNER_BILLING, "owner getFirmPlanDisplay failure");
await act(async () => {
  ownerRoot.unmount();
});
ownerHost.remove();

function trialEndedResponse() {
  return new Response(
    JSON.stringify({ error: STARTER_TRIAL_ENDED_MESSAGE, code: STARTER_TRIAL_ENDED_CODE }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
}

globalThis.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/ask-ai") || url.includes("/milon-bot")) return trialEndedResponse();
  return failPlanDisplay();
};

async function sendTrialEnded(audience: "accountant" | "owner") {
  const container = document.createElement("div");
  container.dataset.clientId = audience === "owner" ? "owner-client" : "analyst-client";
  container.dataset.firmId = "33333333-3333-4333-8333-333333333333";
  document.body.appendChild(container);
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    botEndpoint: "https://example.com/functions/v1/milon-bot",
    variant: "studio",
    audience,
    getToken: async () => "test-token",
    loadTrialChunk: () => Promise.reject(new Error("trial card chunk failed")),
  });
  const ta = container.querySelector("textarea");
  assert(ta instanceof HTMLTextAreaElement, `${audience} shell has a question box`);
  ta.value = "What is this client's health score?";
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  const button = container.querySelector("button.ask-ai-send");
  assert(button instanceof HTMLButtonElement, `${audience} shell has send`);
  button.click();
  const href = audience === "owner" ? OWNER_BILLING : ACCOUNTANT_BILLING;
  await until(
    container,
    () => Boolean(container.querySelector("[data-trial-ended='plan'] a.trial-ended-billing")),
    `${audience} chunk failure did not keep a billing link`,
  );
  const section = container.querySelector("[data-trial-ended='plan']");
  assert(section instanceof HTMLElement, `${audience} shell section stays when the chunk fails`);
  assert(
    section.className === "trial-ended-block",
    `${audience} shell is not replaced by the card`,
  );
  assertBillingLink(section, href, `${audience} chunk failure`);
  container.remove();
}

await sendTrialEnded("accountant");
await sendTrialEnded("owner");

const loaded = renderToStaticMarkup(
  createElement(TrialEndedPlanCard, {
    upgrade: {
      band: "starter",
      interval: "month",
      priceCurrency: "USD",
      canUpgrade: true,
      clientCount: 1,
    },
    audience: "accountant",
    onUpgrade: () => undefined,
  }),
);
assert(loaded.includes(STARTER_TRIAL_ENDED_MESSAGE), "a loaded plan still shows the title");
assert(!loaded.includes("trial-ended-billing"), "a loaded plan keeps the upgrade picker");
assert(!loaded.includes(LOAD_FAILURE), "a loaded plan does not show the failure note");
assert(!loaded.includes("Retry"), "a loaded plan has no Retry");

console.log("ask-ai-trial-ended-billing-test: ok");
