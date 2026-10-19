/**
 * Hand-off assignment and the accountant agent stage.
 * No database. Run: pnpm test:action-handoff
 */
import { readFileSync } from "node:fs";
import {
  agentKeyFromAssignee,
  handoffButtonLabel,
  handoffProgressCaption,
} from "../src/lib/action-handoff.ts";
import { deskSignoffText } from "../src/lib/milon-team-activity.ts";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

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
assert(
  handoffProgressCaption("financial_manager", "succeeded") === "Financial Manager finished a pass",
  "a finished run stays on the action",
);
assert(
  handoffProgressCaption("advisor", "failed") === null,
  "a failed run does not claim progress",
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
assert(clientPage.includes("preferPendingHandoff"), "the accountant home keeps the latest hand-off");

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
