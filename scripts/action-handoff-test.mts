/**
 * Hand-off assignment and the accountant agent stage.
 * No database. Run: pnpm test:action-handoff
 */
import { readFileSync } from "node:fs";
import {
  agentKeyFromAssignee,
  assignmentNoteFace,
  botPickupCaption,
  describeActionHandoff,
  formatAssignmentNote,
  HANDOFF_COST_STOP,
  handoffButtonLabel,
  handoffClock,
  handoffCouldNotDraft,
  handoffCouldNotFinish,
  handoffIsSlow,
  handoffProgressCaption,
  handoffTriggerLabel,
  moveRowStatus,
} from "../src/lib/action-handoff.ts";
import { agentDisplayName, agentShortName } from "../src/lib/milon-team.ts";
import { AGENT_KEYS } from "../src/lib/milon-team-feed.ts";
import { HANDOFF_RUN_WAIT_MS, pollAfterTick } from "../src/lib/agent-activity-poll.ts";
import { deskSignoffText } from "../src/lib/milon-team-activity.ts";
import { assignmentForMove, moveLoadMayCache, moveRowMatches } from "../src/lib/owner-handoff.ts";
import { displayedAssignee, latestStoredAssignment } from "../src/lib/open-plan-home.ts";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const running = { status: "running" };
const finished = { status: "succeeded" };
assert(pollAfterTick([running, running]) === "continue", "two open runs keep the poll armed");
assert(
  pollAfterTick([finished, running]) === "continue",
  "the poll continues after the first of two staggered runs finishes",
);
assert(pollAfterTick([finished, finished]) === "stop", "the poll stops after the second run finishes");
const noted = "2026-10-19T10:00:00.000Z";
const notedMs = Date.parse(noted);
assert(
  pollAfterTick([], [{ openedAt: noted }], notedMs + 30_000) === "continue",
  "a new hand-off with no matching run polls while that run may still appear",
);
assert(
  pollAfterTick([], [{ openedAt: noted }], notedMs + HANDOFF_RUN_WAIT_MS + 1) === "stop",
  "a hand-off note with no matching run stops after about two minutes",
);
assert(
  pollAfterTick([finished, running], [{ openedAt: noted }], notedMs + HANDOFF_RUN_WAIT_MS + 1) === "continue",
  "a still-running second run keeps the poll going after the wait",
);

assert(agentKeyFromAssignee("Milōn Analyst") === "analyst", "the assignee label names the analyst");
assert(agentKeyFromAssignee("Analyst") === "analyst", "the short name is the same agent");
assert(agentKeyFromAssignee("Ada Mbeki") === null, "a person is not an agent");
assert(
  handoffButtonLabel("analyst", false) === "Hand to Milōn Analyst",
  "an open button names the bot",
);
assert(
  handoffButtonLabel("analyst", true) === "Assigned to Analyst ✓",
  "the assigned button names the short role",
);
for (const agent of AGENT_KEYS) {
  const open = handoffButtonLabel(agent, false);
  assert(open === `Hand to ${agentDisplayName(agent)}`, `one space before ${agentDisplayName(agent)}`);
  assert(!open.includes("  "), `${agent} label has a double space: ${JSON.stringify(open)}`);
  const handed = handoffTriggerLabel(`  ${agentDisplayName(agent)}  `);
  assert(handed === `Handed to ${agentDisplayName(agent)}`, handed);
  assert(!handed.includes("  "), `${agent} trigger has a double space`);
  assert(
    handoffTriggerLabel(agentDisplayName(agent), true) === `Handed to ${agentShortName(agent)}`,
    "a narrow screen uses the short name",
  );
}
assert(handoffTriggerLabel("  Milōn Advisor") === "Handed to Milōn Advisor", "a padded advisor name keeps one space");
assert(handoffTriggerLabel(null) === "Hand to", "an empty assignee stays Hand to");
assert(handoffTriggerLabel("  Ada Mbeki  ") === "Hand to Ada Mbeki", "a person stays Hand to");
assert(
  handoffProgressCaption("analyst", "queued") === "Analyst is queued",
  "a queued run is waiting",
);
assert(
  handoffProgressCaption("analyst", "running") === "Analyst picked this up",
  "a running run is a pickup",
);
const finishedAt = "2026-10-19T18:31:22.000Z";
const handoffNow = new Date(finishedAt);
const zaMarket = { locale: "en-ZA", timezone: "Africa/Johannesburg" };
const usMarket = { locale: "en-US", timezone: "America/New_York" };
const draftId = "5a2b1d31-1b64-49dd-a02a-cdd764714d3d";
assert(
  handoffProgressCaption("financial_manager", "succeeded", { draftId }) === "Financial Manager finished",
  "a finished run stays on the action when a draft id is present",
);
const claimed = handoffProgressCaption("financial_manager", "succeeded", {
  result: "Drafts are recorded. A person approves them before anything is sent.",
});
assert(
  claimed === handoffCouldNotDraft("financial_manager", claimed),
  "a succeeded run without a draft id is a failure",
);
assert(claimed != null && !claimed.includes("finished"), "finished cannot render without a draft id");
assert(
  handoffProgressCaption("financial_manager", "succeeded", {
    at: finishedAt,
    result: "Drafts are recorded.",
    draftId,
    market: zaMarket,
    now: handoffNow,
  }) === "Financial Manager finished · 20:31 SAST",
  "a finished run names the time and the zone, and the draft id is the proof",
);
assert(
  handoffProgressCaption("advisor", "succeeded", {
    at: "2026-10-20T05:37:00.000Z",
    draftId,
    market: usMarket,
    now: new Date("2026-10-20T05:37:00.000Z"),
  }) === "Advisor finished · 1:37 AM ET",
  "a same-day US finish is the clock and ET",
);
assert(
  handoffProgressCaption("financial_manager", "succeeded", {
    at: "2026-10-19T05:37:00.000Z",
    draftId,
    market: zaMarket,
    now: new Date("2026-10-20T05:37:00.000Z"),
  }) === "Financial Manager finished · 19 Oct 2026, 07:37 SAST",
  "an earlier ZA finish includes the date and SAST",
);
assert(handoffClock(finishedAt, zaMarket, handoffNow) === "20:31 SAST", "same-day ZA clock keeps the zone");
assert(
  botPickupCaption({
    assignee: "theo",
    run: { agent: "advisor", status: "queued", at: finishedAt },
  }) === null,
  "a person row drops the queued bot line",
);
assert(
  handoffProgressCaption("advisor", "failed") === handoffCouldNotDraft("advisor"),
  "a failed run does not say finished",
);
assert(
  !String(handoffProgressCaption("advisor", "failed")).includes("finished"),
  "finished cannot render without a draft id",
);
const notedAt = "2026-10-19T18:31:00.000Z";
assert(
  formatAssignmentNote({ note: "Assigned to theo.", at: notedAt, actorLabel: "amstel.west" }, zaMarket, handoffNow) ===
    "Assigned to theo · by amstel.west · 20:31 SAST",
  "a person note names the author and the time",
);
assert(
  formatAssignmentNote({ note: "Handed to Analyst.", at: notedAt, actorLabel: "amstel.west" }, zaMarket, handoffNow) ===
    "Handed to Analyst · by amstel.west · 20:31 SAST",
  "a hand-off note names the author and the time",
);
const analystName = agentDisplayName("analyst");
assert(
  formatAssignmentNote(
    {
      note: `Handed to ${analystName}.`,
      at: notedAt,
      actorLabel: analystName,
      actorType: "system",
    },
    zaMarket,
    handoffNow,
  ) === `Handed to ${analystName} · 20:31 SAST`,
  "an old hand-off note does not name the bot as the author",
);
assert(
  formatAssignmentNote(
    {
      note: "Handed to Financial Manager.",
      at: "2026-10-20T05:37:00.000Z",
      actorLabel: agentDisplayName("financial_manager"),
      actorType: "system",
    },
    zaMarket,
    new Date("2026-10-20T05:37:00.000Z"),
  ) === "Handed to Financial Manager · 07:37 SAST",
  "a bot hand-off note hides the author and keeps the zone",
);
assert(
  formatAssignmentNote(
    {
      note: `Advisor finished: ${HANDOFF_COST_STOP}`,
      at: notedAt,
      actorLabel: agentDisplayName("advisor"),
      actorType: "system",
    },
    zaMarket,
    handoffNow,
  ) === `${handoffCouldNotFinish("advisor")} · by ${agentDisplayName("advisor")} · 20:31 SAST`,
  "a cost-ceiling finish keeps the agent and hides the raw stop",
);
assert(
  handoffProgressCaption("advisor", "partial", { at: finishedAt, result: HANDOFF_COST_STOP }) ===
    handoffCouldNotFinish("advisor"),
  "a cost stop offers the friendly line",
);
assert(
  !String(handoffProgressCaption("advisor", "succeeded", { result: HANDOFF_COST_STOP })).includes("cost ceiling"),
  "the raw cost-ceiling sentence stays off the row",
);
const handoffAt = "2026-10-19T22:00:00.352Z";
const failureAt = "2026-10-19T22:00:18.856Z";
const afterFailure = assignmentNoteFace([
  { note: "Handed to Analyst.", at: handoffAt },
  { note: `Analyst finished: ${HANDOFF_COST_STOP}`, at: failureAt },
]);
assert(
  afterFailure.face?.note === "Handed to Analyst." && afterFailure.face.at === handoffAt,
  "after a stored hand-off, a failure keeps the hand-off visible after reload",
);
assert(afterFailure.earlier.length === 0, "the failure stays off the note list and on the row status");
const finishAt = "2026-10-19T22:00:46.000Z";
const afterFinish = assignmentNoteFace([
  { note: "Handed to Analyst.", at: handoffAt },
  { note: "Analyst finished: Recorded 3 findings: Cash is thin.", at: finishAt },
]);
assert(afterFinish.face?.at === finishAt, "a newer finish note is the face");
assert(afterFinish.earlier[0]?.at === handoffAt, "the stored hand-off stays when the finish note is newer");
const slowStart = Date.parse("2026-10-19T18:00:00.000Z");
assert(
  handoffIsSlow("queued", "2026-10-19T18:00:00.000Z", slowStart + 3 * 60 * 1000) === false,
  "three minutes is not yet the slow line",
);
assert(
  handoffIsSlow("running", "2026-10-19T18:00:00.000Z", slowStart + 3 * 60 * 1000 + 1),
  "a run past three minutes is slow",
);
assert(
  handoffIsSlow("succeeded", "2026-10-19T18:00:00.000Z", slowStart + 60 * 60 * 1000) === false,
  "a finished run is not the slow line",
);
assert(
  deskSignoffText("Draft", false) === "Advisory pack · still a draft",
  "a bare Draft status says which pack",
);

const plan = readFileSync("src/components/action-plan.tsx", "utf8");
const handoffClient = readFileSync("src/lib/owner-handoff-client.ts", "utf8");
assert(plan.includes("assignToAgent"), "the button assigns the action");
assert(plan.includes("commitActionHandoff"), "the button commits the assignment");
assert(handoffClient.includes("recordHandoffAssignment"), "a switched-off runner still writes the assignee");
assert(plan.includes("toast.success(`Handed to ${agentShortName(agent)}`)"), "hand-off toasts Handed to");
const noDraft = describeActionHandoff({
  actionItemId: "action-1",
  assignee: "Milōn Financial Manager",
  sentAt: null,
  notes: [{ note: "Financial Manager finished: Drafts are recorded.", at: finishedAt }],
  storedRun: { id: "run-1", agent: "financial_manager", status: "succeeded", at: finishedAt },
  runs: [
    {
      id: "run-1",
      agent: "financial_manager",
      status: "succeeded",
      action_item_id: "action-1",
      summary: "Drafts are recorded. A person approves them before anything is sent.",
      finished_at: finishedAt,
      queued_at: finishedAt,
    },
  ],
  findings: [],
  findingsReady: true,
  market: zaMarket,
  now: handoffNow,
});
assert(noDraft.draftId === null && noDraft.phase === "failed", "no finding leaves the action failed");
assert(noDraft.caption != null && !noDraft.caption.includes("finished"), "the row cannot say finished without a draft id");
assert(noDraft.phaseLabel === "Couldn't draft", "the status chip is not Not started");
const withDraft = describeActionHandoff({
  ...noDraft,
  actionItemId: "action-1",
  assignee: "Milōn Financial Manager",
  sentAt: null,
  notes: [{ note: "Financial Manager finished: Drafts are recorded.", at: finishedAt }],
  storedRun: { id: "run-1", agent: "financial_manager", status: "succeeded", at: finishedAt },
  runs: [
    {
      id: "run-1",
      agent: "financial_manager",
      status: "succeeded",
      action_item_id: "action-1",
      summary: "Drafts are recorded. A person approves them before anything is sent.",
      finished_at: finishedAt,
      queued_at: finishedAt,
    },
  ],
  findings: [{ id: draftId, run_id: "run-1", status: null }],
  findingsReady: true,
  market: zaMarket,
  now: handoffNow,
});
assert(withDraft.draftId === draftId && withDraft.phase === "draft_ready", "a finding for the run is Draft ready");
assert(withDraft.caption?.includes("finished") === true, "finished renders once the draft id exists");
assert(plan.includes("HandToMenu"), "the row renders Hand to");
const menu = readFileSync("src/components/hand-to-menu.tsx", "utf8");
assert(menu.includes("toast.success(`Handed to ${agentShortName(agent)}`)"), "Next moves toasts before the request");
assert(menu.includes("ActionHandoffButtons"), "Hand to lists the bots");
assert(menu.includes("data-hand-to-trigger"), "the control is labelled Hand to");
assert(menu.includes("handoffTriggerLabel"), "the trigger is one collapsed string");
assert(menu.includes("hand-to-short"), "a narrow screen can show the short name");
const labels = readFileSync("src/lib/action-handoff.ts", "utf8");
assert(labels.includes("Hand to ${name}") && labels.includes('"Hand to"'), "the button says Hand to");
const phaseMarks = plan.match(/data-handoff-phase=\{phaseLabel/g) ?? [];
assert(phaseMarks.length === 1, "Draft ready is one badge per item");
const toastCss = readFileSync("src/styles.css", "utf8");
assert(toastCss.includes('[data-sonner-toast][data-type="success"]'), "a hand-off success toast stays readable");
assert(toastCss.includes('[data-sonner-toast][data-type="error"]'), "a hand-off error toast stays readable");
assert(toastCss.includes("[data-sonner-toaster]") && toastCss.includes("z-index: 200"), "the toast sits above Hand to");
assert(menu.includes("data-hand-to-person"), "Hand to lists team members");
assert(!menu.includes("Assigning…"), "the button does not stay on Assigning once Working is set");
assert(menu.includes('aria-pressed={current}'), "the current person is marked");
assert(menu.includes(" ✓"), "the current person gets the same check as a bot");
const runBody = menu.slice(menu.indexOf("const run ="));
assert(runBody.includes("setOpen(false)"), "the menu closes on the click");
assert(runBody.includes("void work()"), "the button does not wait on the request");
assert(!runBody.includes("await work()"), "Assigning is not held for the request");
assert(menu.includes("MoveHandTo"), "a Next move can be handed off");
const moves = readFileSync("src/components/strategic-moves-panel.tsx", "utf8");
assert(moves.includes("MoveHandTo"), "accountant Next moves include Hand to");
assert(
  plan.includes("isOwner ? (agent) => void assignToAgent"),
  "owner and accountant both hand off",
);
assert(!plan.includes('.from("agent_runs")'), "the action list does not insert a run");
const buttons = readFileSync("src/components/action-handoff-buttons.tsx", "utf8");
assert(
  buttons.includes(
    'data-handoff-state={waiting ? "coming-soon" : assigned ? "assigned" : "ready"}',
  ),
  "the assigned button is marked",
);
assert(buttons.includes("data-agent-pickup"), "a pickup shows on the action");
assert(buttons.includes("#0B5FFF"), "the buttons use cobalt");
assert(buttons.includes("data-bot-handoff"), "the controls stay on the action row");

const fn = readFileSync("supabase/functions/owner-handoff/index.ts", "utf8");
const disabledAt = fn.indexOf("if (!runnerEnabled");
const assignedAt = fn.indexOf('status: "assigned"');
const runAt = fn.indexOf('.from("agent_runs")');
assert(
  disabledAt > 0 && assignedAt > disabledAt && runAt > assignedAt,
  "a switched-off runner assigns before any run",
);
assert(fn.includes("dispatched: false"), "a parked hand-off does not claim a dispatch");
assert(!fn.includes("ledger_post"), "a hand-off does not post to a ledger");

const client = readFileSync("src/lib/owner-handoff-client.ts", "utf8");
assert(client.includes("dispatched: false"), "the client accepts an assignment with no run");
assert(client.includes("action_updates"), "the fallback writes an action note");
assert(!client.includes(".insert({\n      agent:"), "the client does not insert agent_runs");

const home = readFileSync("src/components/owner-door/owner-home.tsx", "utf8");
assert(home.includes("data-agent-card={card.agent}"), "each finance-team card is addressable");
assert(
  home.includes("onOpen(card.agent)") && home.includes("onAsk(card.agent)"),
  "the card and Ask open the agent",
);
assert(home.includes('event.key !== "Enter"'), "Enter on a card opens the agent");

const clientPage = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(
  clientPage.includes("onSelectAgent={openHomeAgent}"),
  "a client agent opens through the same route",
);
assert(
  clientPage.includes("onOpen={openHomeAgent}") && clientPage.includes("onAsk={openHomeAgent}"),
  "landing cards open the agent",
);
assert(clientPage.includes("withPendingAssignment"), "the accountant home keeps the hand-off on its own row");
assert(clientPage.includes("openedAt"), "a click keeps Working until a newer run arrives");
const status = readFileSync("src/components/handoff-run-status.tsx", "utf8");
assert(status.includes("data-open-draft"), "the finished row links the draft");
assert(status.includes("couldn't draft this"), "a missing draft offers Retry");
assert(status.includes("finished") && status.includes("!openId"), "finished stays off the row without a draft id");
assert(status.includes("Working"), "an open hand-off shows Working on the row");
assert(status.includes("Taking longer than usual ·"), "a slow run names the wait");
assert(status.includes("data-handoff-retry"), "a slow run can be retried");
assert(status.includes("handoffIsSlow"), "the retry line waits three minutes");
assert(status.includes("couldn't finish this one"), "a cost stop offers Retry");
assert(status.includes("data-handoff-stopped"), "a cost stop is its own line");
assert(clientPage.includes("steerOpenHandoffs"), "each open hand-off shows Working on its bot");
assert(clientPage.includes("withCardHandoffRuns"), "accountant cards use the same open runs as the row");
const door = readFileSync("src/components/owner-door/owner-door.tsx", "utf8");
assert(door.includes("withCardHandoffRuns"), "owner cards use the same open runs as the row");
assert(door.includes("cardRunsByAgent"), "a queued run beats Found something on the owner card");
const activityHook = readFileSync("src/hooks/use-agent-activity.ts", "utf8");
assert(activityHook.includes("ACTIVE_POLL_MS = 5000"), "home polls every 5 seconds while a run is open");
assert(activityHook.includes("dispatchActionPlanRefresh"), "the poll reloads notes when a run is open");
assert(activityHook.includes("pollAfterTick"), "each tick decides from the fresh snapshot");
assert(!activityHook.includes("wasActive"), "a finish does not clear the timer from stale render state");
assert(clientPage.includes("useAgentActivity(clientId, awaitingRun)"), "accountant Home polls from open hand-offs");
assert(door.includes("useAgentActivity(clientId ?? \"\", awaitingRun)"), "owner Home uses the same poll");
assert(clientPage.includes("handoffRowStillWorking"), "an old hand-off with no run is not Working");
assert(door.includes("handoffRowStillWorking"), "owner cards drop Working when the run never appears");
const poll = readFileSync("src/lib/agent-activity-poll.ts", "utf8");
assert(
  poll.includes('status === "queued"') && poll.includes('status === "running"'),
  "the poll watches queued and running runs",
);
assert(poll.includes("HANDOFF_RUN_WAIT_MS = 2 * 60 * 1000"), "a missing run is only waited out for two minutes");

const pane = readFileSync("src/components/milon-team/milon-team-pane.tsx", "utf8");
assert(pane.includes("<AgentStage"), "an open agent uses the stage, not only the desk");
assert(pane.includes("onOpenAgent={onSelectAgent}"), "a team chip opens that agent");
assert(
  pane.includes('presentation={agent ? "agent" : "team"}'),
  "the open agent hides the last-run strip",
);

const stage = readFileSync("src/components/milon-team/agent-stage.tsx", "utf8");
assert(stage.includes("OwnerAvatar"), "the stage shows the video face");
assert(stage.includes("agentJobLine"), "the stage shows the role");
assert(stage.includes("data-agent-finding"), "the stage shows the latest finding");
assert(stage.includes("onKeyDown"), "Enter on an agent tab opens that agent");

const css = readFileSync("src/components/owner-door/owner-door.css", "utf8");
const face = css.slice(css.indexOf(".owner-fm-face {"), css.indexOf(".owner-fm-face {") + 500);
assert(face.includes("pointer-events: none"), "the video face does not swallow the card click");

const deskCss = readFileSync("src/components/milon-team/milon-team-desk.css", "utf8");
assert(deskCss.includes("background: #0b5fff"), "Ask uses a cobalt send button");
assert(deskCss.includes("text-transform: none"), "the send label stays sentence case");
assert(deskCss.includes("@media (max-width: 767px)"), "the composer stacks on a phone");
assert(deskCss.includes("min-height: 96px"), "the phone composer is a full field");

const ask = readFileSync("src/lib/ask-ai.js", "utf8");
assert(ask.includes('studio ? "Send" : "Ask"'), "the studio composer says Send");

const moveTitle = "Move fixed contracts to variable / usage-based pricing";
assert(
  moveRowMatches({
    moveKey: "fixedCostRatio",
    title: moveTitle,
    sourceMoveKey: "fixedCostRatio",
    actionTitle: moveTitle,
  }),
  "a Next moves row matches its source_move_key",
);
assert(
  moveRowMatches({
    moveKey: "fixedCostRatio",
    title: moveTitle,
    actionTitle: `Hand-off: ${moveTitle}`,
  }),
  "a Hand-off draft title still matches the move",
);
assert(
  !moveRowMatches({
    moveKey: "fixedCostRatio",
    title: moveTitle,
    actionTitle: "Chase overdue invoices",
  }),
  "a different action is not this move",
);
const matched = assignmentForMove(
  [
    {
      actionItemId: "a1",
      sourceMoveKey: "fixedCostRatio",
      driverKey: "fixedCostRatio",
      title: moveTitle,
      assigneeName: "Milōn Financial Manager",
    },
  ],
  "fixedCostRatio",
  moveTitle,
);
assert(matched?.assigneeName === "Milōn Financial Manager", "the stored assignee is the one on the move");
assert(
  displayedAssignee(null, [{ note: "Handed to Milōn Financial Manager.", at: "2026-10-20T18:00:00.000Z" }]) ===
    "Milōn Financial Manager",
  "a cleared owner still shows the hand-off note",
);
const painted = menu.indexOf("setAssignee(agentDisplayName(agent))");
const ensured = menu.indexOf("const actionItemId = await ensure()");
assert(painted >= 0 && ensured > painted, "Next moves paints the assignee before the row is created");
assert(plan.includes("displayedAssignee(item.owner_name, notes)"), "the action row reads the stored hand-off");
const feedHook = readFileSync("src/hooks/use-milon-team-feed.ts", "utf8");
assert(feedHook.includes("action_updates"), "the team activity reads hand-off notes");
assert(feedHook.includes("ACTION_PLAN_REFRESH_EVENT"), "the activity list refetches after Hand to");

const blankThenNoted = assignmentForMove(
  [
    {
      actionItemId: "newer-blank",
      sourceMoveKey: "fixedCostRatio",
      driverKey: "fixedCostRatio",
      title: moveTitle,
      assigneeName: null,
      assignedAt: null,
    },
    {
      actionItemId: "original",
      sourceMoveKey: "fixedCostRatio",
      driverKey: "fixedCostRatio",
      title: moveTitle,
      assigneeName: "Milōn Analyst",
      assignedAt: "2026-10-20T18:05:00.000Z",
    },
  ],
  "fixedCostRatio",
  moveTitle,
);
assert(
  blankThenNoted?.actionItemId === "original" && blankThenNoted.assigneeName === "Milōn Analyst",
  "an immediate reload keeps the noted reassign, not a newer row with no hand-off",
);
const reassigned = assignmentForMove(
  [
    {
      actionItemId: "fm-row",
      sourceMoveKey: "fixedCostRatio",
      driverKey: "fixedCostRatio",
      title: moveTitle,
      assigneeName: "Milōn Financial Manager",
      assignedAt: "2026-10-20T18:00:00.000Z",
    },
    {
      actionItemId: "analyst-row",
      sourceMoveKey: "fixedCostRatio",
      driverKey: "fixedCostRatio",
      title: moveTitle,
      assigneeName: "Milōn Analyst",
      assignedAt: "2026-10-20T18:05:00.000Z",
    },
  ],
  "fixedCostRatio",
  moveTitle,
);
assert(reassigned?.assigneeName === "Milōn Analyst", "a later hand-off note wins on the immediate refetch");
assert(
  latestStoredAssignment([
    { note: "Handed to Milōn Financial Manager.", at: "2026-10-20T18:00:00.000Z" },
    { note: "Handed to Milōn Analyst.", at: "2026-10-20T18:05:00.000Z" },
  ])?.name === "Milōn Analyst",
  "the newest note on one action is the reassign, not the earlier Financial Manager",
);
assert(moveLoadMayCache(1, 2) === false, "a read started before the commit is not cached");
assert(moveLoadMayCache(2, 2) === true, "a read started after the commit may be cached");
const working = moveRowStatus({ runStatus: "running" });
assert(working.phase === "working" && working.label === "Working…", "an open run shows Working on the move row");
const ready = moveRowStatus({ runStatus: "succeeded", draftId: "d1" });
assert(
  ready.phase === "draft_ready" && ready.label === "Draft ready" && ready.draftId === "d1",
  "a saved draft shows Draft ready",
);
const draftWins = moveRowStatus({ runStatus: "queued", draftId: "d1" });
assert(draftWins.phase === "draft_ready" && draftWins.draftId === "d1", "a draft wins over a still-queued run");

const ensure = readFileSync("src/lib/ensure-plan-item.ts", "utf8");
const keyLookup = ensure.indexOf('eq("source_move_key", input.moveKey)');
const itemInsert = ensure.lastIndexOf(".insert({");
assert(
  ensure.includes('.eq("client_id", input.clientId)') && keyLookup >= 0 && keyLookup < itemInsert,
  "a reassign reuses the client's original move before inserting another action",
);
const committedBranch = menu.slice(menu.indexOf("if (detail?.committed)"));
assert(
  committedBranch.startsWith("if (detail?.committed)") &&
    committedBranch.includes("invalidateMoveAssignments") &&
    committedBranch.indexOf("invalidateMoveAssignments") < committedBranch.indexOf("loadClientMoveAssignments"),
  "Next moves drops the cache and refetches only after the hand-off is committed",
);
assert(menu.includes('data-move-phase="working"') && menu.includes("Working…"), "the move row shows Working");
assert(menu.includes('data-move-phase="draft-ready"'), "the move row links Draft ready");
const awaited = handoffClient.indexOf("await requestOwnerHandoff");
const committedFlag = handoffClient.indexOf("committed: true");
assert(
  awaited >= 0 && committedFlag > awaited && handoffClient.includes("moveLoadMayCache"),
  "the refresh is marked committed only after the hand-off write, and an earlier read is not cached",
);
const moveBlock = plan.slice(plan.indexOf("<MoveHandTo"));
assert(moveBlock.includes("onOpenDraft={onOpenDraft}"), "owner Next moves can open the draft");
const movesPanel = readFileSync("src/components/strategic-moves-panel.tsx", "utf8");
assert(movesPanel.includes("onOpenDraft={onOpenDraft}"), "accountant Next moves can open the draft");
const accountant = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const movesCall = accountant.slice(accountant.indexOf("<StrategicMovesPanel"));
assert(movesCall.includes("onOpenDraft={openDraft}"), "the accountant Moves tab opens the draft");
const ownerShell = readFileSync("src/routes/app.tsx", "utf8");
assert(ownerShell.includes("onOpenDraft="), "the owner action plan opens the draft");

console.log("action-handoff ok");
