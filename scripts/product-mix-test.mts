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
  applyMarginFlags,
  canAdvanceFromNames,
  canAdvanceFromShares,
  canSaveRanking,
  declinedProductMix,
  emptyProductMix,
  hasProductMixAnswer,
  linesFromNames,
  overlayProductMix,
  parseProductMix,
  productMixSummary,
  rankProductLines,
  shareBandPct,
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
assert(canAdvanceFromNames(["Retail", "Wholesale", "Retail"]) === true, "duplicate names collapse to unique, need 2");
assert(canAdvanceFromNames(["Retail", "Retail"]) === false, "two identical names are one line");
assert(canAdvanceFromNames(["Retail", "Wholesale"]) === true, "two distinct names ok");

const named = linesFromNames(["  Retail ", "Wholesale", "", "Events"], [
  { id: "keep", name: "Retail", shareBand: "half" },
]);
assert(named.length === 3, "empty slots dropped, cap not hit");
assert(named[0].id === "keep", "matching name reuses id");
assert(named[0].shareBand === "half", "retake keeps share on renamed-same line");
assert(named[1].name === "Wholesale", "second line");

assert(canAdvanceFromShares(named) === false, "shares required before ranking");
named[0].shareBand = "half";
named[1].shareBand = "quarter";
named[2].shareBand = "small";
assert(canAdvanceFromShares(named) === true, "all named lines have a band");

const draft = {
  version: 1 as const,
  confirmedAt: null,
  active: true,
  lines: named,
  bestLineId: named[0].id,
  worstLineId: named[0].id,
};
assert(canSaveRanking(draft) === false, "best and worst must differ");
draft.worstLineId = named[2].id;
assert(canSaveRanking(draft) === true, "distinct best/worst");
assert(canSaveRanking({ ...draft, bestLineId: "missing" }) === false, "best must be a named line");

const saved = applyMarginFlags({
  ...draft,
  confirmedAt: "2026-09-04T00:00:00.000Z",
});
assert(saved.lines.find((l) => l.id === named[0].id)?.marginBand === "high", "best → high");
assert(saved.lines.find((l) => l.id === named[2].id)?.marginBand === "low", "worst → low");
assert(saved.lines.find((l) => l.id === named[1].id)?.marginBand === "mid", "others → mid");

const ranked = rankProductLines(saved);
assert(ranked[0].name === "Retail", "rank by share (half first)");
assert(ranked[0].isBest === true, "best badge on strongest margin, even if also largest");
assert(ranked.find((r) => r.name === "Events")?.isWorst === true, "worst badge");
assert(shareBandPct("quarter") === 25, "quarter band");
assert(productMixSummary(saved).includes("Retail strongest"), "summary names best");
assert(productMixSummary(saved).includes("Events needs a look"), "summary names worst");
assert(rankProductLines(declined).length === 0, "inactive mix has no bars");

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
assert((blob.weeklyInputs as { weeks: Record<string, unknown> }).weeks["2026-W35"] != null, "merge keeps weeks");

const split = splitFinancialsBlob(blob);
assert(split.scalars.productMix == null, "mix is not stringified into scalars");
assert(split.productMix.lines[0]?.name === "Retail", "split restores mix");
assert(split.weeklyInputs.weeks["2026-W35"].revenue === 10, "split still restores weeks");

const accountantAutosave = mergeFinancialsBlob(
  split.scalars,
  split.debtSchedule,
  split.weeklyInputs,
  split.productMix,
);
const again = splitFinancialsBlob(accountantAutosave);
assert(again.productMix.bestLineId === named[0].id, "accountant autosave must not wipe mix");
assert(again.productMix.lines.length === 3, "accountant autosave keeps lines");

const wiped = mergeFinancialsBlob(split.scalars, split.debtSchedule, split.weeklyInputs);
assert(
  (wiped.productMix as { lines: unknown[] }).lines.length === 0,
  "3-arg merge defaults to empty mix — callers must pass the 4th arg",
);

const overlaid = overlayProductMix(
  { revenue: "500000", weeklyInputs: emptyWeeklyInputs(), debt_schedule: { lines: [{ amount: 1 }] } },
  saved,
);
assert(overlaid.revenue === "500000", "overlay keeps period scalars");
assert((overlaid.debt_schedule as { lines: unknown[] }).lines.length === 1, "overlay keeps debt");
assert((overlaid.productMix as { lines: unknown[] }).lines.length === 3, "overlay writes mix");

const ownerSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(ownerSrc.includes("<ProductMixPanel"), "owner Profit tab mounts product mix");
assert(ownerSrc.includes("overlayProductMix"), "owner persists mix without wiping period P&L");
assert(ownerSrc.includes("parseProductMix(fin.productMix)"), "owner hydrates mix");
assert(ownerSrc.includes("productMix, saveProductMix"), "owner context exposes mix");

const accountantSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(accountantSrc.includes("<ProductMixPanel"), "accountant Profit tab mounts product mix");
assert(accountantSrc.includes("productMix: mix"), "accountant load splits productMix from the blob");
assert(accountantSrc.includes("mergeFinancialsBlob(scalars, ds, weeks, mix)"), "accountant merge keeps mix");

const panelSrc = readFileSync(resolve("src/components/product-mix-panel.tsx"), "utf8");
assert(panelSrc.includes("Question {step + 1} of {TOTAL}"), "funnel is 5 questions");
assert(panelSrc.includes("useState(false)"), "panel collapsed by default");
assert(panelSrc.includes("Break down by product line"), "empty CTA");
assert(!panelSrc.includes("WeeklyInputTable"), "mix is not folded into weekly grid");

console.log("product-mix-test: ok");
