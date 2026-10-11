/**
 * Owner hand-off rules. No database. Run: pnpm test:owner-handoff
 */
import { readFileSync } from "node:fs";
import { agentDisplayName } from "../src/lib/milon-team.ts";
import {
  callerMayHandOff,
  handoffAssigneeName,
  handoffDecision,
  handoffFinding,
  handoffInputs,
  handoffRequestNote,
  handoffResultNote,
  runnerEnabled,
} from "../src/lib/owner-handoff.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const analyst = handoffDecision("analyst");
assert(analyst.ok && analyst.runner === "agent-analyst", "the analyst has a runner");
assert(analyst.ok && analyst.displayName === agentDisplayName("analyst"), "the analyst note uses the shared name");

const manager = handoffDecision("financial_manager");
assert(!manager.ok && manager.error === "no_runner", "the financial manager has no runner");
assert(
  !manager.ok && manager.missing.includes("agent-analyst") && manager.missing.includes("financial_manager"),
  "the financial manager message names what is missing",
);

const advisor = handoffDecision("advisor");
assert(!advisor.ok && advisor.error === "no_runner", "the advisor has no runner");
assert(!advisor.ok && advisor.missing.includes("advisor"), "the advisor message names the missing runner");
assert(handoffDecision("bookkeeper").error === "unknown_agent", "an unknown bot is rejected");

assert(
  callerMayHandOff({ userId: "owner", ownerUserId: "owner", isWorkspaceMember: false }),
  "the owner can hand off",
);
assert(
  callerMayHandOff({ userId: "member", ownerUserId: "owner", isWorkspaceMember: true }),
  "a workspace member can hand off",
);
assert(
  !callerMayHandOff({ userId: "accountant", ownerUserId: "owner", isWorkspaceMember: false }),
  "someone outside the workspace cannot hand off",
);
assert(runnerEnabled(true) && runnerEnabled("true"), "the dispatch switch can be on");
assert(!runnerEnabled(false) && !runnerEnabled("false") && !runnerEnabled(null), "the dispatch switch defaults off");

assert(handoffInputs("abc") === "action_item:abc", "the run inputs name the action");
assert(handoffAssigneeName("Handed to Milōn Analyst") === "Milōn Analyst", "a request note names the bot");
assert(
  handoffAssigneeName("Handed to Milōn Analyst. Cash is the lever.") === "Milōn Analyst",
  "a result note keeps the bot name and drops the sentence",
);
assert(handoffAssigneeName("Assigned to Ada") === null, "a person assignment is not a bot hand-off");
assert(handoffRequestNote("Milōn Analyst") === "Handed to Milōn Analyst.", "the queued note names the bot");
assert(
  handoffResultNote("Milōn Analyst", "Cash is the lever.").startsWith("Handed to Milōn Analyst."),
  "the finished note starts with the bot",
);

assert(handoffFinding({ summary: "Cash", figures: {}, periodLabel: null, snapshotId: null }) === null, "empty figures are not a finding");
const finding = handoffFinding({
  summary: "Cash is the lever.",
  figures: { cash: 1200, nope: Number.NaN },
  periodLabel: "Sep 2026",
  snapshotId: null,
});
assert(finding?.evidence.figures && (finding.evidence.figures as { cash: number }).cash === 1200, "a finding keeps stored figures");
assert(finding && !("nope" in (finding.evidence.figures as object)), "a finding drops a non-number");

const fn = readFileSync("supabase/functions/owner-handoff/index.ts", "utf8");
const decideAt = fn.indexOf("handoffDecision");
const insertAt = fn.indexOf('.from("agent_runs")');
const enabledAt = fn.indexOf("if (!runnerEnabled");
assert(decideAt > 0 && enabledAt > decideAt && insertAt > enabledAt, "a missing or disabled runner returns before a run is inserted");
assert(fn.includes("owner_user_id") && fn.includes("client_memberships"), "the function checks the owner and the workspace");
assert(fn.includes("callerMayHandOff"), "the access decision is the shared check");
assert(fn.includes("action.client_id !== clientId"), "the action must belong to that client");
assert(fn.includes('rpc("agent_invoke"'), "the analyst runner is triggered with the service role");
assert(!fn.includes("GRANT INSERT"), "the function does not grant client writes");

const sql = readFileSync("supabase/migrations/20261012090000_owner_handoff_action_item.sql", "utf8");
assert(sql.includes("action_item_id"), "a run can point at the action");
assert(sql.includes("REVOKE ALL ON public.agent_runs FROM PUBLIC, anon, authenticated"), "authenticated clients cannot write runs");
assert(sql.includes("GRANT SELECT ON public.agent_runs TO authenticated"), "authenticated clients can still read runs");
assert(!sql.includes("TO authenticated;\nGRANT INSERT") && !sql.includes("GRANT ALL ON public.agent_runs TO authenticated"), "insert stays off the client");

const run = readFileSync("supabase/functions/agent-analyst/run.ts", "utf8");
assert(run.includes("recordHandoffFinish"), "a finished analyst run writes the hand-off result");
assert(run.includes("handoffFinding"), "a finding is built only from stored figures");

const plan = readFileSync("src/components/action-plan.tsx", "utf8");
assert(plan.includes("requestOwnerHandoff"), "the owner button calls the function");
assert(!plan.includes('.from("agent_runs")'), "the owner view does not insert a run");

const config = readFileSync("supabase/config.toml", "utf8");
assert(config.includes("[functions.owner-handoff]"), "the function is registered");
assert(/\[functions\.owner-handoff\]\nverify_jwt = true/.test(config), "the caller JWT is required");

console.log("owner-handoff ok");
