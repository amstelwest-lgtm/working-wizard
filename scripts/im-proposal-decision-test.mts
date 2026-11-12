/**
 * Approving a proposal records the person and keeps the model label.
 * Run: pnpm test:im-proposal-decision
 */
import { readFileSync } from "node:fs";
import { CLAUDE_SONNET_55 } from "../src/lib/claude-request.ts";
import {
  ROUTINE_RUNS_PER_FIRM_MONTH,
  approveFindingPatch,
  capEstimateUsd,
  dismissFindingPatch,
  isImProposalKind,
} from "../src/lib/im-proposal-decision.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(ROUTINE_RUNS_PER_FIRM_MONTH === 20, "the firm cap is 20");
assert(capEstimateUsd(0.026) === 0.52, "twenty Sonnet runs");
assert(capEstimateUsd(0.052) === 1.04, "twenty Opus runs");
assert(isImProposalKind("im_takeover_proposal"), "takeover findings can be decided");
assert(isImProposalKind("im_routine_proposal"), "routine findings can be decided");
assert(!isImProposalKind("liquidity"), "other findings stay on their own path");

const evidence = {
  figures: { proposal: 1, estimatedCostUsd: 0.026 },
  model: CLAUDE_SONNET_55,
  costLabel: "Sonnet 5.5, about $0.026 a run",
  scheduled: false,
};
const approved = approveFindingPatch({
  userId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  now: "2026-11-12T00:00:00.000Z",
  evidence,
});
assert(approved.approved_by === "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "the approver is stored");
assert(!("status" in approved), "approval does not pretend a live row exists");
assert(!("approved_table" in approved), "approval does not name another table");
assert(!("rule_text" in approved), "approval does not write rule text");
const next = approved.evidence as Record<string, unknown>;
assert(next.approverId === approved.approved_by, "the evidence names the same person");
assert(next.decision === "approved", "the decision is approved");
assert(next.model === CLAUDE_SONNET_55, "approval does not upgrade the model");
assert((next.figures as { estimatedCostUsd: number }).estimatedCostUsd === 0.026, "the cost stays on the finding");

const dismissed = dismissFindingPatch(evidence);
assert(dismissed.status === "dismissed", "dismiss uses the findings status");
assert(dismissed.dismissed_reason === "Not now", "dismiss keeps a reason");
assert((dismissed.evidence as { decision: string }).decision === "dismissed", "the evidence records dismiss");

const source = readFileSync("src/lib/im-proposal-decision.functions.ts", "utf8");
assert(source.includes("approveFindingPatch"), "approve uses the patch");
assert(source.includes("dismissFindingPatch"), "dismiss uses the patch");
assert(!source.includes("enqueue_agent_event"), "a decision does not enqueue");
assert(!source.includes("promote_due_agent_events"), "a decision does not schedule");
assert(!source.includes("milon_brain_rules"), "a decision does not edit brain rules");
assert(!source.includes("rule_text"), "a decision does not write rule text");
assert(!source.includes("begin_agent_run"), "a decision does not start a run");

const ui = readFileSync("src/components/im-proposal-decisions.tsx", "utf8");
assert(ui.includes("Locked cap:"), "the approve screen shows the cap");
assert(ui.includes("ROUTINE_RUNS_PER_FIRM_MONTH"), "the cap is the locked constant");
assert(ui.includes("costLine"), "the approve screen shows the estimated cost");
assert(!ui.includes("enqueue"), "the approve screen does not enqueue");

const panel = readFileSync("src/components/practice-setup-panel.tsx", "utf8");
assert(panel.includes("ImProposalDecisions"), "the practice page has the approve screen");

console.log("im-proposal-decision ok");
