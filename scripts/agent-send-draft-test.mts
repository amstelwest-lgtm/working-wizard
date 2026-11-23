/**
 * Send an agent drafts: allowlist setting, propose_agent_send, approve, routine queue.
 * Run: pnpm test:agent-send-draft
 */
import { readFileSync } from "node:fs";
import {
  SEND_AGENT_FIRM_ALLOWLIST,
  sendAgentFirmAllowed,
  sendAgentFirmAllowlist,
} from "../src/lib/client-agent-send-allowlist.ts";
import {
  AGENT_SEND_DRAFT_KIND,
  PROPOSE_AGENT_SEND_TOOL,
  agentSendApproval,
  agentSendFindingRow,
  draftFromProposeArgs,
  parseAgentSendRequest,
  planAgentSendRoutine,
} from "../src/lib/agent-send-draft.ts";
import { fmToolAllowed } from "../src/lib/agent-financial-manager.ts";

const CURRENT = "fca0f102-a597-4ec6-8f45-825c57f78797";
const BEN = "e8f7a440-a541-422c-8e4f-82ba33dd0604";
const OTHER = "00000000-0000-4000-8000-000000000001";
const CLIENT = "e8f7a440-2222-4222-8222-222222222222";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const saved = process.env.SEND_AGENT_FIRM_ALLOWLIST;
function restoreEnv() {
  if (saved === undefined) delete process.env.SEND_AGENT_FIRM_ALLOWLIST;
  else process.env.SEND_AGENT_FIRM_ALLOWLIST = saved;
}

try {
  delete process.env.SEND_AGENT_FIRM_ALLOWLIST;
  assert(SEND_AGENT_FIRM_ALLOWLIST[0] === CURRENT, "the current firm stays the first locked default");
  assert(SEND_AGENT_FIRM_ALLOWLIST.includes(BEN), "Ben Accountants is a locked default");
  assert(sendAgentFirmAllowed(CURRENT), "the current firm stays allowed");
  assert(sendAgentFirmAllowed(BEN), "Ben Accountants is allowed");
  assert(!sendAgentFirmAllowed(OTHER), "another firm is denied");
  assert(!sendAgentFirmAllowed("fca0f102"), "a prefix is not the firm id");
  assert(!sendAgentFirmAllowed(null) && !sendAgentFirmAllowed(undefined), "a missing firm is denied");

  process.env.SEND_AGENT_FIRM_ALLOWLIST = `${OTHER}, not-a-uuid`;
  const widened = sendAgentFirmAllowlist();
  assert(widened.includes(CURRENT) && widened.includes(BEN), "an env list cannot drop a locked default");
  assert(sendAgentFirmAllowed(OTHER), "an env id is allowed on top of the locked defaults");
  assert(!sendAgentFirmAllowed("not-a-uuid"), "a non-id in the env list is ignored");

  process.env.SEND_AGENT_FIRM_ALLOWLIST = OTHER;
  assert(sendAgentFirmAllowed(CURRENT) && sendAgentFirmAllowed(BEN), "replacing the env list keeps the locked defaults");
} finally {
  restoreEnv();
}

const parsed = parseAgentSendRequest("Collect March statements from Karoo Woodwork");
assert(parsed?.clientName === "Karoo Woodwork", "the sentence names the client");
assert(parsed?.checklist[0] === "March statements", "the sentence names the checklist item");
assert(parsed?.message.includes("Collect March statements"), "the sentence is the message");

const proposed = draftFromProposeArgs(
  { request: "Collect March statements from Karoo Woodwork" },
  CLIENT,
);
assert(proposed.ok, "propose_agent_send accepts the sentence");
if (!proposed.ok) throw new Error("fixture");
assert(proposed.draft.kind === AGENT_SEND_DRAFT_KIND, "the card kind is agent_send_draft");
assert(proposed.draft.clientName === "Karoo Woodwork", "the draft names the client");
assert(proposed.draft.checklist.join("|") === "March statements", "the draft keeps the checklist");
assert(proposed.draft.sent === false && proposed.draft.minted === false, "propose_agent_send does not mint or send");
const row = agentSendFindingRow(proposed.draft, "11111111-1111-4111-8111-111111111111");
assert(row.kind === "agent_send_draft", "the finding kind is free text agent_send_draft");
const evidence = row.evidence as { sent: boolean; minted: boolean; draft: boolean; requires_human_approval: boolean };
assert(evidence.draft && evidence.requires_human_approval && !evidence.sent && !evidence.minted, "the finding stays an unsent draft");

const unnamed = agentSendApproval({
  draft: proposed.draft,
  approverName: "",
  recipientEmail: "owner@karoo.example",
});
assert(!unnamed.ok && unnamed.reason === "needs_named_accountant", "approval needs a named accountant");
const generic = agentSendApproval({
  draft: proposed.draft,
  approverName: "the accountant",
  recipientEmail: "owner@karoo.example",
});
assert(!generic.ok, "a generic accountant label is not a name");

const named = agentSendApproval({
  draft: proposed.draft,
  approverName: "Nia Jacobs",
  recipientEmail: "owner@karoo.example",
  recipientFirstName: "Karoo",
});
assert(named.ok, "a named accountant can approve");
if (!named.ok) throw new Error("fixture");
assert(named.mint.clientId === CLIENT, "approve targets the draft client");
assert(named.mint.agent === "financial_manager" && named.mint.missionKey === "collect_documents", "approve uses the existing mission");
assert(named.mint.firmNote.includes("March statements"), "the checklist is on the mint note");
assert(named.mint.recipientEmail === "owner@karoo.example", "approve passes the confirmed address");
assert(!("url" in named.mint), "the approval plan does not mint a link itself");

const approveSrc = readFileSync("src/lib/agent-send-draft.functions.ts", "utf8");
assert(approveSrc.includes("mintClientAgentSend("), "approve calls mintClientAgentSend");
assert(!approveSrc.includes("sendClientAgentInvite"), "approve does not start a second mail path");
assert(!approveSrc.includes('.from("client_agent_sends")'), "approve does not insert a send row itself");
const beforeMint = approveSrc.slice(0, approveSrc.indexOf("mintClientAgentSend("));
assert(beforeMint.includes("needs_named_accountant"), "the name is checked before mint");

assert(fmToolAllowed(PROPOSE_AGENT_SEND_TOOL), "propose_agent_send is a Financial Manager tool");
const execute = readFileSync("supabase/functions/agent-financial-manager/execute.ts", "utf8");
assert(execute.includes('tool === "propose_agent_send"'), "the runner executes propose_agent_send");
const proposeFn = execute.slice(execute.indexOf("async function proposeAgentSend"));
assert(proposeFn.includes("agentSendFindingRow"), "the tool writes an agent_send_draft finding");
assert(!proposeFn.includes("mintClientAgentSend"), "the tool does not mint");
assert(proposeFn.includes("minted: false") && proposeFn.includes("sent: false"), "the tool result stays unsent");

const routine = planAgentSendRoutine(
  {
    doc_type: "im_routine_map",
    source: "setup_partner_activation",
    routine: "agent_send",
    accepted_at: "2026-11-01T00:00:00.000Z",
    checklist: ["March statements"],
    message: "Please send the March statements.",
  },
  { clientId: CLIENT, clientName: "Karoo Woodwork", periodKey: "2026-03" },
);
assert(routine, "an agent_send routine plans a draft");
if (!routine) throw new Error("fixture");
assert(routine.kind === "agent_send_draft", "the routine queues an agent_send_draft");
assert(routine.sent === false && routine.minted === false, "the routine draft is unsent");
assert(routine.invokeRunner === false && routine.postsLedger === false, "the routine does not run a sender or post a ledger");
assert(routine.checklist[0] === "March statements", "the routine keeps the checklist");
assert(
  planAgentSendRoutine(
    { doc_type: "im_routine_map", source: "setup_partner_activation", routine: "document_chase", accepted_at: "2026-11-01" },
    { clientId: CLIENT, clientName: "Karoo Woodwork", periodKey: "2026-03" },
  ) === null,
  "other routine kinds are left to the existing planner",
);

const scheduler = readFileSync("src/lib/im-routine-scheduler.service.ts", "utf8");
assert(scheduler.includes("planAgentSendRoutine"), "the scheduler looks for an agent_send routine");
assert(scheduler.includes("queueAgentSendDraft"), "the scheduler queues the draft");
assert(scheduler.includes("sendAgentFirmAllowed"), "the scheduler uses the allowlist setting");
const queueFn = scheduler.slice(scheduler.indexOf("async function queueAgentSendDraft"), scheduler.indexOf("async function enqueueScheduledDraftRun"));
assert(queueFn.includes("agent_send_draft"), "the queued row is an agent_send_draft");
assert(queueFn.includes('status: "skipped"'), "the routine run is not started");
assert(!queueFn.includes("agent_invoke"), "the routine draft does not invoke a runner");
assert(!queueFn.includes("mintClientAgentSend"), "the routine draft does not mint");
assert(!/whatsapp/i.test(queueFn), "routine copy does not mention WhatsApp");

const card = readFileSync("src/components/agent-send-draft-card.tsx", "utf8");
assert(card.includes("approveAgentSendDraft"), "the card approves through the mint path");
assert(!/whatsapp/i.test(card), "the card does not mention WhatsApp");

console.log("agent-send-draft-test: ok");
