/**
 * Firm setup route: the Home card opens /practice/setup, not a client.
 * Run: pnpm test:practice-setup-route
 */
import { readFileSync } from "node:fs";
import {
  SETUP_PARTNER_FIXED_QUESTIONS,
  fallbackWorkflowMap,
  firmInterviewShouldStop,
  parseFirmInterviewTurn,
  parseWorkflowMapJson,
  workflowMapFromInterview,
} from "../src/lib/setup-partner.ts";
import {
  buildPracticeImplementationPlan,
  classifyPracticeStep,
  clientSetupBrainRows,
  practiceBucketLabel,
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
assert(card.includes("owner-status") && card.includes("Not started"), "home card has a status chip");
assert(card.includes("ImplementationManagerChip"), "home card has the icon badge");
assert(card.includes("owner-money"), "home card has a metric line");
assert(card.includes("Set up practice"), "home card CTA matches the agent ask");
assert(card.includes("embedded"), "home card can sit in the agent grid");

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
assert(
  panel.includes('setupToast("Saved for the practice.", "status")'),
  "success uses the toast helper with a status role",
);
assert(
  panel.includes('setupToast(message, "alert")'),
  "a failed confirm toasts with an alert role",
);
assert(panel.includes('role="alert"'), "the error paragraph stays");
assert(route.includes("<Toaster"), "this route mounts the toast helper's Toaster");
assert(route.includes("PRACTICE_SETUP_TOASTER_ID"), "confirm and the route share one toaster");
assert(panel.includes("HomeBotCard"), "firm page reuses the home bot card");
assert(
  read("src/components/practice-setup-card.tsx").includes("HomeBotCard"),
  "home entry reuses the home bot card",
);
assert(
  read("src/components/owner-door/owner-home.tsx").includes("HomeBotCard"),
  "home bots use the same card",
);
assert(!panel.includes("FIRM_SETUP_QUESTIONS"), "the firm path has no fixed question list");
assert(panel.includes("That's enough, map it"), "the firm can end the interview");
assert(panel.includes("Retry"), "a failed turn can be retried");
assert(!panel.includes("askLabel"), "the setup page has no second CTA");
assert(panel.includes('data-im-card="solo"'), "the setup card aligns to the content edge");
assert(panel.includes("Buckets"), "buckets show before confirm");
assert(
  read("src/components/practice-board.tsx").includes("extraCard={<PracticeSetupCard embedded"),
  "firm home puts the card in the agent grid",
);
assert(
  !read("src/components/practice-board.tsx").includes(
    "{!bookLoading ? <PracticeSetupCard",
  ),
  "the card is not a strip above Open queries",
);
const faceCss = read("src/components/owner-door/owner-door.css");
assert(
  faceCss.includes(".owner-presence.is-lg") && faceCss.includes("width: 172px"),
  "card face box is 172px",
);
const shine = read("src/styles/premium-shine.css");
assert(
  shine.includes(".owner-portrait") && shine.includes("linear-gradient"),
  "card uses the blue gradient tile",
);
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

testFirmInterviewAndDeadlineBucket();
testFollowUpBottleneckAndIntake();
testDedupeLabelsAndReviewer();
testInterviewParseAndStructuredMap();

await runPanel();

/** Firm topics, restored client wording, checklist dedupe, spreadsheet deadlines. */
function testFirmInterviewAndDeadlineBucket() {
  const brief = read("supabase/functions/setup-partner/firm-interview-prompt.ts");
  assert(brief.includes("universal finance function"), "vision brief names the product");
  assert(/open question/i.test(brief) && /Never yes\/no/i.test(brief), "open questions only");
  assert(/clients and segments/i.test(brief), "brief covers clients");
  assert(/prepares, who reviews/i.test(brief), "brief covers the review chain");
  assert(/price and sell/i.test(brief), "brief covers pricing");
  assert(/bottlenecks/i.test(brief), "brief covers bottlenecks");
  assert(!panel.includes("FIRM_SETUP_QUESTIONS"), "firm path does not walk a fixed list");
  const client = SETUP_PARTNER_FIXED_QUESTIONS.map((row) => row.prompt).join(" ");
  assert(/for this client/i.test(client), "per-client path keeps client wording");
  assert(/supplier bills/i.test(client), "per-client path asks about this client's bills");
  assert(
    !/how many clients are on the book/i.test(client),
    "per-client path is not the firm interview",
  );
  const checklist = fallbackWorkflowMap({ deadlines: "Kept in a spreadsheet" }).checklist.join(" ");
  assert(!/name who reviews/i.test(checklist), "fallback does not ask the review question again");
  assert(!/agree deadline tracking/i.test(checklist), "fallback does not add deadline tracking");
  assert(!/note one client only/i.test(checklist), "fallback does not ask for one example client");
  const plan = buildPracticeImplementationPlan({
    todaysFlow: ["Deadlines are kept in a spreadsheet", "The partner reviews and signs off"],
    milonCoverage: [],
    gaps: [],
    checklist: [
      "Agree deadline tracking for the practice",
      "Name who reviews and who signs off.",
      "Note one client only as an example of the firm workflow.",
    ],
  });
  const deadlineSteps = plan.steps.filter((step) => /deadline/i.test(step.step));
  assert(deadlineSteps.length === 1, `one deadline step, got ${deadlineSteps.length}`);
  assert(deadlineSteps[0]?.bucket === "client_setup", "spreadsheet deadlines are client setup");
  assert(
    !plan.steps.some((step) => step.bucket === "covered" && /deadline/i.test(step.step)),
    "agree deadline tracking is not already covered",
  );
  assert(
    !plan.steps.some((step) =>
      /note one client only|name who reviews and who signs off/i.test(step.step),
    ),
    "answered checklist lines are dropped",
  );
}

/** One model question per turn, an early stop, intake stays client setup. */
function testFollowUpBottleneckAndIntake() {
  const first = parseFirmInterviewTurn(
    '{"question":"Walk me through a typical month.","done":false}',
  );
  assert(first.question === "Walk me through a typical month." && !first.done, "one question");
  assert(!first.question.includes("\n"), "the turn is not a question list");
  const ended = parseFirmInterviewTurn('{"question":"","done":true}');
  assert(ended.done && ended.question === "", "the model can end the interview");
  assert(firmInterviewShouldStop(15, false), "the soft cap stops the interview");
  assert(!firmInterviewShouldStop(3, false), "an early turn continues");
  const intake = classifyPracticeStep("clients email receipts and statements");
  assert(intake.bucket === "client_setup", `document intake bucket: ${intake.bucket}`);
  const mix = classifyPracticeStep("Mostly retail and construction industries");
  assert(mix.bucket === "client_setup", `client mix bucket: ${mix.bucket}`);
  const plan = buildPracticeImplementationPlan({
    todaysFlow: ["We do bank rec before the pack goes out"],
    milonCoverage: [],
    gaps: ["Practice bottleneck: bank rec"],
    checklist: [],
  });
  assert(
    plan.steps.some((step) => /bank rec/i.test(step.step) && step.bucket === "client_setup"),
    "bank rec is client setup",
  );
  assert(
    !plan.steps.some((step) => /practice bottleneck/i.test(step.step)),
    "the bottleneck is not a second product gap",
  );
}

/** Truncated model JSON never becomes the question, and a transcript becomes buckets. */
function testInterviewParseAndStructuredMap() {
  const truncated = parseFirmInterviewTurn(
    '{"question":"Partner sign-off by WhatsApp voice note is interesting. Walk me through what happens after a partner sends one: how does the jun',
  );
  assert(
    truncated.question === "Partner sign-off by WhatsApp voice note is interesting.",
    `truncated JSON keeps the finished sentence, got ${truncated.question}`,
  );
  assert(!truncated.question.includes("{") && !truncated.question.includes("how does the jun"), "the cut tail is dropped");
  const fragment = parseFirmInterviewTurn('{"question":"Walk me through how the jun');
  assert(fragment.question === "", "an unfinished fragment is not stored");
  const fenced = parseFirmInterviewTurn(
    '```json\n{"question":"Who closes the month? Who reviews it?","done":false}\n```',
  );
  assert(fenced.question === "Who closes the month?", `one question, got ${fenced.question}`);
  assert(!fenced.question.includes("{") && !fenced.question.includes('"question"'), "no raw JSON");
  const prose = parseFirmInterviewTurn("Who prepares the management pack?");
  assert(prose.question === "Who prepares the management pack?", "prose falls back to the question");
  const transcript = [
    "Q: How do documents arrive?",
    "A: Clients email receipts and bank statements to a shared inbox",
    "Q: Where is VAT?",
    "A: VAT is tracked on a spreadsheet",
    "Q: How does sign-off work?",
    "A: Partner sign-off by WhatsApp voice note",
    "Q: What is close?",
    "A: We run the month-end close",
    "Q: Payroll?",
    "A: Payroll journals are posted by hand",
  ].join("\n");
  const map = workflowMapFromInterview(transcript, null, "US");
  const plan = buildPracticeImplementationPlan(map);
  assert(
    plan.steps.some((step) => step.bucket === "client_setup"),
    "document intake is client setup",
  );
  assert(
    plan.steps.some((step) => step.bucket === "covered"),
    "month-end close is covered",
  );
  assert(
    plan.steps.some((step) => step.bucket === "product_gap"),
    "payroll is a product gap",
  );
  const dumped = JSON.stringify({ map, plan });
  assert(!dumped.includes('{"question"') && !dumped.includes("```"), "no raw JSON in the map");
  assert(!map.todaysFlow.some((line) => line.startsWith("Interview")), "the transcript is not one blob");
  assert(map.todaysFlow.length >= 4, `one step per answer, got ${map.todaysFlow.length}`);
  const edge = read("supabase/functions/setup-partner/index.ts");
  assert(edge.includes("maxTokens: 1024"), "a turn has room to finish the JSON");
  assert(edge.includes("firmLedgerContext") && edge.includes("has P&L"), "turns see connected books");
  assert(edge.includes("workflowMapFromInterview"), "the map is structured from the transcript");
  assert(edge.includes("attempts >= 2"), "a failed turn retries once");
}

/** One case: dedupe by key, human bucket labels, reviewer and sign-off are client setup. */
function testDedupeLabelsAndReviewer() {
  const reviewer = classifyPracticeStep("Name the reviewer");
  const signOff = classifyPracticeStep("Name who signs off");
  const sheet = classifyPracticeStep("Deadlines are kept in a spreadsheet");
  assert(reviewer.bucket === "client_setup", `reviewer bucket: ${reviewer.bucket}`);
  assert(signOff.bucket === "client_setup", `sign-off bucket: ${signOff.bucket}`);
  assert(sheet.bucket === "client_setup", `spreadsheet deadlines bucket: ${sheet.bucket}`);
  assert(reviewer.bucket !== "bespoke" && signOff.bucket !== "bespoke", "not bespoke");

  const line = "Want management packs and cash forecasts";
  const plan = buildPracticeImplementationPlan({
    todaysFlow: [line, line],
    milonCoverage: [],
    gaps: [line],
    checklist: [],
  });
  assert(plan.steps.length === 1, `covered line deduped, got ${plan.steps.length}`);
  assert(plan.steps[0]?.bucket === "covered", "management packs are already covered");
  assert(practiceBucketLabel("covered") === "Already covered", "covered label");
  assert(practiceBucketLabel("client_setup") === "Client setup", "client setup label");
  assert(practiceBucketLabel("product_gap") === "Product gap", "product gap label");
  assert(practiceBucketLabel("bespoke") === "Bespoke", "bespoke label");
  assert(
    `${plan.steps[0]?.step} — ${practiceBucketLabel(plan.steps[0]!.bucket)}` ===
      "Want management packs and cash forecasts — Already covered",
    "the done list maps the bucket",
  );
}

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

  const successes: string[] = [];
  const errors: string[] = [];
  const originalSuccess = toast.success.bind(toast);
  const originalError = toast.error.bind(toast);
  const toastText = (message: unknown) => {
    if (typeof message === "string") return message;
    if (message && typeof message === "object" && "props" in message) {
      const children = (message as { props?: { children?: unknown } }).props?.children;
      if (typeof children === "string") return children;
    }
    return String(message);
  };
  toast.success = ((message: unknown, data?: unknown) => {
    successes.push(toastText(message));
    return originalSuccess(message as string, data as never);
  }) as typeof toast.success;
  toast.error = ((message: unknown, data?: unknown) => {
    errors.push(toastText(message));
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
          askTurn: async ({ modelTurns }) => ({
            question: "Walk me through how a typical client month ends.",
            done: modelTurns > 0,
            modelTurns: modelTurns + 1,
          }),
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
    await waitForPhase("interview");
    for (let i = 0; i < 20; i += 1) {
      await settle();
      if (document.querySelector(".setup-partner__question")?.textContent?.trim()) break;
    }
    const asked = document.querySelectorAll(".setup-partner__question");
    assert(asked.length === 1, "one question per turn");
    assert(
      asked[0]?.textContent === "Walk me through how a typical client month ends.",
      "the mocked model asked one open question",
    );
    const enough = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "That's enough, map it",
    );
    assert(enough instanceof HTMLButtonElement, "the firm can end early");
    await act(async () => {
      enough.click();
    });
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
    document.body.textContent?.includes("Who signs the pack — Client setup"),
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
    document.body.textContent?.includes("Walk me through how a typical client month ends."),
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
    document.body.textContent?.includes("Who signs the pack — Client setup"),
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
