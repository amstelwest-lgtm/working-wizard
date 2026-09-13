/**
 * Score-loop projections — wrap the existing engine, never invent a second score.
 * Run: pnpm test:score-projection
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RatioInputs } from "../src/lib/ratios.ts";
import { computeRatios } from "../src/lib/ratios.ts";
import { healthFromRatioInputs } from "../src/lib/health-score.ts";
import {
  buildScoreProjection,
  compareScoreProjection,
  driverKeyFromMoveKey,
  isNumericProjectionKey,
  shockInputsForDriver,
  standingImpactLabel,
} from "../src/lib/score-projection.ts";
import {
  decodeFrozenProjection,
  displayOutcomeWhy,
  encodeOutcomeWhy,
  stripProjectionFromWhy,
} from "../src/lib/action-projection.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const inputs: RatioInputs = {
  revenue: "1000000",
  cogs: "600000",
  ebit: "150000",
  ebt: "140000",
  netIncome: "100000",
  ebitda: "180000",
  operatingCashflow: "160000",
  totalAssets: "800000",
  equity: "400000",
  receivables: "120000",
  inventory: "80000",
  payables: "60000",
  fixedCosts: "200000",
  variableCosts: "400000",
  top5Revenue: "400000",
  laborCost: "250000",
  employees: "10",
  founderHours: "40",
};

assert(driverKeyFromMoveKey("debtorDays:action:0") === "debtorDays", "move key strips action suffix");
assert(driverKeyFromMoveKey("debtorDays") === "debtorDays", "bare move key is the driver");
assert(isNumericProjectionKey("debtorDays"), "debtor days may carry a numeric range");
assert(!isNumericProjectionKey("roe"), "ROE must not get a numeric score promise");

const shocked = shockInputsForDriver(inputs, "debtorDays", "stretch");
assert(shocked !== null, "debtor shock exists");
assert(Number(shocked!.receivables) < Number(inputs.receivables), "stretch cuts receivables");

const base = healthFromRatioInputs(inputs, 10);
const after = healthFromRatioInputs(shocked!, 10);
assert(base.overall != null && after.overall != null, "engine scores both snapshots");

const numeric = buildScoreProjection({
  driverKey: "debtorDays:action:1",
  inputs,
  cashRunwayWeeks: 10,
  impactLabel: "+R18k additional cash in next 90 days (illustrative)",
  financialsUpdatedAt: "2026-01-01T00:00:00.000Z",
  now: "2026-01-02T00:00:00.000Z",
});
assert(numeric.kind === "numeric", "clear WC lever is numeric");
assert(numeric.driverKey === "debtorDays", "projection stores the lever, not the action suffix");
assert(numeric.overall != null && numeric.pillarScore != null, "numeric projection has ranges");
assert(numeric.condition.includes("If"), "condition is an if, not a promise");
assert(!numeric.condition.toLowerCase().includes("completing the task will"), "does not promise a tick moves the score");
assert(numeric.impactLabel?.includes("illustrative"), "standing $ stays illustrative");

const encoded = encodeOutcomeWhy("Faster collections.", numeric);
assert(displayOutcomeWhy(encoded).includes("Faster collections"), "why text is visible");
assert(!displayOutcomeWhy(encoded).includes("@@milon-projection@@"), "sentinel is stripped from display");
assert(decodeFrozenProjection(encoded)?.driverKey === "debtorDays", "round-trip projection");
assert(stripProjectionFromWhy("plain").includes("plain"), "plain why is untouched");

const direction = buildScoreProjection({
  driverKey: "roe",
  inputs,
  cashRunwayWeeks: 10,
});
assert(direction.kind === "direction", "complex lever is direction-only");
assert(direction.overall === null, "no overall number on a messy lever");
assert(direction.condition.includes("not a clean forecast"), "copy refuses a fake range");

const waiting = compareScoreProjection({
  projection: numeric,
  currentRatios: computeRatios(inputs),
  currentOverall: base.overall,
  currentPillars: base.pillars,
  currentFinancialsUpdatedAt: "2026-01-01T00:00:00.000Z",
  plannedCount: 2,
  doneCount: 1,
});
assert(!waiting.measured, "same financials timestamp is not a new pack");
assert(waiting.read.includes("ticking a box does not move it"), "gap copy refuses a fake score");

const measuredSame = compareScoreProjection({
  projection: numeric,
  currentRatios: computeRatios(inputs),
  currentOverall: base.overall,
  currentPillars: base.pillars,
  currentFinancialsUpdatedAt: "2026-03-01T00:00:00.000Z",
  plannedCount: 2,
  doneCount: 2,
});
assert(measuredSame.measured, "new figures timestamp closes the loop");
assert(measuredSame.read.includes("bottleneck") || measuredSame.read.includes("did not move"), "miss is a recalibrate, not blame");

const improved = shockInputsForDriver(inputs, "debtorDays", "stretch")!;
const improvedHealth = healthFromRatioInputs(improved, 10);
const measuredWin = compareScoreProjection({
  projection: numeric,
  currentRatios: computeRatios(improved),
  currentOverall: improvedHealth.overall,
  currentPillars: improvedHealth.pillars,
  currentFinancialsUpdatedAt: "2026-03-01T00:00:00.000Z",
  plannedCount: 1,
  doneCount: 1,
});
assert(measuredWin.weSaid.includes("not a promise"), "retrospective still hedges");
assert(!measuredWin.read.toLowerCase().includes("you failed"), "no fail-the-client copy");
assert(measuredWin.read.includes("not proof") || measuredWin.read.includes("blend") || measuredWin.read.includes("offset") || measuredWin.read.includes("correlation"), "no causal attribution");

assert(
  standingImpactLabel([numeric.impactLabel, "+R5k extra"]) === numeric.impactLabel,
  "standing $ does not sum",
);

const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(app.includes("ScoreLoopCard"), "owner health tab mounts the close-the-loop card");
assert(app.includes("${nextSteps[0].key}:action:${i}"), "each Next Move action has its own plan key");
assert(app.includes("openOnAdd"), "adding a recommended action lands on the plan");
assert(app.includes("The score stays put until new figures land"), "in-flight copy is honest");

const hero = readFileSync(resolve("src/components/sphere-hero.tsx"), "utf8");
assert(hero.includes("it does not grow as you add tasks"), "potential impact stays a standing estimate");
assert(hero.includes("inFlight"), "Next Move card has a gap state");

const addBtn = readFileSync(resolve("src/components/add-to-plan-button.tsx"), "utf8");
assert(addBtn.includes("encodeOutcomeWhy"), "add-to-plan freezes the projection");
assert(addBtn.includes("driverKeyFromMoveKey"), "driver is the lever, not the action suffix");

const plan = readFileSync(resolve("src/components/action-plan.tsx"), "utf8");
assert(plan.includes("displayOutcomeWhy"), "plan UI never shows the raw projection blob");

console.log("score-projection-test: ok");
