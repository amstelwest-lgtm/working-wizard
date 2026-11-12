/**
 * Takeover proposals are drafts in agent_findings.
 * Run: pnpm test:im-takeover-proposal
 */
import { readFileSync } from "node:fs";
import { CLAUDE_OPUS_55, CLAUDE_SONNET_55 } from "../src/lib/claude-request.ts";
import {
  IM_TAKEOVER_KIND,
  isTakeoverStep,
  proposalCostUsd,
  proposalModel,
  proposalUsesListedModel,
  takeoverFindingInsert,
  takeoverProposals,
  takeoverRunInsert,
} from "../src/lib/im-takeover-proposal.ts";
import type { PracticePlanStep } from "../src/lib/setup-partner-plan.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function step(partial: Partial<PracticePlanStep> & Pick<PracticePlanStep, "step" | "capability" | "covers" | "bucket">): PracticePlanStep {
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
const gap = step({
  step: "Run payroll",
  capability: "payroll",
  covers: "Payroll journals",
  bucket: "product_gap",
  dedupe_key: "payroll",
});
const form = step({
  step: "Fill the IRP6 from the books",
  capability: "tax",
  covers: "IRP6",
  bucket: "covered",
  dedupe_key: "irp6",
});
const bespoke = step({
  step: "WhatsApp the partner",
  capability: "bespoke",
  covers: "Not a Milōn capability",
  bucket: "bespoke",
  dedupe_key: "bespoke",
});
const analyst = step({
  step: "Management pack",
  capability: "analyst",
  covers: "Analyst — client reporting",
  bucket: "covered",
  dedupe_key: "analyst--client-reporting",
});

assert(!isTakeoverStep(gap), "a product gap is not a takeover");
assert(!isTakeoverStep(form), "form-fill stays out");
assert(!isTakeoverStep(bespoke), "bespoke stays a log");

const proposals = takeoverProposals([fm, gap, form, bespoke, analyst, fm]);
assert(proposals.length === 2, "one proposal per takeover step");
const fmProposal = proposals[0];
const analystProposal = proposals[1];
assert(fmProposal.agent === "financial_manager", "month-end stays with Financial Manager");
assert(fmProposal.model === CLAUDE_OPUS_55, "Financial Manager stays on Opus");
assert(fmProposal.detail.includes("Opus 5.5"), "the Opus run is named");
assert(fmProposal.detail.includes("$0.052"), "the Opus run shows its cost");
assert(fmProposal.detail.includes("Not scheduled."), "a proposal is not a schedule");
assert(!fmProposal.detail.toLowerCase().includes("irp6"), "the proposal does not fill a form");
assert(analystProposal.model === CLAUDE_SONNET_55, "Analyst stays on Sonnet");
assert(!analystProposal.detail.includes("Opus"), "Analyst is not upgraded to Opus");
assert(proposalUsesListedModel("advisor"), "Advisor uses the listed Sonnet id");
assert(proposalModel("advisor") === CLAUDE_SONNET_55, "Advisor is not Opus");
assert(proposalCostUsd("financial_manager") === 0.052, "Opus example cost");
assert(proposalCostUsd("analyst") === 0.026, "Sonnet example cost");

const run = takeoverRunInsert({
  proposal: fmProposal,
  clientId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  firmId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  finishedAt: "2026-11-12T00:00:00.000Z",
});
assert(run.status === "skipped", "the proposal run is skipped");
assert(run.trigger === "on_demand", "the proposal run is not a schedule trigger");
assert(String(run.summary).includes("$0.052"), "the run summary carries the cost");
assert(!("rule_text" in run), "the run is not a brain rule");

const finding = takeoverFindingInsert({
  proposal: fmProposal,
  clientId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  runId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
});
assert(finding.kind === IM_TAKEOVER_KIND, "the finding kind is the takeover proposal");
const evidence = finding.evidence as { figures: Record<string, number>; scheduled: boolean };
assert(Object.keys(evidence.figures).length > 0, "evidence.figures is a non-empty object");
assert(evidence.scheduled === false, "the finding is not scheduled");
assert(!("rule_text" in finding), "the finding does not write rule text");

const source = readFileSync("src/lib/im-takeover-proposal.functions.ts", "utf8");
assert(source.includes("takeoverProposals"), "the server recomputes the proposals");
assert(source.includes('status: "skipped"') || source.includes("takeoverRunInsert"), "the server uses the skipped run");
assert(!source.includes("enqueue_agent_event"), "P1 does not enqueue");
assert(!source.includes("promote_due_agent_events"), "P1 does not promote due work");
assert(!source.includes("begin_agent_run"), "begin_agent_run would queue the run");
assert(!source.includes("milon_brain_rules"), "proposals are not brain rules");
assert(!source.includes("rule_text"), "proposal text is not rule_text");
assert(!source.includes("irp6"), "the save path does not fill a form");

const panel = readFileSync("src/components/practice-setup-panel.tsx", "utf8");
assert(panel.includes("ImTakeoverProposals"), "the practice page lists the proposals");

console.log("im-takeover-proposal ok");
