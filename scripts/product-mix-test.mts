/**
 * Optional product-line mix on the Profit tab.
 * Run: pnpm test:product-mix
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  emptyDebtSchedule,
  mergeFinancialsBlob,
  splitFinancialsBlob,
} from "../src/lib/debt-schedule";
import { emptyWeeklyInputs, parseWeeklyInputs } from "../src/lib/weekly-inputs";
import {
  applyUnitEconomics,
  canAdvanceFromCosts,
  canAdvanceFromNames,
  canAdvanceFromPrices,
  canAdvanceFromShares,
  canSaveUnitMix,
  declinedProductMix,
  emptyProductMix,
  hasProductMixAnswer,
  linesFromNames,
  marginBandFromPct,
  overlayProductMix,
  parseProductMix,
  productMixSummary,
  rankProductLines,
  unitMarginPct,
} from "../src/lib/product-mix";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(parseProductMix(null).lines.length === 0, "null mix is empty");
assert(parseProductMix({ lines: "nope" }).active === false, "bad lines ignored");
assert(!hasProductMixAnswer(emptyProductMix()), "empty mix is unanswered");

const declined = declinedProductMix("2026-09-04T00:00:00.000Z");
assert(declined.active === false, "Q1 no → inactive");
assert(hasProductMixAnswer(declined), "declining still counts as answered");
assert(productMixSummary(declined).includes("One main line"), "declined summary");

assert(canAdvanceFromNames(["", "  "]) === false, "blank names blocked");
assert(canAdvanceFromNames(["Retail"]) === false, "one name is not a mix");
assert(canAdvanceFromNames(["Retail", "Wholesale"]) === true, "two distinct names ok");

const named = linesFromNames(["  Retail ", "Wholesale", "", "Events"], [
  { id: "keep", name: "Retail", shareBand: "half", sellPrice: 100, unitCost: 40 },
]);
assert(named.length === 3, "empty slots dropped");
assert(named[0].id === "keep", "matching name reuses id");
assert(named[0].sellPrice === 100, "retake keeps unit price");

assert(canAdvanceFromPrices(named) === false, "prices required on every named line");
named[0].sellPrice = 120;
named[1].sellPrice = 80;
named[2].sellPrice = 50;
assert(canAdvanceFromPrices(named) === true, "all named lines have a selling price");
assert(canAdvanceFromCosts(named) === false, "costs required");
named[0].unitCost = 40;
named[1].unitCost = 50;
named[2].unitCost = 45;
assert(canAdvanceFromCosts(named) === true, "all named lines have a unit cost");
assert(Math.abs((unitMarginPct(120, 40) ?? 0) - 66.666) < 0.01, "margin = (price-cost)/price");
assert(unitMarginPct(0, 10) == null, "zero price has no margin");
assert(marginBandFromPct(50) === "high", ">=40 is high");
assert(marginBandFromPct(25) === "mid", "20–39 is mid");
assert(marginBandFromPct(10) === "low", "<20 is low");

named[0].shareBand = "half";
named[1].shareBand = "quarter";
named[2].shareBand = "small";
assert(canAdvanceFromShares(named) === true, "share bands after unit economics");

const draft = {
  version: 2 as const,
  confirmedAt: null,
  active: true,
  lines: named,
};
assert(canSaveUnitMix(draft) === true, "save when names, prices, costs, shares are in");
assert(canSaveUnitMix({ ...draft, lines: named.map((l) => ({ ...l, sellPrice: undefined })) }) === false, "missing price blocks save");

const saved = applyUnitEconomics({
  ...draft,
  confirmedAt: "2026-09-04T00:00:00.000Z",
});
assert(Math.round(saved.lines.find((l) => l.id === named[0].id)?.marginPct ?? 0) === 67, "retail margin stamped");
assert(saved.bestLineId === named[0].id, "highest unit margin is best");
assert(saved.worstLineId === named[2].id, "lowest unit margin is worst");
assert(saved.lines.find((l) => l.id === named[0].id)?.marginBand === "high", "67% → high");
assert(saved.lines.find((l) => l.id === named[2].id)?.marginBand === "low", "10% → low");

const ranked = rankProductLines(saved);
assert(ranked[0].name === "Retail", "rank by unit margin, not sales share");
assert(ranked[0].isBest === true, "best badge on highest margin");
assert(ranked.find((r) => r.name === "Events")?.isWorst === true, "worst badge on lowest margin");
assert(productMixSummary(saved).includes("Retail"), "summary names best");
assert(productMixSummary(saved).includes("%"), "summary shows calculated margin");
assert(rankProductLines(declined).length === 0, "inactive mix has no bars");

const v1 = parseProductMix({
  version: 1,
  confirmedAt: "2026-01-01",
  active: true,
  lines: [{ id: "a", name: "Old", shareBand: "half" }],
});
assert(v1.lines[0]?.name === "Old", "v1 blobs still parse");
assert(v1.lines[0]?.sellPrice == null, "v1 lines have no unit price");

const weeks = parseWeeklyInputs({
  weeks: { "2026-W35": { revenue: 10, costOfSales: 4 } },
});
const blob = mergeFinancialsBlob(
  { revenue: "500000" },
  emptyDebtSchedule(),
  weeks,
  saved,
);
assert((blob.productMix as { lines: unknown[] }).lines.length === 3, "merge keeps mix");

const split = splitFinancialsBlob(blob);
assert(split.scalars.productMix == null, "mix is not stringified into scalars");
assert(split.productMix.lines[0]?.sellPrice === 120, "split restores unit price");
assert(split.productMix.lines[0]?.unitCost === 40, "split restores unit cost");

const accountantAutosave = mergeFinancialsBlob(
  split.scalars,
  split.debtSchedule,
  split.weeklyInputs,
  split.productMix,
);
const again = splitFinancialsBlob(accountantAutosave);
assert(again.productMix.bestLineId === named[0].id, "accountant autosave must not wipe mix");
assert(again.productMix.lines[0]?.marginPct != null, "computed margin survives merge");

const overlaid = overlayProductMix(
  { revenue: "500000", weeklyInputs: emptyWeeklyInputs(), debt_schedule: { lines: [{ amount: 1 }] } },
  saved,
);
assert(overlaid.revenue === "500000", "overlay keeps period scalars");
assert((overlaid.productMix as { lines: unknown[] }).lines.length === 3, "overlay writes mix");

const ownerSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(ownerSrc.includes("<ProductMixPanel"), "owner Profit tab mounts product mix");
assert(ownerSrc.includes("overlayProductMix"), "owner persists mix without wiping period P&L");

const accountantSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(accountantSrc.includes("<ProductMixPanel"), "accountant Profit tab mounts product mix");
assert(accountantSrc.includes("mergeFinancialsBlob(scalars, ds, weeks, mix)"), "accountant merge keeps mix");

const panelSrc = readFileSync(resolve("src/components/product-mix-panel.tsx"), "utf8");
assert(panelSrc.includes("Question {step + 1} of {TOTAL}"), "funnel is 5 questions");
assert(panelSrc.includes("Selling price per unit"), "Q3 is selling price");
assert(panelSrc.includes("Direct cost per unit"), "Q4 is unit cost");
assert(panelSrc.includes("choiceClass"), "selected options use a distinct class");
assert(panelSrc.includes("Selected"), "selected options are labelled");
assert(panelSrc.includes("border-2 border-[#d4a550]"), "selected state uses a stronger gold border");
assert(panelSrc.includes("applyUnitEconomics"), "save stamps calculated margin");
assert(!panelSrc.includes("Which has the best margin"), "best/worst are no longer asked");
assert(!panelSrc.includes("WeeklyInputTable"), "mix is not folded into weekly grid");

console.log("product-mix-test: ok");
