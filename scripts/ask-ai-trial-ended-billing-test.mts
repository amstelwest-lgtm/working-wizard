/**
 * When the trial-ended plan card cannot load plans, the thread still offers
 * the billing page the upgrade CTA already uses. No Retry.
 *
 * Accountant Analyst chat and Bot: /settings#firm-billing
 * Owner on their own plan: /app?screen=plan
 * Owner whose firm is an accountant firm: the renewal note, no plan link,
 * and no accountant price ladder even when a plan payload is present.
 *
 * Run: pnpm test:ask-ai-trial-ended-billing
 */
import { Window } from "happy-dom";
import { OWNER_ACCOUNTANT_TRIAL_NOTE } from "../src/lib/owner-trial-ended.ts";
import {
  STARTER_TRIAL_ENDED_CODE,
  STARTER_TRIAL_ENDED_MESSAGE,
} from "../src/lib/starter-trial-constants.ts";
import { firmUsdListPrice } from "../src/lib/stripe-plans.ts";

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

const ACCOUNTANT_PRICES = ["starter", "solo", "small"].map((band) => {
  const price = firmUsdListPrice(band as "starter" | "solo" | "small", "month");
  assert(price, `${band} has a published monthly price`);
  return price;
});

function assertNoAccountantPrices(root: ParentNode, where: string) {
  const html = root instanceof Element ? root.innerHTML : "";
  for (const price of ACCOUNTANT_PRICES) {
    assert(!html.includes(price), `${where} does not show ${price}`);
  }
  assert(!/\$\d/.test(html), `${where} shows no dollar price`);
  assert(!/R\s?\d/.test(html), `${where} shows no rand price`);
  assert(!html.includes("firm-band-row"), `${where} does not show the accountant price ladder`);
}

function assertNoPlanLink(root: ParentNode, where: string) {
  const html = root instanceof Element ? root.innerHTML : "";
  assert(root.querySelector("a") == null, `${where} has no link`);
  assert(!html.includes("trial-ended-billing"), `${where} has no Plan & billing link`);
  assert(!html.includes("/app?screen=plan"), `${where} does not link to the owner plan page`);
  assert(!html.includes("/settings#firm-billing"), `${where} does not link to firm billing`);
  assert(!html.includes("/billing"), `${where} does not link to checkout`);
  assert(!html.includes(BILLING_LABEL), `${where} does not label a plan link`);
  assert(root.querySelector("button.ask-ai-retry") == null, `${where} has no Retry button`);
  assert(!root.textContent?.includes("Retry"), `${where} does not say Retry`);
  assert(!html.includes("Subscribe"), `${where} has no checkout button`);
}

function assertAccountantCalm(root: ParentNode, where: string) {
  const title = root.querySelector(".trial-ended-title");
  assert(
    title?.textContent === STARTER_TRIAL_ENDED_MESSAGE,
    `${where} shows the trial-ended title`,
  );
  assert(root.textContent?.includes(OWNER_ACCOUNTANT_TRIAL_NOTE), `${where} asks the accountant to choose a plan`);
  assert(!root.textContent?.includes(LOAD_FAILURE), `${where} does not use the load-failure note`);
  const marked =
    (root instanceof Element && root.matches("[data-owner-trial-ended='accountant']")) ||
    root.querySelector("[data-owner-trial-ended='accountant']") != null;
  assert(marked, `${where} is the accountant-firm calm state`);
  assertNoPlanLink(root, where);
  assertNoAccountantPrices(root, where);
  assert(root.querySelector(".ask-ai-error") == null, `${where} is not a red error`);
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

const ownerFirmHost = document.createElement("div");
document.body.appendChild(ownerFirmHost);
const ownerFirmRoot = createRoot(ownerFirmHost);
await act(async () => {
  ownerFirmRoot.render(
    createElement(ChatTrialEndedPlan, {
      firmId: "22222222-2222-4222-8222-222222222222",
      audience: "owner",
    }),
  );
});
await until(
  ownerFirmHost,
  () => Boolean(ownerFirmHost.textContent?.includes(OWNER_ACCOUNTANT_TRIAL_NOTE)),
  "accountant-firm owner plan load did not settle on the renewal note",
);
assertAccountantCalm(ownerFirmHost, "accountant-firm owner getFirmPlanDisplay failure");
await act(async () => {
  ownerFirmRoot.unmount();
});
ownerFirmHost.remove();

const ownPlanHost = document.createElement("div");
document.body.appendChild(ownPlanHost);
const ownPlanRoot = createRoot(ownPlanHost);
await act(async () => {
  ownPlanRoot.render(
    createElement(ChatTrialEndedPlan, {
      firmId: null,
      audience: "owner",
    }),
  );
});
await until(
  ownPlanHost,
  () => Boolean(ownPlanHost.textContent?.includes(LOAD_FAILURE)),
  "own-plan owner plan load did not fail closed",
);
assertBillingLink(ownPlanHost, OWNER_BILLING, "owner on their own plan getFirmPlanDisplay failure");
await act(async () => {
  ownPlanRoot.unmount();
});
ownPlanHost.remove();

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

async function sendTrialEnded(
  audience: "accountant" | "owner",
  firmId: string | null,
) {
  const where = `${audience}${firmId ? " with a firm" : " without a firm"}`;
  const container = document.createElement("div");
  container.dataset.clientId = audience === "owner" ? "owner-client" : "analyst-client";
  if (firmId) container.dataset.firmId = firmId;
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
  assert(ta instanceof HTMLTextAreaElement, `${where} shell has a question box`);
  ta.value = "What is this client's health score?";
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  const button = container.querySelector("button.ask-ai-send");
  assert(button instanceof HTMLButtonElement, `${where} shell has send`);
  button.click();
  const asksAccountant = audience === "owner" && Boolean(firmId);
  await until(
    container,
    () => {
      const section = container.querySelector("[data-trial-ended='plan']");
      if (!(section instanceof HTMLElement)) return false;
      return asksAccountant
        ? Boolean(section.textContent?.includes(OWNER_ACCOUNTANT_TRIAL_NOTE))
        : Boolean(section.querySelector("a.trial-ended-billing"));
    },
    `${where} chunk failure did not settle`,
  );
  const section = container.querySelector("[data-trial-ended='plan']");
  assert(section instanceof HTMLElement, `${where} shell section stays when the chunk fails`);
  assert(section.className === "trial-ended-block", `${where} shell is not replaced by the card`);
  if (asksAccountant) assertAccountantCalm(section, `${where} chunk failure`);
  else assertBillingLink(section, audience === "owner" ? OWNER_BILLING : ACCOUNTANT_BILLING, `${where} chunk failure`);
  container.remove();
}

await sendTrialEnded("accountant", "33333333-3333-4333-8333-333333333333");
await sendTrialEnded("owner", "33333333-3333-4333-8333-333333333333");
await sendTrialEnded("owner", null);

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
assert(!loaded.includes("trial-ended-billing"), "a loaded accountant plan keeps the upgrade picker");
assert(loaded.includes("firm-band-row"), "a loaded accountant plan shows the price ladder");
assert(
  ACCOUNTANT_PRICES.every((price) => loaded.includes(price)),
  "a loaded accountant plan shows the catalog prices",
);
assert(!loaded.includes(LOAD_FAILURE), "a loaded plan does not show the failure note");
assert(!loaded.includes("Retry"), "a loaded plan has no Retry");

const pricedOwner = renderToStaticMarkup(
  createElement(TrialEndedPlanCard, {
    upgrade: {
      band: "starter",
      interval: "month",
      priceCurrency: "USD",
      canUpgrade: true,
      clientCount: 1,
      zarPlan: true,
      zaLabels: {
        starter: { month: "R299/mo", year: "R2,990/yr" },
        solo: { month: "R990/mo", year: "R9,900/yr" },
        small: { month: "R1,490/mo", year: "R14,900/yr" },
      },
    },
    audience: "owner",
    accountantFirm: true,
    onUpgrade: () => undefined,
  }),
);
const pricedHost = document.createElement("div");
pricedHost.innerHTML = pricedOwner;
assertAccountantCalm(pricedHost, "accountant-firm owner with a loaded plan payload");

console.log("ask-ai-trial-ended-billing-test: ok");
