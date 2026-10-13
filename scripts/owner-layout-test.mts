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
const { SphereHero } = await import("../src/components/sphere-hero");
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
    caption: "Tap to see what's behind your score",
  });
}

function counts() {
  return {
    ring: document.querySelectorAll(".health-ring").length,
    orb: document.querySelectorAll(".health-orb").length,
  };
}

const owner = await mount(hero("ring"));
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
const profit = [...document.querySelectorAll("button")].find((button) =>
  button.getAttribute("aria-label")?.startsWith("Profit score"),
);
assert(profit instanceof HTMLButtonElement, "the profit pillar stays a button");
await act(async () => {
  profit.click();
});
await tick();
assert(counts().ring === 0 && counts().orb === 0, "the driver page hides the health ring and orb");
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

const heroSrc = readFileSync("src/components/sphere-hero.tsx", "utf8");
assert(heroSrc.includes('variant === "orb" && level < 3'), "the big orb is not forced onto the owner ring drill");
assert(heroSrc.includes('variant !== "ring"'), "the pillar sphere is not on the owner driver page");
assert(heroSrc.includes("className=\"health-ring\""), "the top owner view keeps the ring");

console.log("owner-layout: health ring and cash detail");
