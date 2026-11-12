/**
 * Routine proposals name the model and the locked cap. They do not schedule.
 * Run: pnpm test:im-routine-proposal
 */
import { readFileSync } from "node:fs";
import { CLAUDE_OPUS_55, CLAUDE_SONNET_55 } from "../src/lib/claude-request.ts";
import {
  IM_ROUTINE_KIND,
  ROUTINE_RUNS_PER_FIRM_MONTH,
  routineAgent,
  routineCapUsd,
  routineCostUsd,
  routineFindingInsert,
  routineModel,
  routineProposals,
  routineRunInsert,
} from "../src/lib/im-routine-proposal.ts";
import type { PracticePlanStep } from "../src/lib/setup-partner-plan.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function step(
  partial: Partial<PracticePlanStep> & Pick<PracticePlanStep, "step" | "capability" | "covers" | "bucket">,
): PracticePlanStep {
  return {
    step_type: "custom",
    fit_note: "",
    effort: "S",
    dedupe_key: partial.capability,
    ...partial,
  };
}

const fm = step({
  step: "Month-end close pack",
  step_type: "month_end_close",
  capability: "financial-manager",
  covers: "Financial Manager — month-end close pack",
  bucket: "covered",
  dedupe_key: "financial-manager--month-end-close",
});
const analyst = step({
  step: "Management pack",
  capability: "analyst",
  covers: "Analyst — client reporting",
  bucket: "covered",
  dedupe_key: "analyst--client-reporting",
});
const deadlines = step({
  step: "Deadline reminders",
  step_type: "deadlines",
  capability: "advisor",
  covers: "Advisor — deadline reminders",
  bucket: "covered",
  dedupe_key: "advisor--deadlines",
});
const form = step({
  step: "Fill the ITR14",
  capability: "tax",
  covers: "ITR14",
  bucket: "covered",
  dedupe_key: "itr14",
});
const setup = step({
  step: "Who signs the pack",
  capability: "sign-off",
  covers: "Accountant sign-off",
  bucket: "client_setup",
  dedupe_key: "sign-off",
});

assert(routineAgent(form) === null, "form-fill is not a routine");
assert(routineAgent(setup) === null, "a firm habit is not a routine");
assert(ROUTINE_RUNS_PER_FIRM_MONTH === 20, "the cap is 20");
assert(routineModel("financial_manager") === CLAUDE_OPUS_55, "Financial Manager stays on Opus");
assert(routineModel("analyst") === CLAUDE_SONNET_55, "Analyst stays on Sonnet");
assert(routineModel("advisor") === CLAUDE_SONNET_55, "Advisor stays on Sonnet");
assert(routineCostUsd("analyst") === 0.026, "Sonnet example cost");
assert(routineCostUsd("financial_manager") === 0.052, "Opus example cost");
assert(routineCapUsd("analyst") === 0.52, "twenty Sonnet runs");
assert(routineCapUsd("financial_manager") === 1.04, "twenty Opus runs");

const proposals = routineProposals([fm, analyst, deadlines, form, setup]);
assert(proposals.length === 3, "one routine per covered agent step");
assert(proposals[0].detail.includes("Opus 5.5"), "the FM routine names Opus");
assert(proposals[0].detail.includes("$0.052"), "the FM routine shows the run cost");
assert(proposals[0].detail.includes("$1.04"), "the FM routine shows the capped month");
assert(proposals[0].detail.includes("Not scheduled."), "the routine is not a schedule");
assert(proposals[0].cadence === "monthly", "month-end is labelled monthly");
assert(proposals[1].model === CLAUDE_SONNET_55, "Analyst is not upgraded");
assert(!proposals[1].detail.includes("Opus"), "the Analyst line does not say Opus");
assert(proposals[2].cadence === "weekly", "deadlines are labelled weekly");
assert(proposals.every((proposal) => proposal.evidence.scheduled === false), "none are scheduled");
assert(proposals.every((proposal) => proposal.evidence.figures.monthlyRunCap === 20), "the cap is on the finding");

const run = routineRunInsert({
  proposal: proposals[0],
  clientId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  firmId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  finishedAt: "2026-11-12T00:00:00.000Z",
});
assert(run.status === "skipped", "the routine run is skipped");
assert(String(run.summary).includes("$0.052"), "the run is labelled with its cost");
assert(!("rule_text" in run), "the run is not a brain rule");

const finding = routineFindingInsert({
  proposal: proposals[0],
  clientId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  runId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
});
assert(finding.kind === IM_ROUTINE_KIND, "the finding is a routine proposal");
assert(Object.keys((finding.evidence as { figures: object }).figures).length > 0, "figures are present");

const source = readFileSync("src/lib/im-routine-proposal.functions.ts", "utf8");
const modelSource = readFileSync("src/lib/im-routine-proposal.ts", "utf8");
assert(source.includes("routineProposals"), "the server recomputes the routines");
assert(modelSource.includes("return modelForAgent(agent);"), "the model is the listed agent default");
assert(!source.includes("enqueue_agent_event"), "P1 does not enqueue");
assert(!source.includes("promote_due_agent_events"), "P1 does not promote due work");
assert(!source.includes("begin_agent_run"), "begin_agent_run would queue the run");
assert(!source.includes("milon_brain_rules"), "routines are not brain rules");
assert(!source.includes("rule_text"), "routine text is not rule_text");
assert(!modelSource.includes("irp6") || modelSource.includes("FORM_FILL_RE"), "form names are only the skip list");

const ui = readFileSync("src/components/im-routine-proposals.tsx", "utf8");
assert(ui.includes("Locked cap:"), "the proposal screen shows the cap");
assert(ui.includes("Not scheduled."), "the screen says the run is not scheduled");
assert(ui.includes("Save routine proposals"), "the button stores the proposal");
assert(!ui.includes("Schedule"), "there is no schedule button");

const panel = readFileSync("src/components/practice-setup-panel.tsx", "utf8");
assert(panel.includes("ImRoutineProposals"), "the practice page lists routine proposals");

console.log("im-routine-proposal ok");
