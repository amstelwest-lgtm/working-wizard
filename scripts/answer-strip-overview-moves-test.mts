/**
 * Overview and Moves answer strips.
 * Overview shows the financials status. Moves has no review scope, so it omits status.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { healthHeadline, whatMatters } from "../src/lib/client-briefing";
import { figureSourceChipLabel } from "../src/lib/ledger-link-copy";
import { OVERVIEW_SECTION_TABS } from "../src/components/client-studio-chrome";
import { rankStrategicMoves } from "../src/lib/strategic-moves";
import {
  MOVES_EMPTY_SENTENCE,
  OVERVIEW_CARD_ORDER,
  movesAnswerSentence,
  overviewAnswerSentence,
  overviewSectionCards,
} from "../src/lib/overview-moves-copy";
import type { VarianceChip } from "../src/lib/prior-period";

function chip(partial: Pick<VarianceChip, "key" | "current" | "prior" | "delta" | "status">): VarianceChip {
  return {
    label: partial.key,
    higherIsBetter: true,
    unit: "number",
    ...partial,
  };
}

const slipped = whatMatters({
  healthScore: 50,
  healthStatus: "at_risk",
  chips: [
    chip({ key: "revenue", current: 90, prior: 100, delta: -10, status: "down" }),
    chip({ key: "om", current: 0.04, prior: 0.08, delta: -0.04, status: "down" }),
  ],
  cashRunwayWeeks: 20,
  profile: null,
  hasFigures: true,
})!;
assert(
  slipped ===
    "Revenue and operating margin both slipped against the prior period. Understand whether this is volume, price or cost before the client reacts.",
  `slipped sentence: ${slipped}`,
);
assert(!slipped.includes("client management"), "the slipped sentence does not say client management");

const critical = whatMatters({
  healthScore: 20,
  healthStatus: "critical",
  chips: [],
  cashRunwayWeeks: 20,
  profile: null,
  hasFigures: true,
  ratios: {},
})!;
assert(
  critical ===
    "Several indicators are weak at the same time. Start with cash, then profitability — this is a month for a focused conversation with the client.",
  `critical sentence: ${critical}`,
);
assert(!critical.includes("client management"), "the critical sentence does not say client management");

assert(
  overviewAnswerSentence({ whatMatters: slipped, score: 50, label: "Watch" }) === slipped,
  "overview uses the what-matters line already on the page",
);
assert(
  overviewAnswerSentence({ whatMatters: null, score: 72, label: "Stable" }) === healthHeadline(72, "Stable"),
  "overview falls back to the health headline",
);
assert(
  overviewAnswerSentence({ whatMatters: "  ", score: null, label: "Stable" }) === "Not scored yet",
  "a blank what-matters line uses the unscored headline",
);

assert(figureSourceChipLabel("upload") === "Uploaded statement", "overview chips an upload like Health");
assert(figureSourceChipLabel(null) === null, "a missing source is not a chip");

assert.deepEqual(
  [...OVERVIEW_CARD_ORDER],
  ["health", "cash", "profit", "collections", "payables", "budget", "moves", "books"],
  "overview cards stay in the CoS order",
);
const cards = overviewSectionCards({
  health: "72 / 100 · Stable",
  cash: "11 weeks",
  collections: "R 92 000",
  moves: "Invoice the same day work is done",
});
assert.deepEqual(
  cards.map((card) => card.id),
  [...OVERVIEW_CARD_ORDER],
  "rendering keeps that card order",
);
assert.deepEqual(
  cards.filter((card) => card.figure).map((card) => [card.id, card.figure]),
  [
    ["health", "72 / 100 · Stable"],
    ["cash", "11 weeks"],
    ["collections", "R 92 000"],
    ["moves", "Invoice the same day work is done"],
  ],
  "a card shows the figure it was given and omits a blank one",
);
assert.deepEqual(
  OVERVIEW_SECTION_TABS.map((row) => row.id),
  ["health", "pillars", "cash", "profit", "collections", "payables", "budget", "moves", "books"],
  "the section tab list still includes pillars",
);

assert(movesAnswerSentence([]) === MOVES_EMPTY_SENTENCE, "an empty move list keeps its sentence");
const ranked = rankStrategicMoves({
  healthByKey: { debtorDays: 40, creditorDays: 70 },
  limit: 2,
});
assert(ranked.length === 2, "the fixture ranks two moves");
assert(
  movesAnswerSentence(ranked) === `2 moves. ${ranked[0]!.title}`,
  "without a rand impact the sentence is the count and the first title",
);
assert(!movesAnswerSentence(ranked).includes("R "), "the count sentence does not invent a rand amount");
assert(
  movesAnswerSentence([{ title: "Invoice the same day work is done" }], "+R14k additional cash") ===
    "Invoice the same day work is done. +R14k additional cash",
  "a rand impact already computed is named with the top move",
);

function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

function sliceBetween(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  assert(from !== -1 && to > from, `${start} precedes ${end}`);
  return src.slice(from, to);
}

const route = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const moves = readFileSync(resolve("src/components/strategic-moves-panel.tsx"), "utf8");
const arap = readFileSync(resolve("src/components/arap-answer-strip.tsx"), "utf8");
const deliverable = readFileSync(resolve("src/components/deliverable-answer-strip.tsx"), "utf8");
const statusChip = readFileSync(resolve("src/components/signoff-status-chip.tsx"), "utf8");
const nextStep = readFileSync(resolve("src/lib/next-step.ts"), "utf8");
const owner = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const portalCss = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");
const overviewPane = sliceBetween(route, 'id="pane-overview"', 'id="pane-summary"');
const movesPane = sliceBetween(route, 'id="pane-moves"', 'id="pane-ask"');

assert(overviewPane.includes("<DeliverableAnswerStrip"), "overview has one answer strip");
assert(count(overviewPane, "<DeliverableAnswerStrip") === 1, "overview does not add a second strip");
assert(overviewPane.includes('scope="financials"'), "overview uses the existing financials sign-off");
assert(!overviewPane.includes("canSign"), "overview does not put Sign off on the strip");
assert(deliverable.includes("<SignoffStatusChip"), "the financials strip shows the shared status");
assert(statusChip.includes("data-signoff-status"), "the shared status uses the one vocabulary");
assert(overviewPane.includes("figureSourceChipLabel(statementMeta.statementSource)"), "overview chips the statement source");
assert(!overviewPane.includes('figureSourceChipLabel("statement")'), "overview does not invent a Statement chip");
assert(overviewPane.includes("sentence={overviewSentence}"), "the overview sentence is the existing what-matters line");
assert(route.includes("overviewAnswerSentence({"), "that sentence is what matters, or the health headline");
assert(overviewPane.includes("data-next-step-cta={overviewNextStep.key}"), "the primary is the existing next step");
assert(overviewPane.includes("hideCta"), "the next-step card does not keep a second gold button");
assert(overviewPane.includes("<ReviewInputsDrawer"), "secondary links sit in the closed drawer");
assert(overviewPane.includes("<OverviewSectionCards"), "overview keeps the jump cards");
assert(overviewPane.includes("hideWhatMatters"), "the briefing does not repeat the strip sentence");
assert(!overviewPane.includes("client management"), "overview does not say client management");
assert(!overviewPane.includes(">Audited<"), "the overview pane does not say Audited");
assert(!route.includes('className="aud">Audited'), "the crumb no longer says Audited");

assert(movesPane.includes("<StrategicMovesPanel"), "moves still renders the ranked list");
assert(!movesPane.includes("From strategic moves"), "the moves pane drops that label");
assert(!movesPane.includes("DeliverableTabHead"), "the moves tab head is the strip");
assert(moves.includes("<ArapAnswerStrip"), "moves uses the no-scope strip");
assert(!moves.includes("data-signoff-status"), "moves omits the status pill");
assert(!moves.includes("SignoffStatusChip"), "moves does not invent a sign-off scope");
assert(!arap.includes("data-signoff-status"), "the shared no-scope strip has no status");
assert(moves.includes("movesAnswerSentence(moves)"), "the moves sentence does not add a rand figure");
assert(!moves.includes("computeNextMoveImpactLabel"), "moves does not compute a new rand impact");
assert(!moves.includes("toFixed"), "the row meta drops the health percent");
assert(!moves.includes("From strategic moves"), "the moves panel drops that label");
assert(moves.includes('tone="strip"'), "the first move keeps the add-to-plan primary");
assert(moves.includes('tone="quiet"'), "later moves are not a second gold button");
assert(moves.includes("<ReviewInputsDrawer"), "move assumptions sit in the drawer");
assert(moves.includes('hint="Assumptions"'), "the drawer names the assumptions");

assert(nextStep.includes('from "./advisory-state.ts"'), "next-step keeps its advisory import");
assert(nextStep.includes('from "./data-requests.ts"'), "next-step keeps its data-requests import");

for (const label of ["Business Health", "Profit", "Cash Forecast", "Budget", "Next moves", "Action Plan"]) {
  assert(owner.includes(`label: "${label}"`), `owner tab ${label} stays`);
}
const drawerRule = portalCss.slice(portalCss.indexOf(".review-inputs{"), portalCss.indexOf(".review-inputs__summary"));
assert(drawerRule.includes("margin:0 0 16px"), "the drawer keeps a 16px gap under it");
assert(portalCss.includes(".answer-strip__primary{width:100%;justify-content:center}"), "the gold primary is full width on a phone");

console.log("answer-strip overview + moves ok");
