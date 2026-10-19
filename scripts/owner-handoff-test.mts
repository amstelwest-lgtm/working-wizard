/**
 * Owner hand-off rules. No database. Run: pnpm test:owner-handoff
 */
import { readFileSync } from "node:fs";
import { agentDisplayName } from "../src/lib/milon-team.ts";
import {
  callerMayHandOff,
  handoffAgainInputs,
  handoffAssigneeName,
  handoffDecision,
  handoffDraftIsDuplicate,
  handoffDraftTitle,
  handoffFinding,
  handoffInputs,
  handoffNeedsFreshRun,
  handoffRequestNote,
  handoffResultNote,
  personAssignmentName,
  personAssignmentNote,
  runnerEnabled,
} from "../src/lib/owner-handoff.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const analyst = handoffDecision("analyst");
assert(analyst.ok && analyst.runner === "agent-analyst", "the analyst has a runner");
assert(analyst.ok && analyst.displayName === agentDisplayName("analyst"), "the analyst note uses the shared name");
assert(analyst.ok && analyst.settingKey === "enabled", "the analyst still uses the original flag");

const manager = handoffDecision("financial_manager");
assert(manager.ok === true, "the financial manager has a runner");
if (manager.ok) {
  assert(manager.runner === "agent-financial-manager", "the financial manager runner is its edge function");
  assert(manager.agent === "financial_manager", "the financial manager key is unchanged");
  assert(manager.settingKey === "financial_manager_enabled", "the financial manager has its own flag");
}

const advisor = handoffDecision("advisor");
assert(advisor.ok === true, "the advisor has a runner");
if (advisor.ok) {
  assert(advisor.runner === "agent-advisor", "the advisor runner is its edge function");
  assert(advisor.agent === "advisor", "the advisor key is unchanged");
  assert(advisor.settingKey === "advisor_enabled", "the advisor has its own flag");
}
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
assert(personAssignmentNote("theo") === "Assigned to theo.", "a person note names the assignee");
assert(personAssignmentName("Assigned to theo.") === "theo", "reload reads the person from the note");
assert(personAssignmentName("Assigned to theo. Sent the pack.") === "theo", "a later sentence stays out of the name");
const finished = handoffResultNote("Milōn Financial Manager", "Drafts are recorded.");
assert(finished.startsWith("Financial Manager finished:"), "a finished note does not repeat the hand-off");
assert(finished.includes("Drafts are recorded."), "a finished note keeps the result");
assert(handoffAssigneeName(finished) === null, "a finished note is not a new assignment");
assert(
  handoffResultNote("Milōn Analyst", "Cash is the lever.").startsWith("Analyst finished:"),
  "the finished note names the short role",
);

assert(
  handoffDraftTitle("Audit and renegotiate your top 5 supplier contracts") ===
    "Hand-off: Audit and renegotiate your top 5 supplier contracts",
  "a hand-off draft is labelled with the action",
);
assert(
  handoffDraftIsDuplicate("Audit and renegotiate your top 5 supplier contracts", [
    "Hand-off: Audit and renegotiate your top 5 supplier contracts",
  ]),
  "the same hand-off does not add a second draft",
);
assert(
  !handoffDraftIsDuplicate("Audit and renegotiate your top 5 supplier contracts", [
    "Chase the March invoices",
  ]),
  "a different draft is not this hand-off",
);
const job = readFileSync("supabase/functions/_shared/agent-core/job.ts", "utf8");
assert(job.includes("handoffDraftTitle"), "a finished hand-off labels its draft");
assert(job.includes("handoffDraftIsDuplicate"), "a finished hand-off skips a duplicate draft");

assert(handoffFinding({ summary: "Cash", figures: {}, periodLabel: null, snapshotId: null }) === null, "empty figures are not a finding");
const finding = handoffFinding({
  summary: "Cash is the lever.",
  figures: { cash: 1200, nope: Number.NaN },
  periodLabel: "Sep 2026",
  snapshotId: null,
});
assert(finding?.evidence.figures && (finding.evidence.figures as { cash: number }).cash === 1200, "a finding keeps stored figures");
assert(finding && !("nope" in (finding.evidence.figures as object)), "a finding drops a non-number");
assert(finding?.severity === "act" && finding.evidence.status === "critical", "cash under the floor is act and critical");

const fn = readFileSync("supabase/functions/owner-handoff/index.ts", "utf8");
const decideAt = fn.indexOf("handoffDecision");
const insertAt = fn.indexOf('.from("agent_runs")');
const enabledAt = fn.indexOf("if (!runnerEnabled");
assert(decideAt > 0 && enabledAt > decideAt && insertAt > enabledAt, "a missing or disabled runner returns before a run is inserted");
assert(fn.includes("owner_user_id") && fn.includes("client_memberships"), "the function checks the owner and the workspace");
assert(fn.includes("callerMayHandOff"), "the access decision is the shared check");
assert(fn.includes("action.client_id !== clientId"), "the action must belong to that client");
assert(fn.includes('rpc("agent_invoke"'), "the runner is triggered with the service role");
assert(fn.includes("let invokeInputs = inputs"), "the invoke starts from the action key");
assert(
  (fn.match(/invokeInputs = againInputs/g) ?? []).length >= 2,
  "a new second run and a reused queued row both switch to the again key",
);
const invoke = fn.slice(fn.indexOf('rpc("agent_invoke"'), fn.indexOf('rpc("agent_invoke"') + 400);
assert(invoke.includes("inputs: invokeInputs"), "the invoke sends the second-run key");
assert(fn.includes("decision.runner"), "the invoke target is the resolved runner");
assert(handoffNeedsFreshRun("succeeded") && handoffNeedsFreshRun("partial") && handoffNeedsFreshRun("failed"), "a finished run is not the current hand-off");
assert(!handoffNeedsFreshRun("queued") && !handoffNeedsFreshRun("running"), "an open run stays the current hand-off");
assert(
  handoffAgainInputs("f6446efd-568b-477a-9f6b-f055a7d4a5e4", "run-advisor") ===
    "action_item:f6446efd-568b-477a-9f6b-f055a7d4a5e4:again:run-advisor",
  "handing the same action back uses a new idempotency material",
);
assert(fn.includes("handoffNeedsFreshRun"), "a finished run starts another hand-off");
assert(fn.includes("handoffAgainInputs"), "the repeat run does not reuse the finished key");
assert(fn.includes("writeAssignment"), "every hand-off stores the assignee and a note");
assert(fn.includes("noted: true"), "the client can tell the note was stored");
assert(fn.includes("personId"), "a person hand-off uses the same function");
assert(fn.includes("personAssignmentNote"), "the person note names the assignee");
assert(fn.includes("cancelQueuedRuns"), "a person assignment clears a queued bot run");
assert(fn.includes("assigned_to_person"), "the cleared run records why it stopped");
const openRun = fn.slice(fn.indexOf("!handoffNeedsFreshRun(status)"), fn.indexOf("!handoffNeedsFreshRun(status)") + 700);
assert(openRun.includes("writeAssignment"), "an open run still writes the hand-off note");
assert(fn.includes("decision.settingKey"), "each bot checks its own flag");
assert(!fn.includes("no_runner"), "a known bot is not rejected for a missing runner");
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
const handoffClient = readFileSync("src/lib/owner-handoff-client.ts", "utf8");
assert(plan.includes("commitActionHandoff"), "the owner button commits the hand-off");
assert(handoffClient.includes("requestOwnerHandoff"), "the commit calls the function");
assert(handoffClient.includes("recordHandoffAssignment"), "a finished or offline run still writes the note");
assert(handoffClient.includes("!result.noted"), "the client writes the note when the server has not confirmed it");
assert(handoffClient.includes("signedInActorLabel"), "a person note is written by the signed-in actor");
assert(plan.includes("assignActionToPerson"), "the owner action plan uses the same person assignment");
assert(handoffClient.includes("dispatchActionPlanRefresh"), "home hears the assignment");
const commit = handoffClient.slice(handoffClient.indexOf("export async function commitActionHandoff"));
assert(
  commit.indexOf("dispatchActionPlanRefresh") < commit.indexOf("requestOwnerHandoff"),
  "Working is painted before the hand-off function returns",
);
assert(commit.includes("since"), "the click time travels with the optimistic row");
const person = handoffClient.slice(handoffClient.indexOf("export async function assignActionToPerson"));
assert(
  person.indexOf("dispatchActionPlanRefresh") < person.indexOf("requestPersonAssignment"),
  "the person note is painted before the assignment returns",
);
assert(person.includes("personAssignmentNote"), "the optimistic person note names the assignee");
assert(handoffClient.includes("actor_label"), "notes keep the author");
assert(handoffClient.includes("failed: true"), "a failed hand-off drops the optimistic row");
assert(!plan.includes('.from("agent_runs")'), "the owner view does not insert a run");

const config = readFileSync("supabase/config.toml", "utf8");
assert(config.includes("[functions.owner-handoff]"), "the function is registered");
assert(/\[functions\.owner-handoff\]\nverify_jwt = true/.test(config), "the caller JWT is required");

console.log("owner-handoff ok");
