/**
 * Firm setup route: the Home card opens /practice/setup, not a client.
 * Run: pnpm test:practice-setup-route
 */
import { readFileSync } from "node:fs";
import { fallbackWorkflowMap, parseWorkflowMapJson } from "../src/lib/setup-partner.ts";
import {
  classifyPracticeStep,
  clientSetupBrainRows,
  practicePlanFromConfirmRules,
} from "../src/lib/setup-partner-plan.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const card = read("src/components/practice-setup-card.tsx");
assert(card.includes('to="/practice/setup"'), "card opens the firm setup route");
assert(!card.includes("/clients/"), "card does not deep-link a client");
assert(!card.includes("view=books"), "card does not open client books");

const route = read("src/routes/_authenticated/practice_.setup.tsx");
assert(
  route.includes('"/_authenticated/practice_/setup"'),
  "route id follows practice_ convention",
);
assert(route.includes("<PracticeSetupPanel"), "route renders the firm panel");

const panel = read("src/components/practice-setup-panel.tsx");
assert(panel.includes("Implementation Manager"), "firm header label");
assert(panel.includes("data-practice-setup-panel"), "panel marker");
assert(!panel.includes("Connect Xero") && !panel.includes("ConnectBooks"), "no connect block");
assert(!panel.includes("QuickBooks") && !panel.includes("ledger snapshot"), "no client books");
assert(!panel.includes("client picker") && !panel.includes("Select a client"), "no client picker");
assert(panel.includes("buildSetupPartnerFirmMap"), "panel uses the firm API");
const clientPanel = read("src/components/setup-partner-panel.tsx");
assert(!clientPanel.includes("PracticeSetupPanel"), "client panel is not this route");
assert(
  !panel.includes('from "@/components/setup-partner-panel"'),
  "firm panel does not render the client panel",
);

const tree = read("src/routeTree.gen.ts");
assert(tree.includes("'/practice/setup'"), "route tree publishes /practice/setup");

const edge = read("supabase/functions/setup-partner/index.ts");
assert(edge.includes("clientId or firmId is required"), "firm mode does not require a client");
assert(edge.includes("has_client_access"), "client mode still checks client access");
assert(edge.includes("coverageMarketNote"), "build_map tells the model the firm country");
assert(
  edge.includes("parseWorkflowMapJson(text, answers, country)"),
  "coverage uses the firm country",
);
assert(panel.includes("Saving…"), "confirm shows Saving while the request is in flight");
assert(panel.includes('toast.success("Saved for the practice.")'), "success uses the toast helper");
assert(panel.includes("toast.error(message)"), "a failed confirm toasts");
assert(panel.includes('role="alert"'), "the error paragraph stays");
assert(panel.includes("Redo interview"), "a saved plan can be redone");
assert(panel.includes("fetchFirmSetupPlan"), "saved rules load through the existing client");
assert(
  panel.includes('agent="setup_partner"'),
  "firm page mounts the Implementation Manager avatar",
);
assert(panel.includes("withMarketCoverage"), "the firm page scrubs coverage for the firm country");
assert(!panel.includes("setup-partner-panel.tsx"), "firm page does not fork the client panel file");

const prompt = read("supabase/functions/setup-partner/firm-interview-prompt.ts");
assert(prompt.includes("US firms: sales-tax prep"), "the playbook is market-aware");
assert(
  prompt.includes("no ZA or SARS wording"),
  "the playbook tells a US firm not to use ZA or SARS",
);

const usCoverage = fallbackText(fallbackWorkflowMap({}, "US"));
assert(!marketLeak(usCoverage), "US fallback coverage has no ZA or SARS");
assert(usCoverage.includes("Sales-tax prep"), "US tax line is sales tax");
const zaCoverage = fallbackText(fallbackWorkflowMap({}, "ZA"));
assert(zaCoverage.includes("ZA tax prep"), "ZA firms keep ZA tax prep");
const parsedUs = parseWorkflowMapJson(
  JSON.stringify({
    todaysFlow: ["Partner closes by day 6"],
    milonCoverage: [
      { agent: "Tax Specialist", owns: "ZA tax prep for accountant review (no filing)." },
      { agent: "Advisor", owns: "Deadline notes for SARS." },
    ],
    gaps: ["Manual pack"],
    checklist: ["Name the reviewer"],
  }),
  {},
  "US",
);
assert(!marketLeak(fallbackText(parsedUs)), "a US parse drops ZA and SARS from model coverage");
assert(
  parsedUs.milonCoverage.some((row) => row.owns.includes("Sales-tax prep")),
  "US tax coverage is replaced",
);

const firmId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const savedRows = clientSetupBrainRows({
  firmId,
  approverId: "11111111-1111-1111-1111-111111111111",
  steps: [classifyPracticeStep("Who signs the pack")],
});
assert(
  savedRows.length === 1 && savedRows[0]?.client_id === null,
  "confirm stores a firm-level rule",
);
const restored = practicePlanFromConfirmRules(savedRows);
assert(restored.steps[0]?.step === "Who signs the pack", "the saved step text round-trips");
assert(restored.steps[0]?.bucket === "client_setup", "the saved step's bucket round-trips");
assert(
  clientSetupBrainRows({
    firmId,
    approverId: "11111111-1111-1111-1111-111111111111",
    steps: [classifyPracticeStep("Month-end close pack")],
  }).length === 0,
  "covered steps are not stored on the confirm rules",
);

await runPanel();

console.log("practice-setup-route-test: ok");

function marketLeak(text: string): boolean {
  return /\bZA\b|\bSARS\b/.test(text);
}

function fallbackText(map: { milonCoverage: Array<{ agent: string; owns: string }> }): string {
  return map.milonCoverage.map((row) => `${row.agent}: ${row.owns}`).join("\n");
}

async function runPanel() {
  process.env.SUPABASE_URL ??= "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
  process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

  const { Window } = await import("happy-dom");
  const window = new Window({
    url: "http://127.0.0.1:5000/practice/setup",
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
    "HTMLInputElement",
    "HTMLButtonElement",
    "HTMLTextAreaElement",
    "HTMLAnchorElement",
    "Element",
    "Node",
    "Document",
    "KeyboardEvent",
    "MouseEvent",
    "InputEvent",
    "Event",
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
      value: key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key],
    });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    writable: true,
    value: true,
  });
  const IntersectionObserverStub = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  window.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;
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
  const {
    Outlet,
    RouterProvider,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
  } = await import("@tanstack/react-router");
  const { toast } = await import("sonner");
  const { PracticeSetupInterview } = await import("../src/components/practice-setup-panel.tsx");
  const { SETUP_PARTNER_FIXED_QUESTIONS } = await import("../src/lib/setup-partner.ts");

  const successes: string[] = [];
  const errors: string[] = [];
  const originalSuccess = toast.success.bind(toast);
  const originalError = toast.error.bind(toast);
  toast.success = ((message: unknown, data?: unknown) => {
    successes.push(String(message));
    return originalSuccess(message as string, data as never);
  }) as typeof toast.success;
  toast.error = ((message: unknown, data?: unknown) => {
    errors.push(String(message));
    return originalError(message as string, data as never);
  }) as typeof toast.error;

  const usMarket = { country: "US", regionCode: "NY" };
  const zaMap = {
    todaysFlow: ["Partner closes by day 6"],
    milonCoverage: [
      { agent: "Tax Specialist", owns: "ZA tax prep for accountant review (no filing)." },
      { agent: "Advisor", owns: "Deadline notes for SARS." },
    ],
    gaps: ["Manual pack"],
    checklist: ["Name the reviewer"],
  };
  const savedStep = classifyPracticeStep("Who signs the pack");

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function waitForPhase(phase: string) {
    for (let i = 0; i < 20; i += 1) {
      await settle();
      const node = document.querySelector("[data-practice-setup-phase]");
      if (node?.getAttribute("data-practice-setup-phase") === phase) return;
    }
    throw new Error(
      `phase stayed ${document.querySelector("[data-practice-setup-phase]")?.getAttribute("data-practice-setup-phase")}`,
    );
  }

  async function mount(props: {
    loadSaved: (firmId: string) => Promise<{ steps: (typeof savedStep)[] } | null>;
    buildMap: () => Promise<{ map: typeof zaMap; modelTurns: number }>;
    confirmMap: () => Promise<{
      ok: boolean;
      inserted: number;
      plan: { steps: (typeof savedStep)[] } | null;
    }>;
  }) {
    const rootRoute = createRootRoute({
      component: () => createElement(Outlet),
    });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () =>
        createElement(PracticeSetupInterview, {
          firmId,
          firmMarket: usMarket,
          loadSaved: props.loadSaved,
          buildMap: props.buildMap,
          confirmMap: props.confirmMap,
        }),
    });
    const practiceRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/practice",
      component: () => createElement("div"),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute, practiceRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    // vite-node reports a server runtime, so Matches reads `_rendered` before Transitioner assigns it.
    (router as { _rendered?: unknown[] })._rendered ??= [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(RouterProvider, { router }));
    });
    await settle();
    return async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    };
  }

  async function answerAll() {
    for (let i = 0; i < SETUP_PARTNER_FIXED_QUESTIONS.length; i += 1) {
      const box = document.querySelector("textarea");
      assert(box instanceof HTMLTextAreaElement, `question ${i} has an answer box`);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      assert(setter, "textarea value setter");
      await act(async () => {
        setter.call(box, `Answer ${i} from the partner`);
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const next = [...document.querySelectorAll("button")].find((button) =>
        /^(Next|Working…)$/.test(button.textContent ?? ""),
      );
      assert(next instanceof HTMLButtonElement, `question ${i} has Next`);
      assert(!next.disabled, `question ${i} Next is enabled`);
      await act(async () => {
        next.click();
      });
    }
  }

  function coverageText(): string {
    const text = document.body.textContent ?? "";
    const start = text.indexOf("Milōn coverage");
    const end = text.indexOf("Confirm workflow map");
    assert(start >= 0 && end > start, "coverage list is on the map");
    return text.slice(start, end);
  }

  let releaseBuild: (value: { map: typeof zaMap; modelTurns: number }) => void = () => undefined;
  const buildGate = new Promise<{ map: typeof zaMap; modelTurns: number }>((resolve) => {
    releaseBuild = resolve;
  });
  let releaseConfirm: (value: {
    ok: boolean;
    inserted: number;
    plan: { steps: (typeof savedStep)[] };
  }) => void = () => undefined;
  const confirmGate = new Promise<{
    ok: boolean;
    inserted: number;
    plan: { steps: (typeof savedStep)[] };
  }>((resolve) => {
    releaseConfirm = resolve;
  });

  const unmountSaved = await mount({
    loadSaved: async () => ({ steps: [savedStep] }),
    buildMap: async () => buildGate,
    confirmMap: async () => confirmGate,
  });
  await waitForPhase("done");
  assert(
    document.body.textContent?.includes("Saved for the practice."),
    "existing rules open on the saved plan",
  );
  assert(
    document.body.textContent?.includes("Who signs the pack — client_setup"),
    "saved step and bucket are shown",
  );
  assert(
    document
      .querySelector("img")
      ?.getAttribute("src")
      ?.includes("/avatars/implementation-manager/"),
    "saved plan still shows the Implementation Manager",
  );
  const redo = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Redo interview",
  );
  assert(redo instanceof HTMLButtonElement, "redo is available");
  await act(async () => {
    redo.click();
  });
  await waitForPhase("interview");
  assert(
    document.body.textContent?.includes(
      "How does the practice run month-end close across clients?",
    ),
    "redo opens the interview",
  );
  await unmountSaved();

  successes.length = 0;
  errors.length = 0;
  const unmountOk = await mount({
    loadSaved: async () => null,
    buildMap: async () => buildGate,
    confirmMap: async () => confirmGate,
  });
  await waitForPhase("interview");
  assert(
    document.querySelector("img")?.getAttribute("src") ===
      "/avatars/implementation-manager/implementation-manager-poster.jpg",
    "the firm page uses the Implementation Manager poster",
  );
  await answerAll();
  const working = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Working…",
  );
  assert(working instanceof HTMLButtonElement && working.disabled, "the last Next shows Working…");
  await act(async () => {
    releaseBuild({ map: zaMap, modelTurns: 1 });
  });
  await waitForPhase("map");
  assert(!marketLeak(coverageText()), "a US firm coverage list has no ZA or SARS");
  assert(coverageText().includes("Sales-tax prep"), "US coverage names sales-tax prep");
  const confirm = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Confirm workflow map",
  );
  assert(confirm instanceof HTMLButtonElement, "confirm is ready");
  await act(async () => {
    confirm.click();
  });
  const saving = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Saving…",
  );
  assert(
    saving instanceof HTMLButtonElement && saving.disabled,
    "confirm shows Saving… and is disabled",
  );
  await act(async () => {
    releaseConfirm({ ok: true, inserted: 1, plan: { steps: [savedStep] } });
  });
  await waitForPhase("done");
  assert(
    document.body.textContent?.includes("Saved for the practice."),
    "success keeps the saved line",
  );
  assert(
    document.body.textContent?.includes("Who signs the pack — client_setup"),
    "success keeps the step and bucket",
  );
  assert(successes.includes("Saved for the practice."), "success toasts");
  assert(!document.querySelector("[role=alert]"), "success clears the alert");
  await unmountOk();

  successes.length = 0;
  errors.length = 0;
  const unmountFail = await mount({
    loadSaved: async () => null,
    buildMap: async () => ({ map: zaMap, modelTurns: 1 }),
    confirmMap: async () => {
      throw new Error("Could not save the practice map");
    },
  });
  await waitForPhase("interview");
  await answerAll();
  await waitForPhase("map");
  const confirmAgain = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Confirm workflow map",
  );
  assert(confirmAgain instanceof HTMLButtonElement, "confirm is ready after a fast map");
  await act(async () => {
    confirmAgain.click();
  });
  await settle();
  const alert = document.querySelector("[role=alert]");
  assert(alert?.textContent === "Could not save the practice map", "the alert keeps the error");
  assert(errors.includes("Could not save the practice map"), "the error toasts");
  assert(
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent === "Confirm workflow map",
    ),
    "a failed confirm stays on the map",
  );
  assert(
    !document.body.textContent?.includes("Saved for the practice."),
    "a failure does not show saved",
  );
  await unmountFail();
}
