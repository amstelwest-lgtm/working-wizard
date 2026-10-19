/**
 * AQA practice findings: scroll must not navigate, unplaced note pins stay
 * in the tray, and the phone drawer scrolls without swallowing the wheel.
 * Run: pnpm test:aqa-practice-nav
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shouldNavigateForHashChange } from "../src/lib/content-scroll-navigation.ts";
import { noteShowsFloatingPin } from "../src/lib/note-pin.ts";
import { trendDelta30d } from "../src/lib/portfolio-dashboard.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  shouldNavigateForHashChange({ phase: "hashchange", scrolling: true }) === false,
  "a hashchange while scrolling does not navigate",
);
assert(
  shouldNavigateForHashChange({ phase: "hashchange", scrolling: false }) === false,
  "a hashchange after load does not navigate",
);
assert(
  shouldNavigateForHashChange({ phase: "load", scrolling: true }) === false,
  "the first paint still skips a fragment while a scroll is in progress",
);
assert(
  shouldNavigateForHashChange({ phase: "load", scrolling: false }) === true,
  "a legacy fragment on first load can still open its page",
);

assert(
  noteShowsFloatingPin({ x: 0, y: 0, ratioKey: null }) === false,
  "an unplaced note does not float an initial",
);
assert(
  noteShowsFloatingPin({ x: 0, y: 0, ratioKey: "current_ratio" }) === false,
  "a ratio note stays off the page pin layer",
);
assert(
  noteShowsFloatingPin({ x: 420, y: 260, ratioKey: null }) === true,
  "a placed note can still pin",
);

assert(trendDelta30d([], 70) === null, "no history is not a stable trend");
assert(
  trendDelta30d([{ period_date: null, score: 70 }], 70) === null,
  "one stored score is not a trend of zero",
);
assert(
  trendDelta30d(
    [
      { period_date: "2026-09-01", score: 60 },
      { period_date: "2026-10-01", score: 60 },
    ],
    60,
  ) === 0,
  "two equal stored scores are a real zero",
);

const read = (path: string) => readFileSync(resolve(path), "utf8");
const client = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(
  client.includes("shouldNavigateForHashChange"),
  "the client page asks before following a fragment",
);
assert(
  /addEventListener\("wheel", markScroll, \{ passive: true \}\)/.test(client),
  "the scroll watcher does not cancel the wheel",
);
assert(
  !/addEventListener\("wheel"[\s\S]{0,120}preventDefault/.test(client),
  "the client page does not preventDefault on wheel",
);

const nav = read("src/components/accountant-nav.tsx");
const closeAt = nav.indexOf("function closeIfLeaving");
const closeBody = nav.slice(closeAt, closeAt + 180);
assert(closeAt > 0, "the rail has a close-on-navigate helper");
assert(closeBody.includes("onNavigate?.()"), "choosing a page closes the phone menu");
assert(!closeBody.includes("items?.length"), "a heading with sub-items still closes the menu");
const drawer = nav.slice(nav.indexOf("export function useAccountantDrawer"));
assert(!/wheel/.test(drawer), "the phone drawer does not handle the wheel");
assert(
  drawer.includes('if (event.key !== "Tab") return'),
  "the drawer trap is for Tab, not the wheel",
);

const css = read("src/styles/accountant-portal.css");
assert(css.includes("overflow-y:auto"), "the phone menu can scroll");
assert(css.includes("height:100dvh"), "the phone menu is a bounded scrollport");
assert(css.includes("overscroll-behavior-y:contain"), "scrolling up does not walk history");
assert(
  css.includes("html:has(.accountant-portal:not(.owner-door))"),
  "history containment stays on the accountant portal",
);

const rail = read("src/components/practice-rail.tsx");
for (const path of [
  "/practice/needs-attention",
  "/practice/follow-up",
  "/practice/insights",
  "/practice/marketplace",
  "/practice/playbooks",
  "/clients/queries",
]) {
  assert(rail.includes(`to: "${path}"`), `${path} is a practice nav route`);
}
assert(!rail.includes('practice("needs-attention")'), "needs attention is not a practice anchor");
assert(!rail.includes("wizard-dash-queries"), "open queries is not a client-table anchor");

const board = read("src/components/practice-board.tsx");
assert(board.includes('view="queries"') || board.includes('view === "queries"'), "open queries has its own view");
assert(board.includes('title="Open queries"'), "open queries has its own page title");
assert(board.includes('title={PRACTICE_SECTION_TITLES[view]}'), "each practice section has its own page title");
assert(!board.includes("trendDelta ?? 0"), "the insights chart does not invent a flat trend");
assert(board.includes("listOpenQueries"), "open queries lists notes from the book");
assert(board.includes("actionIsOverdue"), "the practice board keeps the shared overdue predicate");

console.log("aqa-practice-nav-test: ok");
