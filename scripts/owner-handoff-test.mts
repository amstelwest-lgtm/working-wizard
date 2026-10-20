/**
 * Owner hand-off rules. No database. Run: pnpm test:owner-handoff
 */
import { readFileSync } from "node:fs";
import { displayedHandoffRun, withPendingNote } from "../src/lib/open-plan-home.ts";
import { agentDisplayName } from "../src/lib/milon-team.ts";
import {
  callerMayHandOff,
  handoffAgainInputs,
  handoffAssigneeName,
  handoffDecision,
  handoffDraftIsDuplicate,
  handoffDraftTitle,
  handoffCollisionResult,
  handoffFinding,
  handoffInputs,
  handoffNeedsFreshRun,
  planHandoffRun,
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
assert(fn.includes("const invokeInputs = inputs"), "the invoke sends the key chosen for this run");
assert(fn.includes("planHandoffRun"), "the newest run decides reuse or one new key");
assert(fn.includes("handoffCollisionResult"), "a duplicate insert returns the run that won");
assert(!fn.includes("guard < 5"), "a long again-chain is not walked");
assert(!fn.includes("run_not_queued"), "already having runs is not a 500");
assert(fn.includes("run_lookup_failed") && fn.includes("run_insert_failed"), "a real read or insert failure has its own code");
assert(fn.includes("reused: true"), "a queued run is returned without a new note");
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
assert(readFileSync("src/lib/owner-handoff.ts", "utf8").includes("handoffAgainInputs"), "a repeat run does not reuse the finished key");
assert(fn.includes("const handoffActor = user.email"), "the hand-off note is written by the signed-in person");
assert(!fn.includes("actorLabel: decision.displayName"), "a hand-off note is not authored by the bot");
assert(
  (fn.match(/actorLabel: handoffActor/g) ?? []).length >= 3,
  "a new hand-off note is written by the signed-in person",
);
assert(fn.includes("writeAssignment"), "every hand-off stores the assignee and a note");
assert(fn.includes("noted: true"), "the client can tell the note was stored");
assert(fn.includes("personId"), "a person hand-off uses the same function");
assert(fn.includes("personAssignmentNote"), "the person note names the assignee");
assert(fn.includes("cancelQueuedRuns"), "a person assignment clears a queued bot run");
assert(fn.includes("assigned_to_person"), "the cleared run records why it stopped");
const reuse = fn.slice(fn.indexOf('plan.action === "reuse"'), fn.indexOf('plan.action === "reuse"') + 500);
assert(reuse.includes("reused: true") && !reuse.includes("writeAssignment"), "a queued run does not write another note");
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
const workingBlock = commit.slice(commit.indexOf("const working"), commit.indexOf("rememberOptimistic"));
assert(workingBlock.includes("note"), "Handed to paints with the click time");
assert(
  commit.indexOf("dispatchActionPlanRefresh") < commit.indexOf("signedInActorLabel"),
  "the Handed-to line does not wait on the signed-in name",
);
assert(commit.includes("else if (result.noted)"), "a noted response reconciles the Handed-to line");
const reuseBranch = commit.slice(commit.indexOf("result.reused"), commit.indexOf("else if (!result.noted)"));
assert(!reuseBranch.includes("note,"), "a reuse does not add a Handed-to line");
const notedBranch = commit.slice(commit.indexOf("else if (result.noted)"));
assert(notedBranch.includes("note,"), "a noted response adds the Handed-to line");
const commitBody = handoffClient.slice(
  handoffClient.indexOf("export async function commitActionHandoff"),
  handoffClient.indexOf("async function writePersonAssignment"),
);
assert(commitBody.includes("signedInActorLabel"), "the optimistic hand-off note uses the signed-in person");
assert(commitBody.includes('actorType: "owner_app"'), "the optimistic hand-off note is a person, not the bot");
assert(!commitBody.includes("actorLabel: assigneeName"), "the bot is not the hand-off author");
assert(!commitBody.includes('actorType: "system"'), "the optimistic hand-off is not stored as the system actor");
const fallback = handoffClient.slice(
  handoffClient.indexOf("export async function recordHandoffAssignment"),
  handoffClient.indexOf("export type ActionHandoffCommit"),
);
assert(fallback.includes("signedInActorLabel"), "the offline note is also the signed-in person");
assert(!fallback.includes("actor_label: name"), "the offline note does not name the bot as the author");
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

const actionId = "d596c54b-c700-46d4-a56c-dcf430388e48";
const priorRuns = ["run-1", "run-2", "run-3", "run-4", "run-5", "run-6"].map((id) => ({
  id,
  status: "succeeded",
}));
const sixth = planHandoffRun(priorRuns[5]!, actionId);
assert(sixth.action === "insert" && sixth.inputs === `action_item:${actionId}:again:run-6`, "the seventh hand-off keys off the newest finished run");
assert(planHandoffRun(null, actionId).action === "insert" && planHandoffRun(null, actionId).inputs === `action_item:${actionId}`, "the first run keeps the original key");
const queued = planHandoffRun({ id: "run-open", status: "queued" }, actionId);
assert(queued.action === "reuse" && queued.runId === "run-open", "a queued run is reused");
const running = planHandoffRun({ id: "run-open", status: "running" }, actionId);
assert(running.action === "reuse", "a running run is reused");

const firstClick = planHandoffRun(priorRuns[5]!, actionId);
const secondClick = planHandoffRun(priorRuns[5]!, actionId);
assert(
  firstClick.action === "insert" && secondClick.action === "insert" && firstClick.inputs === secondClick.inputs,
  "two concurrent clicks plan the same key",
);
const winner = handoffCollisionResult({ id: "run-7", status: "queued" });
assert(winner.reused && winner.noted === false && winner.runId === "run-7", "the losing click returns the one inserted run");

const keyStore = new Map<string, { id: string; status: string }>();
let insertedCount = 0;
function insertOrCollide(inputs: string): { created: true; id: string } | { created: false; code: "23505" } {
  if (keyStore.has(inputs)) return { created: false, code: "23505" };
  const id = `run-new-${++insertedCount}`;
  keyStore.set(inputs, { id, status: "queued" });
  return { created: true, id };
}
async function postAgain() {
  const plan = planHandoffRun(priorRuns[5]!, actionId);
  await Promise.resolve();
  if (plan.action !== "insert") {
    return { created: false, reused: true, noted: false, runId: plan.runId };
  }
  const inserted = insertOrCollide(plan.inputs);
  if (!inserted.created) {
    const held = keyStore.get(plan.inputs)!;
    return { created: false, ...handoffCollisionResult(held) };
  }
  return { created: true, reused: false, noted: true, runId: inserted.id };
}
const [firstPost, secondPost] = await Promise.all([postAgain(), postAgain()]);
assert(keyStore.size === 1, "two concurrent posts give one run");
assert(firstPost.runId === secondPost.runId, "both posts return the same run id");
assert(Number(firstPost.created) + Number(secondPost.created) === 1, "only one post inserts");
const losingPost = firstPost.created ? secondPost : firstPost;
assert(losingPost.reused === true && losingPost.noted === false, "the losing click does not write a note");
assert(insertedCount === 1, "a double-click inserts one run");

const { applyLiveRuns } = await import("../src/lib/open-plan-home.ts");
const { handoffRowStillWorking, handoffRunForAction } = await import("../src/lib/agent-activity-poll.ts");
const card1 = {
  id: "card-1",
  assigneeName: "Analyst",
  agent: "analyst" as const,
  open: true,
  openedAt: "2026-10-19T21:21:06.000Z",
  runId: "run-a",
};
const card2 = {
  id: "card-2",
  assigneeName: "Analyst",
  agent: "analyst" as const,
  open: true,
  openedAt: "2026-10-19T21:21:13.000Z",
  runId: "run-b",
};
const overlapped = applyLiveRuns([card1, card2], [
  { id: "run-b", actionItemId: "card-2", agent: "analyst", status: "succeeded", at: "2026-10-19T21:21:27.000Z" },
  { id: "run-old", actionItemId: "card-1", agent: "analyst", status: "succeeded", at: "2026-10-19T21:20:36.000Z" },
]);
assert(overlapped.find((row) => row.id === "card-1")?.open === true, "card 2 finishing does not clear card 1");
assert(
  handoffRunForAction(
    [
      { id: "run-b", actionItemId: "card-2", agent: "analyst", status: "succeeded" },
      { id: "run-a", actionItemId: "card-1", agent: "analyst", status: "queued" },
    ],
    "card-1",
    "run-a",
  )?.id === "run-a",
  "card 2's run is not returned for card 1",
);
assert(
  handoffRowStillWorking(card1, [
    { id: "run-b", action_item_id: "card-2", agent: "analyst", status: "succeeded" },
    { id: "run-a", action_item_id: "card-1", agent: "analyst", status: "queued" },
  ]),
  "card 1 stays Working on its own run id",
);
const settledCard = applyLiveRuns([card1], [
  { id: "run-a", actionItemId: "card-1", agent: "analyst", status: "succeeded", at: "2026-10-19T21:22:00.000Z" },
]);
assert(settledCard[0]?.open === false, "card 1 stops Working when its own run finishes");

const {
  rememberOptimistic,
  readOptimisticHandoffs,
  rejectOptimisticHandoff,
  suppressOptimisticNote,
  stripSuppressedNotes,
  resetHandoffOptimistic,
  HANDOFF_FAILED_COPY,
} = await import("../src/lib/owner-handoff-client.ts");
resetHandoffOptimistic();
const since = "2026-10-19T21:21:06.000Z";
rememberOptimistic({
  actionItemId: "card-1",
  title: "Target a D/E",
  since,
  agent: "analyst",
  assigneeName: "Milōn Analyst",
  note: { note: "Handed to Milōn Analyst.", at: since, actorLabel: "amstel.west", actorType: "owner_app" },
});
rememberOptimistic({
  actionItemId: "card-2",
  title: "Get customers to pay faster",
  since: "2026-10-19T21:21:13.000Z",
  agent: "analyst",
  assigneeName: "Milōn Analyst",
  note: {
    note: "Handed to Milōn Analyst.",
    at: "2026-10-19T21:21:13.000Z",
    actorLabel: "amstel.west",
    actorType: "owner_app",
  },
});
assert(readOptimisticHandoffs().length === 2, "two cards keep their own optimistic hand-offs");
const painted = stripSuppressedNotes({
  "card-1": [
    { note: "Handed to Milōn Analyst.", at: "2026-10-19T21:20:22.000Z" },
    { note: "Handed to Milōn Analyst.", at: since },
  ],
  "card-2": [{ note: "Handed to Milōn Analyst.", at: "2026-10-19T21:21:13.000Z" }],
});
rejectOptimisticHandoff("card-1", since, HANDOFF_FAILED_COPY);
const afterError = stripSuppressedNotes(painted);
assert(
  afterError["card-1"]?.every((row) => row.at !== since) && afterError["card-2"]?.length === 1,
  "an error drops that action's note and a later paint cannot put it back",
);
assert(readOptimisticHandoffs().every((row) => row.actionItemId !== "card-1"), "the failed click leaves the other card");
resetHandoffOptimistic();
rememberOptimistic({
  actionItemId: "card-1",
  title: "Target a D/E",
  since,
  agent: "analyst",
  assigneeName: "Milōn Analyst",
  note: { note: "Handed to Milōn Analyst.", at: since, actorLabel: "amstel.west", actorType: "owner_app" },
});
suppressOptimisticNote("card-1", since);
const reusedNotes = stripSuppressedNotes({
  "card-1": [
    { note: "Handed to Milōn Analyst.", at: "2026-10-19T21:20:22.000Z" },
    { note: "Handed to Milōn Analyst.", at: since },
  ],
});
assert(reusedNotes["card-1"]?.every((row) => row.at !== since), "a reused run adds no new Handed-to line");
assert(readOptimisticHandoffs()[0]?.runId == null && readOptimisticHandoffs()[0]?.note == null, "reuse keeps the click without the phantom note");
const reusedRow = applyLiveRuns(
  [{ ...card1, runId: "run-open", openedAt: since }],
  [{ id: "run-open", actionItemId: "card-1", agent: "analyst", status: "queued", at: "2026-10-19T21:20:22.000Z" }],
);
assert(reusedRow[0]?.open === true, "the existing queued run stays Working");
const whileRunning = [
  { note: "Handed to Analyst.", at: "2026-10-19T22:00:52.450Z" },
  { note: "Analyst finished: Recorded 1 finding: Cash is thin.", at: "2026-10-19T22:00:46.000Z" },
];
assert(
  withPendingNote(whileRunning, null).length === whileRunning.length,
  "a reuse while running doesn't change the note count",
);
const keptRun = displayedHandoffRun(
  { id: "run-open", agent: "analyst", status: "running", at: "2026-10-19T22:00:25.000Z" },
  { agent: "analyst", since: "2026-10-19T22:01:36.000Z" },
  false,
);
assert(
  keptRun != null && "id" in keptRun && keptRun.id === "run-open" && keptRun.status === "running",
  "a reuse while running keeps Working on the existing run id",
);
resetHandoffOptimistic();

const clientPage = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const door = readFileSync("src/components/owner-door/owner-door.tsx", "utf8");
assert(clientPage.includes("pendingHandoffs") && door.includes("pendingHandoffs"), "both Homes keep a hand-off per action");
assert(clientPage.includes("runId") && door.includes("runId"), "both Homes track the run id");
assert(door.includes("data-handoff-error") || readFileSync("src/components/owner-door/owner-home.tsx", "utf8").includes("data-handoff-error"), "owner Home shows the hand-off error");
assert(readFileSync("src/components/financial-manager-brief.tsx", "utf8").includes("error={item.error}"), "accountant Home shows the hand-off error");

console.log("owner-handoff ok");
