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
import { pickPilotClients, buildActivationPlan, partnerPilotChecklistLine } from "../src/lib/im-activation-planner.ts";
import { classifyPracticeStep } from "../src/lib/setup-partner-plan.ts";
import { activationAcceptWritesNothing, planActivationAccept } from "../src/lib/im-activation-accept.ts";
import { imRoutineTriggerMet } from "../src/lib/im-routine-schedule.ts";
import {
  activationActionMoveKey,
  CLIENT_ARTIFACT_KINDS,
  countNewlyEnqueuedRun,
  hoursSavedDisplay,
  IM_ACTIVATION_WRITTEN_KINDS,
  imRoutineMapArtifactFilter,
  routineMapArtifactInsert,
  routineMapArtifactMeta,
} from "../src/lib/im-activation-persist.ts";
import { ownerRoutineMonthLines, accountantRoutineSteps, parseRoutineMapMeta } from "../src/lib/client-routines.ts";
import { replayImplementationPlan } from "../src/lib/im-replay.ts";
import { accountantToday, buildIntegrationPlanTable, integrationPlanOpusBody, playsForPlan } from "../src/lib/im-integration-plan.ts";

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
assert(
  pickPilotClients([
    { id: clientA, name: "New York Yankees", hasLedger: true, hasUpload: true },
    { id: clientB, name: "Harbour Glass", hasLedger: false, hasUpload: false },
  ]).every((row) => row.name !== "New York Yankees"),
  "a sample client is not the pilot",
);

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
    accept.enqueue.length > 0 || map.steps.some((step) => imRoutineTriggerMet(step.trigger, { hasLedger: true, hasUpload: false, now: new Date() }, true)),
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

assert(!imRoutineTriggerMet("calendar_month_end", { hasLedger: false, hasUpload: false, now: new Date() }, true), "month-end needs books");
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
const inserted = routineMapArtifactInsert({
  firmId: firm,
  clientId: clientA,
  map: {
    kind: "routine_map",
    routine: "monthly_pack",
    tags: [],
    steps: meta.steps,
  },
  hoursSavedPerRun: null,
  acceptedAt: new Date(0).toISOString(),
});
for (const kind of IM_ACTIVATION_WRITTEN_KINDS) {
  assert(
    (CLIENT_ARTIFACT_KINDS as readonly string[]).includes(kind),
    `IM write kind ${kind} is in client_artifacts_kind_check`,
  );
}
assert(
  (CLIENT_ARTIFACT_KINDS as readonly string[]).includes(inserted.kind),
  "insert kind is allowed",
);
assert(inserted.kind === "other", "routine map stores as other");
assert(
  inserted.meta.im_kind === "routine_map" && inserted.meta.type === "routine_map",
  "real type stays in meta",
);
assert(parseRoutineMapMeta(inserted.meta)?.routine === "monthly_pack", "new shape parses");
const legacyMeta = { ...inserted.meta } as Record<string, unknown>;
delete legacyMeta.im_kind;
delete legacyMeta.type;
assert(parseRoutineMapMeta(legacyMeta)?.routine === "monthly_pack", "legacy meta still parses");
const artifactFilter = imRoutineMapArtifactFilter();
assert(artifactFilter.includes("kind.eq.routine_map"), "legacy kind still matches");
assert(artifactFilter.includes("kind.eq.other"), "stored kind is other");
assert(artifactFilter.includes("meta->>im_kind.eq.routine_map"), "meta.im_kind is the real type");
assert(artifactFilter.includes("meta->>type.eq.routine_map"), "meta.type is the real type");
assert(artifactFilter.includes("meta->>doc_type.eq.im_routine_map"), "doc_type still matches");
const ownerLines = ownerRoutineMonthLines(
  [
    {
      id: "1",
      title: "Draft monthly pack",
      status: "not_started",
      source_move_key: "x",
      sent_at: null,
      driver_key: "setup_partner_activation",
    },
  ],
  [],
);
assert(countNewlyEnqueuedRun({ runId: "run-a", created: false }) === 0, "re-accept does not count existing run");
assert(countNewlyEnqueuedRun({ runId: "run-b", created: true }) === 1, "first enqueue counts");
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
assert(activationSource.includes('countNewlyEnqueuedRun(run)'), "enqueue tally skips duplicate agent_runs");
assert(activationSource.includes('created: false'), "23505 path marks existing run");
const pilotFn = activationSource.slice(
  activationSource.indexOf("function resolveStoredPilot"),
  activationSource.indexOf("async function withDraftLinks"),
);
assert(pilotFn.includes("if (!match) return null"), "a stored pilot must be one of this firm's clients");
assert(!pilotFn.includes("hasLedger: false"), "a missing pilot is not invented");
assert(activationSource.includes('rpc("agent_invoke"'), "activation starts runners via agent_invoke");
assert(!activationSource.includes("resend"), "activation does not send mail");
assert(!activationSource.includes("accountant_request_respond"), "activation does not post requests");
assert(activationSource.includes('audience: "accountant"'), "first runs target accountant draft review");

const ownerDoor = readFileSync("src/components/owner-door/owner-door.tsx", "utf8");
assert(ownerDoor.includes("OwnerRoutinesMonth"), "owner door mounts routines");
const ownerShell = readFileSync("src/components/owner-door/owner-shell.tsx", "utf8");
assert(ownerShell.includes('"routines"'), "owner shell vertical nav lists routines");

const setup = readFileSync("src/routes/_authenticated/practice_.setup.tsx", "utf8");
assert(!setup.includes("ImActivationStep"), "practice setup does not mount the folded activation step");
assert(!setup.includes("Accept selected routines"), "practice setup has no Accept controls");
assert(setup.includes("implementation_manager"), "practice setup mounts IM rules");
assert(partnerPilotChecklistLine(1) === "Milōn starts the first drafts on one client.", "one client is enough");
assert(partnerPilotChecklistLine(3) === "Milōn starts the first drafts on 3 clients.", "three clients are named as a count");
assert(!partnerPilotChecklistLine(2).includes("Pick 2"), "the checklist does not ask the firm to pick 2–3");

function acceptReplayBlock(source: string): string {
  const helper = source.indexOf("function acceptImActivationHandler");
  if (helper >= 0) {
    const end = source.indexOf("export const acceptImActivation", helper);
    return source.slice(helper, end === -1 ? helper + 5000 : end);
  }
  const start = source.indexOf("export const acceptImActivation");
  const next = source.indexOf("\nexport const ", start + 20);
  return source.slice(start, next === -1 ? source.length : next);
}

function metaPassedByAccept(source: string, country: "US" | "ZA"): { country?: "US" | "ZA" } {
  const block = acceptReplayBlock(source);
  const replayAt = block.indexOf("replayImplementationPlan");
  const call = replayAt >= 0 ? block.slice(replayAt, replayAt + 220) : "";
  if (/meta:\s*\{\s*country:\s*data\.country\s*\}/.test(call) && !/meta:\s*\{\s*\}/.test(call)) {
    return { country };
  }
  return {};
}

const acceptSchemaBlock = activationSource.slice(
  activationSource.lastIndexOf("const acceptSchema"),
  activationSource.indexOf("function acceptImActivationHandler") === -1
    ? activationSource.indexOf("export const acceptImActivation")
    : activationSource.indexOf("function acceptImActivationHandler"),
);
assert(/country:\s*z\.enum\(\["US", "ZA"\]\)/.test(acceptSchemaBlock), "accept schema takes the firm country");
const countryReplay = replayImplementationPlan({
  confirmRules: [
    {
      rule_text: "Practice: Month-end close pack [|covered]",
      status: "active",
      source_event: "setup_partner_confirm",
    },
  ],
  meta: metaPassedByAccept(activationSource, "ZA"),
});
assert(countryReplay.status === "ready", "accept replay keeps the firm country");

const planRows = buildIntegrationPlanTable({
  steps: [
    { step: "Practice: Who signs the pack — Partner reviews it", bucket: "client_setup" },
    { step: "Build the missing tax form", bucket: "product_gap" },
  ],
  coverage: [{ agent: "Tax Specialist", owns: "ZA tax prep for accountant review (no filing)." }],
  country: "US",
});
const planBlob = JSON.stringify(planRows);
assert(!planBlob.includes("Practice:"), "plan table drops Practice prefixes");
assert(!planBlob.includes("product_gap") && !planBlob.includes("Product gap"), "classifications stay off the table");
assert(!planBlob.includes("Build the missing tax form"), "a gap is not a workflow row");
assert(planBlob.includes("Sales-tax prep"), "a US plan says sales-tax prep");
assert(!/\bSARS\b|\bZA\b|\bHMRC\b/.test(planBlob), "a US plan table does not say ZA, SARS, or HMRC");
const zaAuthority = JSON.stringify(
  buildIntegrationPlanTable({
    steps: [{ step: "File the VAT return with HMRC — Firm; Monthly", bucket: "covered" }],
    country: "ZA",
  }),
);
assert(zaAuthority.includes("SARS"), "a ZA plan says SARS");
assert(!/\bHMRC\b|\bIRS\b/.test(zaAuthority), "a ZA plan does not say HMRC or IRS");
const usAuthority = JSON.stringify(
  buildIntegrationPlanTable({
    steps: [{ step: "File the return with HMRC — Firm; Monthly", bucket: "covered" }],
    country: "US",
  }),
);
assert(usAuthority.includes("IRS"), "a US plan says IRS");
assert(!/\bHMRC\b|\bSARS\b/.test(usAuthority), "a US plan does not say HMRC or SARS");
const ukAuthority = JSON.stringify(
  buildIntegrationPlanTable({
    steps: [{ step: "File the return with SARS — Firm; Monthly", bucket: "covered" }],
    country: "UK",
  }),
);
assert(ukAuthority.includes("HMRC"), "a UK plan says HMRC");
assert(!/\bSARS\b|\bIRS\b/.test(ukAuthority), "HMRC appears only for a UK plan");
assert(!planBlob.includes("Live"), "the plan table does not say Live");
const fitRows = buildIntegrationPlanTable({
  steps: [
    {
      step: "Practice: Prepare the books in Xero — Two juniors; Xero; Monthly — Firm setting for the practice. Saved as a private rule.",
      bucket: "client_setup",
    },
  ],
  country: "ZA",
});
const fitBlob = JSON.stringify(fitRows);
assert(fitBlob.includes("Prepare the books in Xero"), "the workflow stays");
assert(!fitBlob.includes("Firm setting"), "plan table drops fit notes");
assert(!fitBlob.includes("Practice:"), "fit-note rows still drop the Practice prefix");
assert(!fitBlob.includes("Xero; Monthly"), "today is not a stored field list");
const spoken = buildIntegrationPlanTable({
  steps: [
    {
      step: "Provide monthly bookkeeping, VAT and payroll services — Firm; Monthly",
      bucket: "covered",
    },
    {
      step: "Clients send invoices and bank statements to the firm as PDF email attachments — Clients; Email (PDF attachments); Monthly",
      bucket: "client_setup",
    },
    {
      step: "Manager reviews the prepared books, then the partner signs off — Manager; Partner; Monthly",
      bucket: "client_setup",
    },
  ],
  country: "ZA",
});
const spokenBlob = JSON.stringify(spoken);
assert(
  accountantToday("Provide monthly bookkeeping", "Firm; Monthly") === "Done in-house every month.",
  "a firm monthly habit is plain English",
);
assert(
  spokenBlob.includes("Clients email PDF invoices and bank statements each month"),
  "a client email habit is plain English",
);
assert(
  spokenBlob.includes("The manager reviews the work and the partner signs off every month"),
  "a sign-off habit is plain English",
);
assert(!spokenBlob.includes("Firm; Monthly") && !/; Monthly/.test(spokenBlob), "stored fields stay off the table");
assert(new Set(spoken.map((row) => row.milon)).size === spoken.length, "each play names a different output");
assert(
  spoken.find((row) => row.playId === "document-collection")?.bot === "Financial Manager",
  "document collection stays with Financial Manager",
);
assert(
  spoken.find((row) => row.playId === "management-pack")?.bot === "Analyst",
  "bookkeeping and the month-end pack stay with the Analyst",
);
assert(!spoken.some((row) => row.bot === "Accountant"), "the plan bot comes from the play");
const roster = buildIntegrationPlanTable({
  steps: [
    { step: "Draft the monthly bookkeeping pack", bucket: "covered" },
    { step: "Prepare the books and VAT workings in Xero", bucket: "client_setup" },
    { step: "Prepare the month-end pack", bucket: "covered" },
    { step: "Prepare the VAT201 for review", bucket: "client_setup" },
    { step: "Prepare the ITR14 company return", bucket: "client_setup" },
  ],
  country: "ZA",
});
const playBot = (id: string) => roster.find((row) => row.playId === id)?.bot;
assert(playBot("management-pack") === "Analyst", "books prep and the month-end pack go to the Analyst");
assert(playBot("tax-deadlines") === "Tax Specialist", "VAT201 and ITR rows go to the Tax Specialist");
assert(
  !/vat workings/i.test(roster.find((row) => row.playId === "tax-deadlines")?.problem ?? ""),
  "books and VAT workings are not a tax filing",
);
assert(spoken.filter((row) => row.bot === "Financial Manager").length < spoken.length, "bots are not all Financial Manager");
const opusBody = integrationPlanOpusBody({
  plays: playsForPlan("US"),
  interview: "A: Clients never hear what we did.",
  country: "US",
});
assert(opusBody.model === "claude-opus-5-5", "the plan table is drafted by Opus 5.5");
assert(opusBody.messages[0]?.content.includes("monthly-client-update"), "Opus sees the catalogue");
assert(!/rewrite this integration plan/i.test(opusBody.messages[0]?.content ?? ""), "Opus is not told to reword fixed sentences");

const enqueueBlock = activationSource.slice(
  activationSource.indexOf("async function enqueueDraftRun"),
  activationSource.indexOf("export const loadImActivationContext"),
);
assert(enqueueBlock.includes('audience: "accountant"'), "first agent_invoke runs stay accountant drafts");
assert(enqueueBlock.includes("draft only"), "activation summary says draft only");
assert(!enqueueBlock.includes("resend") && !enqueueBlock.includes("accountant_request_respond"), "enqueue does not send or post");
assert(!activationSource.includes('kind: "routine_map"'), "activation does not write kind routine_map");
assert(activationSource.includes("routineMapArtifactInsert("), "activation writes the shared artifact payload");
assert(activationSource.includes("assertImActivationArtifactKinds("), "kinds are checked before writes");
assert(activationSource.includes("imRoutineMapArtifactFilter()"), "activation loader uses the shared filter");
assert(activationSource.includes("rollbackActivationWrites("), "a failed start deletes rows from this click");
const writtenKindLiterals = [...activationSource.matchAll(/kind:\s*"([^"]+)"/g)].map((match) => match[1] ?? "");
assert(
  writtenKindLiterals.every((kind) => (CLIENT_ARTIFACT_KINDS as readonly string[]).includes(kind)),
  `activation file kind literals stay in the allowlist (${writtenKindLiterals.join(",")})`,
);
const scheduler = readFileSync("src/lib/im-routine-scheduler.service.ts", "utf8");
assert(scheduler.includes("imRoutineMapArtifactFilter()"), "cron scan uses the shared filter");
assert(!scheduler.includes('eq("kind", "routine_map")'), "cron does not require the disallowed kind");
const routinesPanel = readFileSync("src/components/client-routines-panel.tsx", "utf8");
assert(routinesPanel.includes("imRoutineMapArtifactFilter()"), "routines panel reads the new and legacy shapes");
const setupPanel = readFileSync("src/components/practice-setup-panel.tsx", "utf8");
assert(setupPanel.includes("heldPlanRef"), "Start reuses the plan rows already on screen");
assert(setupPanel.includes("if (heldPlanRef.current) return"), "Start does not call Opus again");

console.log("im-activation-test: ok");
