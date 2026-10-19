/**
 * Owner Health shows the ring only on the top view.
 * Owner cash keeps the period and roll line above the forecast, and parks
 * the rest in a collapsed More detail control.
 *
 * Run: pnpm test:owner-layout
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const window = new Window({
  url: "http://127.0.0.1:5000/app",
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
  "HTMLButtonElement",
  "Element",
  "Node",
  "Document",
  "KeyboardEvent",
  "MouseEvent",
  "Event",
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

const { createElement } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { HEALTH_RING_CAPTION, SphereHero } = await import("../src/components/sphere-hero");
const { HEALTH_DRILL_CUE } = await import("../src/components/health-drill-cue");
const { ForecastMoreDetail } = await import("../src/components/cash-forecast");

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  await tick();
  return async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  };
}

const pillars = [
  {
    id: "profit" as const,
    label: "Profit",
    health: 72,
    drivers: [{ key: "netMargin", label: "Net margin", health: 72 }],
  },
  { id: "assets" as const, label: "Assets", health: 61, drivers: [] },
  { id: "financing" as const, label: "Financing", health: 54, drivers: [] },
  { id: "cash" as const, label: "Cash", health: 40, drivers: [] },
];

function hero(variant: "ring" | "orb") {
  return createElement(SphereHero, {
    variant,
    overallHealth: 64,
    pillars,
    caption: HEALTH_RING_CAPTION,
  });
}

function counts() {
  return {
    ring: document.querySelectorAll(".health-ring").length,
    orb: document.querySelectorAll(".health-orb").length,
  };
}

const owner = await mount(hero("ring"));
assert(HEALTH_RING_CAPTION === HEALTH_DRILL_CUE, "the ring caption matches the pillar cue");
assert(document.body.textContent?.includes(HEALTH_DRILL_CUE), "the owner ring shows the shared cue");
assert(!document.body.textContent?.includes("Click to see more"), "the owner side does not say Click");
assert(counts().ring === 1, "the owner health ring is on the top view");
assert(counts().orb === 0, "the owner top view does not add a second orb");
const ring = document.querySelector(".health-ring");
assert(ring instanceof HTMLButtonElement, "the ring stays a button");
await act(async () => {
  ring.click();
});
await tick();
assert(counts().ring === 0 && counts().orb === 0, "the pillar page hides the health ring and orb");
assert(document.body.textContent?.includes("Health by pillar"), "pillar cards stay on the drill-down");
assert(document.body.textContent?.includes(HEALTH_DRILL_CUE), "pillar cards use the same cue");
const profit = [...document.querySelectorAll("button")].find((button) =>
  button.getAttribute("aria-label")?.startsWith("Profit score"),
);
assert(profit instanceof HTMLButtonElement, "the profit pillar stays a button");
await act(async () => {
  profit.click();
});
await tick();
assert(counts().ring === 0 && counts().orb === 0, "the driver page hides the health ring and orb");
assert(!document.body.textContent?.includes(HEALTH_DRILL_CUE), "the driver page has no see-more cue");
assert(document.querySelector(".sphere-orb") === null, "the driver page has no big sphere");
assert(document.body.textContent?.includes("Profit drivers"), "driver rows stay");
const back = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Back to pillars"));
assert(back instanceof HTMLButtonElement, "back to pillars stays");
await act(async () => {
  back.click();
});
await tick();
const overview = [...document.querySelectorAll("button")].find((button) =>
  button.textContent?.includes("Back to overview"),
);
assert(overview instanceof HTMLButtonElement, "back to overview stays");
await act(async () => {
  overview.click();
});
await tick();
assert(counts().ring === 1, "backing out restores the health ring");
await owner();

const accountant = await mount(hero("orb"));
assert(counts().orb === 1 && counts().ring === 0, "the accountant orb stays on its top view");
const orb = document.querySelector(".health-orb");
assert(orb instanceof HTMLButtonElement, "the accountant orb stays a button");
await act(async () => {
  orb.click();
});
await tick();
assert(counts().orb === 1, "the accountant pillar view still shows its orb");
await accountant();

const detail = await mount(
  createElement(
    ForecastMoreDetail,
    null,
    createElement("p", null, "Floor and assumptions"),
    createElement("button", { type: "button" }, "Invite your accountant"),
  ),
);
const toggle = [...document.querySelectorAll("button")].find((button) => button.textContent === "More detail");
assert(toggle instanceof HTMLButtonElement, "More detail is a button");
assert(toggle.getAttribute("aria-expanded") === "false", "More detail starts collapsed");
assert(!toggle.disabled && toggle.tabIndex >= 0, "More detail is keyboard accessible");
const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
assert(panel instanceof HTMLElement && panel.hidden, "the detail panel is hidden");
assert(panel.textContent?.includes("Floor and assumptions"), "assumptions stay in More detail");
assert(panel.textContent?.includes("Invite your accountant"), "the invite button stays inside More detail");
const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
toggle.focus();
toggle.dispatchEvent(space);
assert(!space.defaultPrevented, "Space is not swallowed before the button handles it");
assert(document.activeElement === toggle, "the disclosure keeps keyboard focus");
await act(async () => {
  toggle.click();
});
assert(toggle.getAttribute("aria-expanded") === "true", "More detail expands");
assert(!panel.hidden, "the detail panel opens");
await act(async () => {
  toggle.click();
});
assert(toggle.getAttribute("aria-expanded") === "false" && panel.hidden, "More detail collapses again");
await detail();

const cash = readFileSync("src/components/cash-forecast.tsx", "utf8");
const simplifiedAt = cash.indexOf("if (simplified)");
const simplified = cash.slice(simplifiedAt, cash.indexOf("Complex mode"));
assert(simplified.indexOf("{forecastCard}") < simplified.indexOf("<ForecastMoreDetail>"), "More detail sits below the forecast");
assert(simplified.includes("{kpiTiles}"), "owner KPIs move into More detail");
assert(simplified.includes("{readOnly ? null : reviewInputs}"), "owner inputs move into More detail");
assert(cash.includes("data-cash-period"), "the forecast period stays on the card");
assert(cash.includes("data-cash-roll"), "the rolled-forward line stays on the card");
assert(cash.includes('label="cash flow graph"'), "the graph enlarge button stays");
assert(cash.includes('label="cash flow table"'), "the table enlarge button stays");
assert(cash.indexOf("data-cash-period") < cash.indexOf('aria-label="Graph"'), "the period is above the graph");
assert(cash.includes("simplified ? null : kpiTiles"), "the owner graph does not keep the KPI row");

const { cashFloorCopy } = await import("../src/lib/owner-answers");
const ownerFloor = cashFloorCopy({
  opening: 4335,
  floor: 50000,
  dipsBelowFloorWeek: 2,
  closing: [4335],
  money: (amount) => `$${amount}`,
  market: { currency: "USD", locale: "en-US" },
});
const accountantFloor = cashFloorCopy({
  opening: 44480,
  floor: 32688,
  dipsBelowFloorWeek: 4,
  closing: [30000],
  money: (amount) => `R ${amount}`,
  market: { currency: "ZAR", locale: "en-ZA" },
});
assert(ownerFloor.chip === "Below your minimum" && ownerFloor.healthCue != null, "the owner card and health share the floor line");
assert(
  accountantFloor.sentence.startsWith("Cash R 30000, R 2688 below your "),
  accountantFloor.sentence,
);
assert(accountantFloor.healthCue != null && accountantFloor.chip === ownerFloor.chip, "the accountant brief uses the same chip");

function healthPillars(cashScore: number, status: "at_risk" | "critical") {
  return [
    { id: "profit" as const, label: "Profit", health: 80, drivers: [] },
    { id: "assets" as const, label: "Assets", health: 70, drivers: [] },
    { id: "financing" as const, label: "Financing", health: 60, drivers: [] },
    { id: "cash" as const, label: "Cash", health: cashScore, status, drivers: [] },
  ];
}

async function expectCashLine(cashScore: number, status: "at_risk" | "critical", band: string, cue: string) {
  const stop = await mount(
    createElement(SphereHero, {
      variant: "ring",
      overallHealth: cashScore,
      pillars: healthPillars(cashScore, status),
      cashFloorCue: cue,
    }),
  );
  const cash = [...document.querySelectorAll("button")].find((button) =>
    button.getAttribute("aria-label")?.startsWith("Cash score"),
  );
  assert(cash instanceof HTMLButtonElement, "the cash pillar is the health card");
  assert(cash.querySelector(".health-pillar-figure")?.textContent === String(cashScore), "the cash score stays");
  assert(cash.querySelector(".health-pillar-band")?.textContent?.includes(band) === true, `the cash band stays ${band}`);
  assert(cash.querySelector("[data-cash-floor-cue]")?.textContent === cue, "the floor line sits under the cash pillar");
  await stop();
}

await expectCashLine(71, "at_risk", "Watch", ownerFloor.healthCue!);
await expectCashLine(25, "critical", "Critical", accountantFloor.healthCue!);

const { SimplifiedRatios } = await import("../src/components/simplified-ratios");
const { OwnerHome } = await import("../src/components/owner-door/owner-home");
const { steerAssignedWork } = await import("../src/lib/owner-presence");

let floorOpens = 0;
const ringStop = await mount(
  createElement(SphereHero, {
    variant: "ring",
    overallHealth: 73,
    pillars: healthPillars(71, "at_risk"),
    cashFloorCue: ownerFloor.healthCue,
    onCashFloor: () => {
      floorOpens += 1;
    },
  }),
);
assert(document.body.textContent?.includes("Health by pillar") === true, "the owner page is the pillar grid");
const ringCash = [...document.querySelectorAll("button")].find((button) =>
  button.getAttribute("aria-label")?.startsWith("Cash score"),
);
assert(ringCash instanceof HTMLButtonElement, "the cash card is on the pillar grid");
const ringCue = ringCash.querySelector("[data-cash-floor-cue]");
assert(ringCue?.textContent === ownerFloor.healthCue, "the cue is the shared floor line");
await act(async () => {
  ringCue?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});
assert(floorOpens === 1, "the cash line opens FM");
assert(!document.body.textContent?.includes("drivers"), "the line does not drill the card");
await act(async () => {
  ringCash.click();
});
assert(document.body.textContent?.includes("Cash drivers") === true, "the rest of the card drills");
await ringStop();

const dayStop = await mount(
  createElement(SphereHero, {
    variant: "ring",
    overallHealth: 70,
    pillars: [
      {
        id: "cash",
        label: "Cash",
        health: 70,
        drivers: [
          {
            key: "debtorDays",
            label: "Debtor Days",
            health: 93,
            reading: "Debtor Days · 6 days · score 93",
          },
          {
            key: "ocfToEbitda",
            label: "OCF / EBITDA",
            health: 55,
          },
        ],
      },
    ],
  }),
);
const dayCash = [...document.querySelectorAll("button")].find((button) =>
  button.getAttribute("aria-label")?.startsWith("Cash score"),
);
assert(dayCash instanceof HTMLButtonElement, "the day-label cash card drills");
await act(async () => {
  dayCash.click();
});
const dayText = document.body.textContent ?? "";
assert(dayText.includes("Debtor Days · 6 days · score 93"), dayText);
assert(dayText.includes("Cash drivers"), "the cash driver heading stays");
const debtorRow = [...document.querySelectorAll(".health-driver-row")].find((row) =>
  row.textContent?.includes("Debtor Days"),
);
assert(debtorRow instanceof HTMLElement, "the debtor row is on the card");
assert(
  ![...debtorRow.querySelectorAll("p")].some((node) => node.className.includes("text-lg") && node.textContent?.trim() === "93"),
  "the debtor score is not a bare day-sized number",
);
const otherRow = [...document.querySelectorAll(".health-driver-row")].find((row) =>
  row.textContent?.includes("OCF / EBITDA"),
);
assert(
  [...(otherRow?.querySelectorAll("p") ?? [])].some((node) => node.textContent?.trim() === "55"),
  "a non-day driver still shows its score",
);
await dayStop();

let pillarOpens = 0;
let pillarFm = 0;
const pillarStop = await mount(
  createElement(SimplifiedRatios, {
    sections: [
      { id: "profit", label: "Profit", health: 70, status: "at_risk", series: [] },
      { id: "cash", label: "Cash", health: 25, status: "critical", series: [] },
    ],
    onAddPastPeriod: () => undefined,
    onOpenEvidence: () => undefined,
    onOpenPillar: () => {
      pillarOpens += 1;
    },
    cashFloorCue: accountantFloor.healthCue,
    onCashFloor: () => {
      pillarFm += 1;
    },
  }),
);
const pillarCard = [...document.querySelectorAll(".health-summary-card")].find((card) =>
  card.textContent?.includes("Cash"),
);
assert(pillarCard instanceof HTMLElement, "the accountant cash pillar is the summary card");
const pillarCash = pillarCard.querySelector("button");
assert(pillarCash instanceof HTMLButtonElement, "the cash summary drills from a button");
assert(pillarCard.textContent?.includes("See more") === true, "the drill cue stays");
assert(pillarCard.textContent?.includes("Add a past period") === true, "the past-period link stays on the card");
assert(pillarCard.textContent?.includes("See it on Cash") === true, "the cash evidence link stays");
assert(pillarCard.textContent?.includes(accountantFloor.healthCue!) === true, "the floor line is on the cash card");
await act(async () => {
  pillarCash.querySelector("[data-cash-floor-cue]")?.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
});
assert(pillarFm === 1 && pillarOpens === 0, "the line opens FM and the card does not drill");
await act(async () => {
  pillarCash.click();
});
assert(pillarOpens === 1, "the rest of the card still drills");
await pillarStop();

const homePresence = steerAssignedWork(
  {
    agents: [
      { agent: "financial_manager", motion: "found", sentence: "Found.", lookAt: null, fmClip: null },
      { agent: "analyst", motion: "found", sentence: "Found.", lookAt: null, fmClip: null },
      { agent: "advisor", motion: "found", sentence: "Found.", lookAt: null, fmClip: null },
    ],
    handoff: null,
  },
  "advisor",
  null,
);
const homeStop = await mount(
  createElement(OwnerHome, {
    variant: "orb",
    presence: homePresence,
    lines: {
      financial_manager: ["Cash $4,335, $45,665 below your $50,000 minimum."],
      analyst: ["Gross profit is $241,000."],
      advisor: ["Move fixed contracts to variable / usage-based pricing."],
    },
    showInvite: false,
    marketCountry: "US",
    onOpen: () => undefined,
    onAsk: () => undefined,
  }),
);
const label = (agent: string) =>
  document.querySelector(`[data-agent-card="${agent}"] .owner-motion-label`)?.textContent ?? "";
assert(label("advisor") === "Working…", `advisor shows Working, saw ${label("advisor")}`);
assert(label("analyst") === "Found something", `analyst drops the previous Working, saw ${label("analyst")}`);
await homeStop();

const appSrc = readFileSync("src/routes/app.tsx", "utf8");
const cueAt = appSrc.indexOf("const ownerCashFloorCue");
assert(cueAt > 0 && appSrc.slice(cueAt, cueAt + 500).includes("cashflow:"), "owner Health passes the card cashflow");
const clientSrc = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(clientSrc.includes("cashFloorCue={homeBrief.healthCue}"), "accountant Health uses the brief floor line");
assert(
  clientSrc.includes('openHomeAgent("financial_manager")'),
  "the accountant cash line opens the Financial Manager",
);

const heroSrc = readFileSync("src/components/sphere-hero.tsx", "utf8");
assert(heroSrc.includes('variant === "orb" && level < 3'), "the big orb is not forced onto the owner ring drill");
assert(heroSrc.includes('variant !== "ring"'), "the pillar sphere is not on the owner driver page");
assert(heroSrc.includes("className=\"health-ring\""), "the top owner view keeps the ring");

console.log("owner-layout: health ring and cash detail");
