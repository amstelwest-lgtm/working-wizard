/**
 * Health, Pillars, and Profitability answer strips: one status, one chip.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { healthHeadline } from "../src/lib/client-briefing";
import { deliverableDrawerHint } from "../src/components/deliverable-answer-strip";
import { figureSourceChipLabel, figureSourcePhrase, showFigureSourceChip } from "../src/lib/ledger-link-copy";
import { healthAnswerSentence } from "../src/lib/overview-insights";
import { legacyPaneForSearch } from "../src/lib/client-route-search";
import { profitAnswerSentence } from "../src/components/profitability-waterfall";

assert(!showFigureSourceChip(null), "a missing source is not a chip");
assert(!showFigureSourceChip(""), "a blank source is not a chip");
assert(!showFigureSourceChip("   "), "whitespace is not a chip");
assert(showFigureSourceChip("xero"), "a saved Xero statement is a chip");
assert(figureSourcePhrase("xero") === "a saved Xero statement", "xero maps through figureSourcePhrase");
assert(figureSourcePhrase("upload") === "an uploaded statement", "the sentence phrase stays lowercase");
assert(figureSourcePhrase("") === "figures already on file", "the phrase still exists for other callers");
assert(figureSourceChipLabel(null) === null, "a missing source has no chip label");
assert(figureSourceChipLabel("") === null, "a blank source has no chip label");
assert(figureSourceChipLabel("upload") === "Uploaded statement", "an upload is a short chip");
assert(figureSourceChipLabel("pdf_upload") === "Uploaded statement", "a pdf upload is the same chip");
assert(figureSourceChipLabel("qbo") === "QuickBooks", "QuickBooks is a short chip");
assert(figureSourceChipLabel("xero") === "Xero", "Xero is a short chip");
assert(figureSourceChipLabel("sage") === "Sage", "Sage is a short chip");
assert(figureSourceChipLabel("bank_pack") === "Bank", "a bank import matches Cash's chip");
assert(healthHeadline(null, "Watch") === "Not scored yet", "an empty caption can fall back to the headline");

const pillars = [
  { label: "Profit", score: 67, status: "at_risk" as const },
  { label: "Cash", score: 85, status: "healthy" as const },
];
assert(
  healthAnswerSentence({
    caption: "Watch. Start with the priority below.",
    score: 76,
    bandLabel: "Watch",
    pillars,
    includeScore: false,
  }) === "Profit is the weakest pillar; Cash is strong.",
  "health leaves the score on the orb",
);
assert(
  healthAnswerSentence({
    caption: "Watch. Start with the priority below.",
    score: 76,
    bandLabel: "Watch",
    pillars,
    includeScore: true,
  }) === "76, Watch: Profit is the weakest pillar; Cash is strong.",
  "pillars can carry the score because the orb is gone",
);
assert(
  healthAnswerSentence({
    caption: "Watch. Cash conversion is holding the score back.",
    score: 76,
    bandLabel: "Watch",
    pillars,
    includeScore: false,
  }) === "Cash conversion is holding the score back.",
  "a specific caption stays, without repeating the band",
);

const month = profitAnswerSentence({
  currency: "R",
  periodLabel: "September 2026",
  preferPeriod: true,
});
assert(
  month === "How R1 of revenue becomes profit · Month to date · September 2026",
  "the profit sentence keeps the period and drops the source words",
);
assert(
  profitAnswerSentence({ currency: "R" }) === "How R1 of revenue becomes profit",
  "the profit sentence stands alone when there is no period",
);
assert(
  profitAnswerSentence({
    currency: "$",
    periodLabel: "Sep 2026",
    revenueText: "$700k",
    netMarginPct: 8.6,
    grossMarginPct: 60,
  }) === "Net margin 8.6% on $700k revenue for Sep 2026. Gross margin 60.0%.",
  "the profit sentence leads with the loaded margins",
);
for (const banned of ["the ledger", "aggregated weekly data", "period inputs"]) {
  assert(!month.includes(banned), `profit sentence omits ${banned}`);
}

assert(deliverableDrawerHint("ratios", {}).includes("assumption"), "health drawer names its assumptions");
assert(deliverableDrawerHint("profit", {}).includes("assumption"), "profit drawer names its assumptions");

assert(legacyPaneForSearch({ tab: "overview", section: "health" }) === "ratios", "health stays on the ratios pane");
assert(legacyPaneForSearch({ tab: "overview", section: "pillars" }) === "ratios", "pillars stay on the ratios pane");
assert(legacyPaneForSearch({ tab: "overview", section: "profit" }) === "profit", "profit stays on its pane");

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
const strip = readFileSync(resolve("src/components/deliverable-answer-strip.tsx"), "utf8");
const waterfall = readFileSync(resolve("src/components/profitability-waterfall.tsx"), "utf8");
const owner = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const sage = readFileSync(resolve("src/components/sage-connect.tsx"), "utf8");
const portalCss = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");

const ratiosPane = sliceBetween(route, 'id="pane-ratios"', 'id="pane-profit"');
const profitPane = sliceBetween(route, 'id="pane-profit"', 'id="pane-cash"');

assert(count(strip, "<SignoffStatusChip") === 1, "the shared strip renders one status");
assert(count(ratiosPane, "<DeliverableAnswerStrip") === 1, "health and pillars share one strip");
assert(count(profitPane, "<DeliverableAnswerStrip") === 1, "profit has one strip");
assert(ratiosPane.includes('scope="financials"'), "health status is the financials scope");
assert(profitPane.includes('scope="profitability"'), "profit status is the profitability scope");
assert(count(ratiosPane, "<ReviewSignoffButton") === 0, "health does not render a second sign-off status");
assert(count(profitPane, "<ReviewSignoffButton") === 0, "profit does not render a second sign-off status");
assert(strip.includes("hideStatus"), "the gold button does not repeat the status line");
assert(strip.includes("data-source-chip"), "the strip can show one source chip");
assert(strip.includes("{chip ?"), "a blank chip is omitted");
assert(route.includes("const healthChip = figureSourceChipLabel"), "health uses the chip label");
assert(ratiosPane.includes("chip={healthChip}"), "health strip receives that chip");
assert(profitPane.includes("chip={healthChip}"), "profit uses the chip label");
assert(
  profitPane.includes("Period dates missing; this may cover more than one month."),
  "a missing period does not tell the user to sync",
);
assert(!profitPane.includes("Sync QuickBooks again"), "profit does not ask for another sync");
assert(ratiosPane.includes('search.focus === "pillars" ? null'), "pillars skip the orb");
assert(profitPane.includes('aria-label="Export PDF"'), "profit export sits on the strip");
assert(profitPane.includes("hideCardExport"), "the waterfall card does not repeat export");
assert(!waterfall.includes("ChevronUp"), "the chart collapse chevron is gone");
assert(!waterfall.includes("ChevronDown"), "the chart collapse chevron is gone");
assert(ratiosPane.includes("<ReviewInputsDrawer"), "health inputs sit in the shared drawer");
assert(profitPane.includes("<ReviewInputsDrawer"), "profit inputs sit in the shared drawer");
assert(ratiosPane.includes("hideCaption"), "the orb does not repeat the sentence");
assert(profitPane.includes("hideLead"), "the waterfall card does not repeat the title");
assert(ratiosPane.includes("Auto-saved"), "auto-saved stays a save confirmation");
assert(!ratiosPane.includes("every ratio recalculates live"), "live-recalc wording is gone");
assert(!ratiosPane.includes("scaled to a 12-month equivalent"), "the period tooltip is plain words");
assert(ratiosPane.includes("stretched across a full year"), "the period tooltip says what the stretch does");
assert(!profitPane.includes("step by step"), "step by step is gone");
assert(!profitPane.includes("Full financials"), "full financials is plain words");
assert(profitPane.includes("All figures"), "the health-figures link says all figures");
assert(!profitPane.includes("client management"), "the inputs hint does not say client management");
assert(profitPane.includes("weekly figures the owner enters stay on their board"), "owner weeks stay on their board");
for (const banned of ["aggregated weekly data", "period inputs", "the ledger", "step by step"]) {
  assert(!waterfall.includes(banned), `waterfall omits ${banned}`);
}
assert(waterfall.includes("export function profitAnswerSentence"), "the sentence stays the existing subtitle");
assert(waterfall.includes("Month to date"), "month to date stays a period label");

for (const label of ["Business Health", "Profit", "Cash Forecast", "Budget", "Next moves", "Action Plan"]) {
  assert(owner.includes(`label: "${label}"`), `owner tab ${label} stays`);
}
assert(!sage.includes("DeliverableAnswerStrip"), "sage connect is untouched");
const drawerRule = portalCss.slice(portalCss.indexOf(".review-inputs{"), portalCss.indexOf(".review-inputs__summary"));
assert(drawerRule.includes("margin:0 0 16px"), "the drawer keeps a 16px gap under it");
assert(owner.includes("stretched across a full year"), "the owner period tooltip uses the same plain words");

console.log("answer-strip health + profit ok");
