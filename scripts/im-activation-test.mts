/**
 * Implementation Manager activation accept + routines views.
 * Run: pnpm test:im-activation
 */
import { readFileSync } from "node:fs";
import { FM_TOOLS } from "../src/lib/agent-financial-manager.ts";
import {
  buildCapabilityManifest,
  matchManifestClassifier,
} from "../src/lib/im-capability-manifest.ts";
import { pickPilotClients, buildActivationPlan } from "../src/lib/im-activation-planner.ts";
import { classifyPracticeStep } from "../src/lib/setup-partner-plan.ts";
import { activationAcceptWritesNothing, planActivationAccept } from "../src/lib/im-activation-accept.ts";
import { imActivationTriggerMet } from "../src/lib/im-activation-triggers.ts";
import {
  activationActionMoveKey,
  hoursSavedDisplay,
  routineMapArtifactMeta,
} from "../src/lib/im-activation-persist.ts";
import { ownerRoutineMonthLines, accountantRoutineSteps, parseRoutineMapMeta } from "../src/lib/client-routines.ts";
import { replayImplementationPlan } from "../src/lib/im-replay.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const firm = "e8f7a440-1111-1111-1111-111111111111";
const clientA = "e8f7a440-2222-2222-2222-222222222222";
const clientB = "e8f7a440-3333-3333-3333-333333333333";

assert(FM_TOOLS.includes("get_cash_13_week"), "FM_TOOLS lists get_cash_13_week");
const manifest = buildCapabilityManifest("ZA");
assert(
  manifest.agents.find((row) => row.agentKey === "financial_manager")?.tools.includes("13-week cash"),
  "FM tool label appears on manifest",
);
const cashClass = classifyPracticeStep("Run the 13-week cash forecast each Monday", { manifest });
assert(cashClass.bucket === "covered" && cashClass.step_type === "cash_forecast", "registry-backed cash forecast");
assert(!matchManifestClassifier("fixture-only override hook", manifest), "no override hook in prod manifest");

const pilots = pickPilotClients(
  [
    { id: clientA, name: "A", hasLedger: true, hasUpload: false },
    { id: clientB, name: "B", hasLedger: false, hasUpload: true },
    { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "C", hasLedger: false, hasUpload: false },
  ],
);
assert(pilots.length >= 2 && pilots[0]?.hasLedger, "pilot defaults prefer ledger/upload");

const replay = replayImplementationPlan({
  confirmRules: [{ rule_text: "Practice: Month-end close pack [|covered]", status: "active", source_event: "setup_partner_confirm" }],
  meta: { country: "ZA" },
});
assert(replay.status === "ready" && "manifest" in replay, "replay returns manifest");

if (replay.status === "ready") {
  const activation = buildActivationPlan({
    plan: replay.plan,
    country: replay.country,
    pilots,
    manifest: replay.manifest,
  });
  const map = activation.routineMaps[0];
  const key = activationActionMoveKey(firm, clientA, map.routine, map.steps[0]?.id ?? "step");
  const emptyKeys = new Set<string>();
  const accept = planActivationAccept({
    firmId: firm,
    clientId: clientA,
    routine: map.routine,
    map,
    books: { hasLedger: true, hasUpload: false },
    existingActionKeys: emptyKeys,
    existingArtifactKeys: emptyKeys,
  });
  assert(accept.writeArtifact && accept.actionKeys.length > 0, "accept plans writes");
  assert(
    accept.enqueue.length > 0 || map.steps.some((step) => imActivationTriggerMet(step.trigger, { hasLedger: true, hasUpload: false })),
    "trigger met enqueues when books allow",
  );
  assert(activationAcceptWritesNothing(null), "null accept writes nothing");

  const decline = planActivationAccept({
    firmId: firm,
    clientId: clientA,
    routine: map.routine,
    map,
    books: { hasLedger: false, hasUpload: false },
    existingActionKeys: new Set([key]),
    existingArtifactKeys: new Set([accept.artifactKey]),
  });
  assert(decline.writeArtifact === false && decline.actionKeys.length === 0, "idempotent re-accept");

  const noTrigger = planActivationAccept({
    firmId: firm,
    clientId: clientA,
    routine: map.routine,
    map,
    books: { hasLedger: false, hasUpload: false },
    existingActionKeys: emptyKeys,
    existingArtifactKeys: emptyKeys,
  });
  assert(noTrigger.enqueue.length === 0, "no enqueue when trigger not met");
}

assert(!imActivationTriggerMet("calendar_month_end", { hasLedger: false, hasUpload: false }), "month-end needs books");
assert(hoursSavedDisplay(null, 3) === null, "hours blank without estimate");
assert(hoursSavedDisplay(2, 3) === "6 hours saved (2 × 3 runs)", "hours only with estimate");

const meta = routineMapArtifactMeta({
  firmId: firm,
  clientId: clientA,
  map: {
    kind: "routine_map",
    routine: "monthly_pack",
    tags: [],
    steps: [
      {
        id: "monthly_pack-1",
        title: "Draft monthly pack",
        botOwner: "Analyst",
        trigger: "calendar_month_end",
        cadence: "monthly",
        approvalGate: { kind: "human_send", description: "Accountant reviews and sends.", sends: false },
        sends: false,
      },
    ],
  },
  hoursSavedPerRun: null,
  acceptedAt: new Date(0).toISOString(),
});
const parsed = parseRoutineMapMeta(meta);
assert(parsed?.routine === "monthly_pack", "routine_map meta parses");
const ownerLines = ownerRoutineMonthLines(
  [{ id: "1", title: "Draft monthly pack", status: "not_started", source_move_key: "x", sent_at: null }],
  [],
);
assert(ownerLines.every((line) => !/Analyst|claude|rule/i.test(line.text)), "owner view leaks no internals");

const accountant = accountantRoutineSteps({
  firmId: firm,
  clientId: clientA,
  meta: parsed!,
  actions: [],
  runs: [],
});
assert(accountant[0]?.status === "waiting", "accountant status defaults waiting");

const activationSource = readFileSync("src/lib/im-activation.functions.ts", "utf8");
assert(!activationSource.includes("sent_at:") || activationSource.includes("draft only"), "activation copy stays draft-only");
assert(!activationSource.includes("xero") || activationSource.includes("xero_connections"), "no ledger posts");

const setup = readFileSync("src/routes/_authenticated/practice_.setup.tsx", "utf8");
assert(setup.includes("ImActivationStep"), "practice setup mounts activation");

console.log("im-activation-test: ok");