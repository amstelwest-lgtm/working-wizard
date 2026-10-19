/**
 * Hand-off assignment and the accountant agent stage.
 * No database. Run: pnpm test:action-handoff
 */
import { readFileSync } from "node:fs";
import {
  agentKeyFromAssignee,
  botPickupCaption,
  formatAssignmentNote,
  HANDOFF_COST_STOP,
  handoffButtonLabel,
  handoffClock,
  handoffCouldNotFinish,
  handoffIsSlow,
  handoffProgressCaption,
} from "../src/lib/action-handoff.ts";
import { agentDisplayName } from "../src/lib/milon-team.ts";
import { pollAfterTick } from "../src/lib/agent-activity-poll.ts";
import { deskSignoffText } from "../src/lib/milon-team-activity.ts";

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
assert(
  pollAfterTick([finished], true) === "continue",
  "a hand-off still on the page keeps the poll alive until a fresh snapshot settles it",
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
assert(
  handoffProgressCaption("analyst", "queued") === "Analyst is queued",
  "a queued run is waiting",
);
assert(
  handoffProgressCaption("analyst", "running") === "Analyst picked this up",
  "a running run is a pickup",
);
const finishedAt = "2026-10-19T18:31:22.000Z";
assert(
  handoffProgressCaption("financial_manager", "succeeded") === "Financial Manager finished",
  "a finished run stays on the action",
);
assert(
  handoffProgressCaption("financial_manager", "succeeded", {
    at: finishedAt,
    result: "Drafts are recorded.",
  }) === `Financial Manager finished · ${handoffClock(finishedAt)} — Drafts are recorded.`,
  "a finished run names the time and the result",
);
assert(
  botPickupCaption({
    assignee: "theo",
    run: { agent: "advisor", status: "queued", at: finishedAt },
  }) === null,
  "a person row drops the queued bot line",
);
assert(
  handoffProgressCaption("advisor", "failed") === null,
  "a failed run does not claim progress",
);
const notedAt = "2026-10-19T18:31:00.000Z";
assert(
  formatAssignmentNote({ note: "Assigned to theo.", at: notedAt, actorLabel: "amstel.west" }) ===
    `Assigned to theo · by amstel.west · ${handoffClock(notedAt)}`,
  "a person note names the author and the time",
);
assert(
  formatAssignmentNote({ note: "Handed to Analyst.", at: notedAt, actorLabel: "amstel.west" }) ===
    `Handed to Analyst · by amstel.west · ${handoffClock(notedAt)}`,
  "a hand-off note names the author and the time",
);
const analystName = agentDisplayName("analyst");
assert(
  formatAssignmentNote({
    note: `Handed to ${analystName}.`,
    at: notedAt,
    actorLabel: analystName,
    actorType: "system",
  }) === `Handed to ${analystName} · ${handoffClock(notedAt)}`,
  "an old hand-off note does not name the bot as the author",
);
assert(
  formatAssignmentNote({
    note: `Advisor finished: ${HANDOFF_COST_STOP}`,
    at: notedAt,
    actorLabel: agentDisplayName("advisor"),
    actorType: "system",
  }) === `${handoffCouldNotFinish("advisor")} · by ${agentDisplayName("advisor")} · ${handoffClock(notedAt)}`,
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
assert(plan.includes("toast.success(`Assigned to ${agentShortName(agent)}`)"), "assignment toasts");
assert(plan.includes("HandToMenu"), "the row renders Hand to");
const menu = readFileSync("src/components/hand-to-menu.tsx", "utf8");
assert(menu.includes("ActionHandoffButtons"), "Hand to lists the bots");
assert(menu.includes("data-hand-to-trigger"), "the control is labelled Hand to");
assert(menu.includes("Hand to"), "the button says Hand to");
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
assert(clientPage.includes("useAgentActivity(clientId, pageOpen)"), "accountant Home polls while a row is open");
assert(door.includes("useAgentActivity(clientId ?? \"\", pageOpen)"), "owner Home uses the same poll");
const poll = readFileSync("src/lib/agent-activity-poll.ts", "utf8");
assert(
  poll.includes('status === "queued"') && poll.includes('status === "running"'),
  "the poll watches queued and running runs",
);

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

console.log("action-handoff ok");
