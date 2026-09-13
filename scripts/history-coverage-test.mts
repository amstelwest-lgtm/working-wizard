/**
 * Past-period coverage + upload copy.
 * Run: pnpm test:history-coverage
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PAST_PERIOD_UPLOAD_ACCEPTS,
  PAST_PERIOD_UPLOAD_LEAD,
  buildRatioSeries,
  distinctPeriodCount,
  historyCoverageQuestionStates,
  needsPastPeriodPrompt,
  ratioFromSnapshot,
} from "../src/lib/history-coverage";
import {
  currentPeriodDate,
  periodDateFromUnknown,
  periodLabelFromDate,
} from "../src/lib/financial-snapshots";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(periodLabelFromDate("2025-03-31").includes("2025"), "label keeps the year");
assert(periodDateFromUnknown("2024-12-31T12:00:00Z") === "2024-12-31", "ISO date trims");
assert(periodDateFromUnknown("not-a-date") === currentPeriodDate(), "bad date falls back to today");

const one = [{ period_date: "2026-09-01", period_label: "Sep 2026", ratios: { "Gross Margin": 0.4 } }];
const two = [
  ...one,
  { period_date: "2025-09-01", period_label: "Sep 2025", ratios: { "Gross Profit Margin": 0.35 } },
];
assert(distinctPeriodCount(one) === 1, "one period");
assert(distinctPeriodCount(two) === 2, "two periods");
assert(needsPastPeriodPrompt({ hasLiveFigures: true, snapshots: one }), "prompt when only one period");
assert(
  !needsPastPeriodPrompt({ hasLiveFigures: true, snapshots: two }),
  "no prompt once two periods exist",
);
assert(
  !needsPastPeriodPrompt({ hasLiveFigures: false, snapshots: one }),
  "no history prompt before first figures",
);
assert(
  !needsPastPeriodPrompt({ hasLiveFigures: true, firstRunBusy: true, snapshots: one }),
  "no history prompt during first-run",
);

assert(ratioFromSnapshot(two[1]!.ratios, "Gross Margin") === 0.35, "alias Gross Profit Margin");
const series = buildRatioSeries(one, "Gross Margin", 0.42);
assert(series.length === 2 && series[0] === 0.4 && series[1] === 0.42, "append live current");
assert(buildRatioSeries(one, "Gross Margin", 0.4).length === 1, "do not duplicate identical live");

const drip = historyCoverageQuestionStates({
  snapshotCount: 1,
  hasLiveFigures: true,
  deferForCoreProfile: true,
});
assert(drip.length === 0, "drip waits until core profile is done");
const ready = historyCoverageQuestionStates({ snapshotCount: 1, hasLiveFigures: true });
assert(ready[0]?.key === "history.prior_period", "history drip key");
assert(!ready[0]?.answered, "unanswered until 2 periods");

assert(PAST_PERIOD_UPLOAD_LEAD.includes("Whatever you already have"), "wide invite");
assert(PAST_PERIOD_UPLOAD_ACCEPTS.length >= 4, "several acceptable packs");
assert(
  PAST_PERIOD_UPLOAD_ACCEPTS.some((l) => /bank/i.test(l)),
  "bank statements are welcome",
);
assert(
  PAST_PERIOD_UPLOAD_ACCEPTS.some((l) => /P&L|annual/i.test(l)),
  "prior-year P&L is welcome",
);

const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(app.includes('grossMargin: "Gross Margin"'), "owner series reads the stored gross margin key");
assert(app.includes("PastPeriodUploadDialog"), "owner board has the past-period box");
assert(app.includes("buildRatioSeries"), "owner trends use shared series helper");
assert(app.includes("Saved ${saved.periodLabel} as history"), "history-only confirm does not replace live");

const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(studio.includes("historyOnlyUploadRef"), "accountant can save history without touching live");
assert(studio.includes("movementReportAvailable={Boolean(priorSnapshot)}"), "movement CTA is honest");
assert(studio.includes("PastPeriodUploadDialog"), "accountant studio has the past-period box");

const snapSrc = readFileSync(resolve("src/lib/financial-snapshots.ts"), "utf8");
assert(snapSrc.includes("upsertPeriodSnapshot"), "period-true upsert exists");
assert(snapSrc.includes(".eq(\"period_date\""), "upsert matches on period_date first");

const dripSrc = readFileSync(resolve("src/components/owner-brain-drip.tsx"), "utf8");
assert(dripSrc.includes("AddPastPeriodLink"), "drip history question has an upload link");

console.log("history-coverage-test: ok");
