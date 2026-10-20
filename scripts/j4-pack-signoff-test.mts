/**
 * J4 repeat: a pack is one snapshot, and Health and the scorecard share a sign-off.
 * Run: pnpm test:j4-pack-signoff
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { packAsGeneratedLabel, packSectionsForPdf } from "../src/lib/advisory-pack.ts";
import { reportFetchPlan, studioSignoffState } from "../src/lib/report-load.ts";
import { presentPageSignoff } from "../src/lib/signoff-status.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

const stored = packSectionsForPdf([
  {
    key: "headline",
    title: "In one line",
    body: "Overview health is 84 (Healthy).",
  },
  {
    key: "state_of_business",
    title: "Overview figures",
    body: "OVERVIEW FIGURES\nHealth: 84 (Healthy)\nFinancing: 100",
  },
  {
    key: "data_gaps",
    title: "What MILŌN still needs",
    body: "Nothing outstanding. The figures in this pack are as complete as MILŌN can make them.",
  },
  {
    key: "cash",
    title: "Cash",
    body: "The comfort floor is $50,000.",
  },
]);

const narrative = stored.find((section) => section.key === "headline")?.body ?? "";
const figures = stored.find((section) => section.key === "state_of_business")?.body ?? "";
const gaps = stored.find((section) => section.key === "data_gaps")?.body ?? "";
const cash = stored.find((section) => section.key === "cash")?.body ?? "";

assert(narrative.includes("Overview health is 84 (Healthy)"), narrative);
assert(!narrative.includes("83"), narrative);
assert(figures.includes("Health: 84 (Healthy)"), figures);
assert(figures.includes("Financing: 100"), figures);
assert(!figures.includes("90"), figures);
assert(narrative.includes("84") && figures.includes("84"), "narrative and figures share the stored health");
assert(/Nothing outstanding/i.test(gaps), gaps);
assert(cash.includes("$50,000"), cash);

assert(
  packAsGeneratedLabel("Oct 20, 2026, 9:25 AM ET") === "as generated on Oct 20, 2026, 9:25 AM ET",
  "generated-on label",
);
assert(packAsGeneratedLabel("—") === null, "an em dash is not a date");
assert(packAsGeneratedLabel("  ") === null, "blank is not a date");
assert(packAsGeneratedLabel(null) === null, "missing is not a date");

const packSrc = read("src/lib/advisory-pack.ts");
const packFn = packSrc.slice(packSrc.indexOf("export function packSectionsForPdf"));
const packFnBody = packFn.slice(0, packFn.indexOf("\nexport function "));
assert(!packFnBody.includes("overlayLiveHealthProse"), "pack display does not overlay live health");
assert(!packFnBody.includes("alignPackFloorCopy"), "pack display does not overlay the live floor");
assert(!packFnBody.includes("overlayStillNeeds"), "pack display does not append live gaps");

const panel = read("src/components/advisory-pack-panel.tsx");
assert(panel.includes("packAsGeneratedLabel"), "the stale banner names when the pack was generated");
assert(panel.includes("data-pack-stale"), "the stale banner stays");
assert(!panel.includes("setLiveHealth"), "the panel does not fetch a live score of its own");
assert(panel.includes("liveHealth"), "the page snapshot is the pack's score source");
assert(!panel.includes("overlayLiveHealthProse"), "the panel does not splice scores into stored prose");

const pdf = read("src/lib/advisory-pack-pdf.ts");
assert(pdf.includes("packAsGeneratedLabel"), "the PDF stale notice names the snapshot date");
assert(pdf.includes("liveHealth"), "the PDF uses the same snapshot");
assert(!pdf.includes("overlayLiveHealthProse"), "the PDF does not splice scores into stored prose");

const signedLine = presentPageSignoff({
  scope: "financials",
  hasSignoff: true,
  isStale: false,
  name: "James Fleming",
  date: "Oct 20, 2026, 9:25 AM ET",
});
assert(
  signedLine === "Financials: signed off by James Fleming · Oct 20, 2026, 9:25 AM ET",
  signedLine,
);

const row = { id: "sign-1", signed_off_by_name: "James Fleming" };
const clean = studioSignoffState({
  signoffsKnown: true,
  known: { financials: row },
  knownStale: { financials: false },
  scope: "financials",
  loaded: null,
  computedStale: true,
});
assert(clean.signoff === row, "a known sign-off wins over a missing studio row");
assert(clean.isStale === false, "the parent's stale bit wins over a null-row true");
const healthClean = presentPageSignoff({
  scope: "financials",
  hasSignoff: Boolean(clean.signoff),
  isStale: clean.isStale,
  name: row.signed_off_by_name,
  date: "Oct 20, 2026, 9:25 AM ET",
});
const scorecardClean = presentPageSignoff({
  scope: "financials",
  hasSignoff: Boolean(clean.signoff),
  isStale: clean.isStale,
  name: row.signed_off_by_name,
  date: "Oct 20, 2026, 9:25 AM ET",
});
assert(healthClean === scorecardClean && healthClean === signedLine, healthClean);

const changed = studioSignoffState({
  signoffsKnown: true,
  known: { financials: row },
  knownStale: { financials: true },
  scope: "financials",
  loaded: null,
  computedStale: false,
});
const changedLine = presentPageSignoff({
  scope: "financials",
  hasSignoff: Boolean(changed.signoff),
  isStale: changed.isStale,
  name: row.signed_off_by_name,
  date: "Oct 20, 2026, 9:25 AM ET",
});
assert(changedLine === "Signed off by James Fleming · figures changed since, re-review", changedLine);
assert(!changedLine.toLowerCase().includes("draft"), changedLine);

const unsigned = studioSignoffState({
  signoffsKnown: true,
  known: {},
  scope: "financials",
  loaded: row,
  computedStale: true,
});
assert(unsigned.signoff === null, "once sign-offs are known, a missing scope is unsigned");
assert(
  presentPageSignoff({
    scope: "financials",
    hasSignoff: false,
    isStale: unsigned.isStale,
  }) === "Financials: draft",
  "unsigned is draft, not figures changed",
);

const scorecardPlan = reportFetchPlan(["scorecard"]);
assert(
  scorecardPlan.benchmarks === false &&
    scorecardPlan.budget === false &&
    scorecardPlan.cashWorkflow === false,
  "a scorecard embed skips benchmarks, budget, and the cash workflow",
);
assert(reportFetchPlan(["forecast"]).cashWorkflow === true, "the forecast embed still loads cash workflow");
assert(reportFetchPlan(["budget"]).budget === true, "the budget embed still loads budget actuals");
assert(reportFetchPlan(["benchmark"]).benchmarks === true, "the benchmark embed still loads benchmarks");
assert(reportFetchPlan(undefined).benchmarks && reportFetchPlan([]).budget, "the full catalogue still loads everything");

const studio = read("src/routes/_authenticated/reports-studio.tsx");
assert(studio.includes("reportFetchPlan("), "the studio uses the fetch plan");
assert(studio.includes("studioSignoffState"), "the card and the PDF stamp share the known sign-off");
assert(!studio.includes("if (!signoff) return true"), "a missing sign-off is not stale");
const client = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(client.includes("knownSignoffs={reviewSignoffs}"), "Health's sign-off rows are passed into the scorecard");
assert(client.includes("knownSignoffStale={reportSignoffStale}"), "Health's stale bits are passed into the scorecard");
assert(client.includes("signoffsKnown={signoffsKnown}"), "the scorecard waits for the shared load");

const chip = read("src/components/signoff-status-chip.tsx");
const button = read("src/components/review-signoff.tsx");
assert(chip.includes("presentPageSignoff"), "Health uses the shared sign-off sentence");
assert(button.includes("presentPageSignoff"), "the scorecard uses the shared sign-off sentence");

const owner = read("src/routes/app.tsx");
assert(owner.includes("AdvisoryPackPanel"), "owner Next moves uses the shared pack panel");
assert(!owner.includes("ReportsStudio"), "owner has no second scorecard");

console.log("j4-pack-signoff ok");
