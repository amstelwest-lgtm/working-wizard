/**
 * Implementation Manager replay, manifest, and activation planner.
 * Run: pnpm test:im-planner
 */
import { readFileSync } from "node:fs";
import { buildCapabilityManifest, matchManifestClassifier } from "../src/lib/im-capability-manifest.ts";
import {
  activationPlanSendsNothing,
  activationStepsHaveOwners,
  buildActivationPlan,
  pickPilotClients,
} from "../src/lib/im-activation-planner.ts";
import { replayImplementationPlan } from "../src/lib/im-replay.ts";
import { classifyPracticeStep } from "../src/lib/setup-partner-plan.ts";

type Fixture = {
  label?: string;
  country?: "US" | "ZA";
  hours_saved_estimate?: number | null;
  pilots?: { id: string; name: string; hasLedger: boolean; hasUpload: boolean }[];
  rules: { rule_text: string; status?: string; source_event?: string; client_id?: string | null }[];
};

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(`scripts/fixtures/im/${name}`, "utf8")) as Fixture;
}

function replayFixture(fixture: Fixture) {
  return replayImplementationPlan({
    confirmRules: fixture.rules,
    meta: {
      label: fixture.label,
      country: fixture.country,
      hours_saved_estimate: fixture.hours_saved_estimate,
    },
  });
}

const theo = loadFixture("theo-practice.json");
const theoReplay = replayFixture(theo);
assert(theoReplay.status === "ready", `Theo replay: ${theoReplay.status}`);
if (theoReplay.status === "ready") {
  assert(theoReplay.plan.steps.length === 14, `Theo step count: ${theoReplay.plan.steps.length}`);
  assert(theoReplay.label === "Practice A replay", "Theo label");
}

for (const file of [
  "persona-small-bookkeeping-za.json",
  "persona-multi-ledger.json",
  "persona-tax-heavy-za.json",
  "persona-us-cpa.json",
]) {
  const persona = loadFixture(file);
  const replay = replayFixture(persona);
  assert(replay.status === "ready", `${file} should replay without questions`);
  if (replay.status === "ready") {
    const activation = buildActivationPlan({
      plan: replay.plan,
      country: replay.country,
      pilots: persona.pilots ?? [],
      meta: { hours_saved_estimate: persona.hours_saved_estimate },
    });
    assert(activationStepsHaveOwners(activation), `${file} routine owners`);
    assert(activationPlanSendsNothing(activation), `${file} must not send`);
    assert(activation.hoursSavedEstimate === (persona.hours_saved_estimate ?? null), `${file} hours estimate`);
    assert(pickPilotClients(persona.pilots ?? []).length >= 2, `${file} picks pilots`);
  }
}

const missing = loadFixture("missing-answers.json");
const missingReplay = replayFixture(missing);
assert(missingReplay.status === "needs_questions", "missing fixture should ask");
if (missingReplay.status === "needs_questions") {
  assert(
    missingReplay.missingQuestions.some((line) => /country/i.test(line)),
    "missing country prompt",
  );
}

const baseManifest = buildCapabilityManifest("ZA");
const withFixture = buildCapabilityManifest("ZA", {
  extraClassifiers: [
    {
      re: /fixture-tool-demo-step/i,
      capability: "fixture-tool",
      stepType: "fixture_tool",
      bucket: "covered",
      covers: "Financial Manager — fixture tool demo",
      effort: "S",
      fitNote: "Already in Milōn: Financial Manager: fixture tool demo.",
      priority: 95,
    },
  ],
  extraAgentTools: [{ agentKey: "financial_manager", tool: "fixture_tool_demo", label: "Fixture tool demo" }],
});
assert(!matchManifestClassifier("fixture-tool-demo-step only", baseManifest), "base manifest ignores fixture step");
const fixtureMatch = matchManifestClassifier("fixture-tool-demo-step for month-end", withFixture);
assert(fixtureMatch?.stepType === "fixture_tool", "fixture classifier attaches");
assert(
  withFixture.agents.find((row) => row.agentKey === "financial_manager")?.tools.includes("Fixture tool demo"),
  "registry copy picked up fixture tool",
);

const deadlineStep =
  "Track each client's VAT, EMP201 and provisional tax deadlines — Owner/accountant; Client folders on desktop, email; Deadlines are scattered";
const deadlineClass = classifyPracticeStep(deadlineStep);
assert(deadlineClass.bucket === "covered", `deadline desktop step bucket: ${deadlineClass.bucket}`);
assert(deadlineClass.step_type === "deadlines", "deadline maps to advisor deadline watch");
assert(!deadlineClass.fit_note.includes("Logged only"), "deadline is not bespoke");

if (theoReplay.status === "ready") {
  const activation = buildActivationPlan({
    plan: theoReplay.plan,
    country: theoReplay.country,
    pilots: theo.pilots ?? [],
    meta: { hours_saved_estimate: theo.hours_saved_estimate },
  });
  assert(activation.firstValueMilestone.sent === false, "first milestone unsent");
  assert(
    activation.routineMaps.every((map) => map.kind === "routine_map"),
    "routine maps ready for client_artifacts",
  );
  assert(activation.artifactShape.tagged.includes("action_items"), "action_items tag");
  for (const map of activation.routineMaps) {
    for (const step of map.steps) {
      assert(step.botOwner.length > 0, "every step has bot owner");
      assert(step.approvalGate.sends === false, "approval gate blocks send");
      assert(step.sends === false, "step does not send");
    }
  }
}

console.log("im-planner-test: ok");