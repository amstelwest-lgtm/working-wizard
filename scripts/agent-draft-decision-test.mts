/**
 * Approve and dismiss rules for agent drafts. No database.
 * Run: pnpm test:agent-draft-decision
 */
import { readFileSync } from "node:fs";
import {
  DISMISSED_BY_USER,
  actionPlanInsert,
  applyDraftEdits,
  draftDecisionAccess,
  isDraftFinding,
  liveRecordForDraft,
  recordMarksSignedOff,
  repeatDecision,
  settledDraftEvidence,
} from "../src/lib/agent-draft-decision.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const draftEvidence = { draft: true, requires_human_approval: true, figures: { cash: 1 } };
const clientId = "184f10ae-ac71-4aa3-aa0c-b000f78d20e2";
const userId = "11111111-1111-1111-1111-111111111111";
const firmId = "22222222-2222-2222-2222-222222222222";
const findingId = "33333333-3333-3333-3333-333333333333";
const recordId = "44444444-4444-4444-4444-444444444444";

const ownerSide = ["action_point_draft", "data_request_draft", "next_move_draft"] as const;
const accountantSide = ["accountant_handoff_draft", "advisory_deliverable_draft", "tax_document_review"] as const;

for (const kind of ownerSide) {
  const owner = draftDecisionAccess({ kind, userId, ownerUserId: userId, firmMember: false });
  assert(owner.ok && owner.seat === "owner", `the owner can decide ${kind}`);
  const firm = draftDecisionAccess({ kind, userId: "firm-user", ownerUserId: userId, firmMember: true });
  assert(firm.ok && firm.seat === "firm", `a firm member can decide ${kind}`);
  const stranger = draftDecisionAccess({ kind, userId: "other", ownerUserId: userId, firmMember: false });
  assert(!stranger.ok && stranger.error === "forbidden", `a workspace member who is not the owner cannot decide ${kind}`);
}

for (const kind of accountantSide) {
  const owner = draftDecisionAccess({ kind, userId, ownerUserId: userId, firmMember: false });
  assert(!owner.ok && owner.error === "forbidden", `the owner cannot decide ${kind}`);
  const firm = draftDecisionAccess({ kind, userId: "firm-user", ownerUserId: userId, firmMember: true });
  assert(firm.ok && firm.seat === "firm", `a firm member can decide ${kind}`);
}

assert(
  !draftDecisionAccess({
    kind: "weakest_pillar",
    userId,
    ownerUserId: userId,
    firmMember: true,
  }).ok,
  "an analyst finding is not a draft decision",
);

assert(isDraftFinding({ kind: "data_request_draft", evidence: draftEvidence }), "a flagged draft is a draft");
assert(
  !isDraftFinding({ kind: "data_request_draft", evidence: { ...draftEvidence, draft: false } }),
  "a settled row is no longer waiting",
);

const stored = {
  status: "approved" as const,
  dismissedReason: null,
  approvedTable: "data_requests",
  approvedRowId: recordId,
  approvedBy: userId,
  approvedAt: "2026-10-11T10:00:00.000Z",
};
const again = repeatDecision("approve", stored);
assert(again.action === "return" && again.already && again.recordId === recordId, "a second approve returns the same row");
assert(again.action === "return" && again.recordTable === "data_requests", "a second approve names the live table");
const crossed = repeatDecision("dismiss", stored);
assert(crossed.action === "conflict" && crossed.error === "already_approved", "dismiss after approve is refused");

const dismissed = repeatDecision("dismiss", {
  status: "dismissed",
  dismissedReason: DISMISSED_BY_USER,
  approvedTable: null,
  approvedRowId: null,
  approvedBy: null,
  approvedAt: null,
});
assert(
  dismissed.action === "return" && dismissed.dismissedReason === DISMISSED_BY_USER,
  "a second dismiss returns the same reason",
);
const approveDismissed = repeatDecision("approve", {
  status: null,
  dismissedReason: "period label artefact",
  approvedTable: null,
  approvedRowId: null,
  approvedBy: null,
  approvedAt: null,
});
assert(
  approveDismissed.action === "conflict" && approveDismissed.error === "already_dismissed",
  "a dismissed_reason already set blocks approve",
);
assert(
  repeatDecision("approve", {
    status: "approved",
    dismissedReason: null,
    approvedTable: null,
    approvedRowId: null,
    approvedBy: userId,
    approvedAt: "2026-10-11T10:00:00.000Z",
  }).action === "conflict",
  "an approved row without a live id is incomplete",
);
assert(repeatDecision("approve", {
  status: null,
  dismissedReason: null,
  approvedTable: null,
  approvedRowId: null,
  approvedBy: null,
  approvedAt: null,
}).action === "apply", "a waiting draft can be decided");

const open = applyDraftEdits({ title: "  Ask for the ledger  ", detail: "One PDF.", edits: { detail: "Still one PDF." } });
assert(open.ok && open.title === "Ask for the ledger" && open.detail === "Still one PDF.", "edits replace the stored text");
assert(!applyDraftEdits({ title: "   ", detail: "x" }).ok, "a blank title is refused");
for (const phrase of ["signed off", "signed-off", "sign off", "sign-off"]) {
  assert(
    applyDraftEdits({ title: `This is ${phrase} by the owner`, detail: "ok" }).ok === false,
    `${phrase} is refused`,
  );
}
assert(applyDraftEdits({ title: "Signature on the PDF", detail: "assigned to Ada" }).ok, "ordinary words are not a sign-off");

const base = {
  title: "Sep books rest on one PDF",
  detail: "No ledger is connected.",
  severity: "watch",
  clientId,
  userId,
  findingId,
  firmId,
};

const dataOwner = liveRecordForDraft({ ...base, kind: "data_request_draft", seat: "owner" });
assert(dataOwner.ok && dataOwner.record.table === "data_requests", "a data request draft becomes a data request");
if (dataOwner.ok) {
  assert(dataOwner.record.row.status === "open", "the data request stays open");
  assert(dataOwner.record.row.sent_at === null && dataOwner.record.row.sent_to === null, "the data request is not sent");
  assert(
    (dataOwner.record.row.meta as { auto_send: boolean }).auto_send === false,
    "auto_send stays false",
  );
  assert(dataOwner.record.row.source === "owner", "an owner approval is sourced to the owner");
  assert(dataOwner.record.row.kind === "other", "the draft kind maps to other");
  assert(!recordMarksSignedOff(dataOwner.record.row), "a data request is not signed off");
}
const dataAct = liveRecordForDraft({ ...base, kind: "data_request_draft", seat: "firm", severity: "act" });
const dataInfo = liveRecordForDraft({ ...base, kind: "data_request_draft", seat: "firm", severity: "info" });
assert(dataAct.ok && dataAct.record.row.severity === "critical" && dataAct.record.row.source === "accountant", "act maps to critical and a firm seat");
assert(dataInfo.ok && dataInfo.record.row.severity === "nice_to_have", "info maps to nice_to_have");

const action = liveRecordForDraft({ ...base, kind: "action_point_draft", seat: "owner", planId: "plan-1", seq: 3 });
assert(action.ok && action.record.table === "action_items", "an action point becomes an action item");
if (action.ok) {
  assert(action.record.row.source === "manual" && action.record.row.status === "not_started", "the action matches the manual insert");
  assert(action.record.row.sent_at === null, "the action is not emailed");
  assert(action.record.row.seq === 3 && action.record.row.plan_id === "plan-1", "the action uses the active plan");
  assert(!recordMarksSignedOff(action.record.row), "an action item is not signed off");
}
assert(
  !liveRecordForDraft({ ...base, kind: "action_point_draft", seat: "owner" }).ok,
  "an action point needs a plan",
);

const move = liveRecordForDraft({ ...base, kind: "next_move_draft", seat: "owner" });
assert(move.ok && move.record.table === "proposed_next_steps", "a next move becomes a proposed next step");
if (move.ok) {
  assert(move.record.row.status === "proposed" && move.record.row.source === "ai", "the next step stays proposed");
  assert(move.record.row.data_depth === "statement", "the next step stays at statement depth");
  assert(!("signed_off_at" in move.record.row) && !("signed_off_by_id" in move.record.row), "sign-off columns are absent");
  assert(!recordMarksSignedOff(move.record.row), "a proposed next step is not signed off");
}

const deliverable = liveRecordForDraft({ ...base, kind: "advisory_deliverable_draft", seat: "firm" });
assert(deliverable.ok && deliverable.record.table === "deliverable_drafts", "an advisory draft becomes a deliverable draft");
if (deliverable.ok) {
  assert(deliverable.record.row.status === "draft" && deliverable.record.row.kind === "advisory", "the deliverable stays a draft");
  assert(String(deliverable.record.row.body).startsWith("SUBJECT: "), "the body keeps the subject line");
  assert(!recordMarksSignedOff(deliverable.record.row), "a deliverable draft is not signed off");
}

const handoff = liveRecordForDraft({ ...base, kind: "accountant_handoff_draft", seat: "firm" });
assert(handoff.ok && handoff.record.table === "accountant_requests", "a hand-off becomes an accountant request");
if (handoff.ok) {
  assert(handoff.record.row.status === "open" && handoff.record.row.firm_id === firmId, "the request is open on the client's firm");
  assert(handoff.record.row.pack_id === null, "the request is not a pack");
  assert(String(handoff.record.row.message).includes(base.title), "the message carries the title");
  assert(!recordMarksSignedOff(handoff.record.row), "an accountant request is not signed off");
}
const noFirm = liveRecordForDraft({ ...base, kind: "accountant_handoff_draft", seat: "firm", firmId: null });
assert(!noFirm.ok && noFirm.error === "client_has_no_firm", "a hand-off without a firm is refused");
assert(
  liveRecordForDraft({ ...base, kind: "accountant_handoff_draft", seat: "firm", title: "Already signed off" }).error ===
    "signed_off_refused",
  "a hand-off that claims sign-off is refused",
);

assert(recordMarksSignedOff({ status: "signed_off" }), "a signed_off status is refused");
assert(recordMarksSignedOff({ signed_off_at: "2026-10-11T10:00:00.000Z" }), "a sign-off stamp is refused");
assert(!recordMarksSignedOff({ status: "proposed", signed_off_at: null }), "a null stamp is not a sign-off");

const settled = settledDraftEvidence(draftEvidence);
assert(settled.draft === false && (settled.figures as { cash: number }).cash === 1, "settling keeps the figures and clears the draft flag");

const plan = actionPlanInsert(clientId, new Date("2026-10-11T10:00:00.000Z"));
assert(plan.period_label === "Q4 2026" && plan.target_date === "2026-12-31", "a missing plan uses the current quarter");
assert(plan.outcome_goal === "Set your outcome goal for this quarter", "the plan uses the existing outcome goal");

const lib = read("src/lib/agent-draft-decision.ts");
const fn = read("supabase/functions/agent-draft-decision/index.ts");
const migration = read("supabase/migrations/20261012160000_agent_findings_draft_decision.sql");
const config = read("supabase/config.toml");
for (const banned of [
  "resend",
  "sendDataRequestEmail",
  "accountant_request_respond",
  "accountant_request_recipients",
  "nodemailer",
  "precard",
]) {
  assert(!lib.toLowerCase().includes(banned.toLowerCase()), `the decision rules do not mention ${banned}`);
  assert(!fn.toLowerCase().includes(banned.toLowerCase()), `the decision function does not mention ${banned}`);
}
assert(lib.includes("sent_at: null") && lib.includes("auto_send: false"), "approve leaves mail switches off");
assert(fn.includes('verify_jwt is true'), "the function requires a caller JWT");
assert(config.includes("[functions.agent-draft-decision]") && /\[functions\.agent-draft-decision\]\s+verify_jwt = true/.test(config), "verify_jwt is true");
assert(fn.includes('return await reread('), "a lost race returns the stored decision");
assert(!fn.includes("json(await reread"), "a reread response is not wrapped again");
assert((fn.match(/\.is\("status", null\)/g) ?? []).length >= 2, "approve and dismiss only write a waiting row");
const priorAt = fn.indexOf("const prior = repeatDecision(");
const draftAt = fn.indexOf("if (!isDraftFinding(");
assert(priorAt > 0 && draftAt > priorAt, "a second approve still finds the row after the draft flag is cleared");
const seeAt = fn.indexOf('if (!firmMember && ownerUserId !== user.id)');
assert(seeAt > 0 && seeAt < priorAt, "a caller who cannot see the client learns nothing about the decision");
assert(fn.includes('.delete().eq("id", recordId)'), "a lost approve deletes the row it just inserted");
assert(fn.includes("23505"), "an open accountant request is not linked to someone else's row");

assert(migration.includes("approved_by") && migration.includes("approved_row_id"), "approve stores who and which row");
assert(migration.includes("'approved', 'dismissed'") || migration.includes("'approved'") && migration.includes("'dismissed'"), "status is approved or dismissed");
for (const table of ["data_requests", "action_items", "proposed_next_steps", "deliverable_drafts", "accountant_requests"]) {
  assert(migration.includes(`'${table}'`), `the migration names ${table}`);
}
const migrationCode = migration.replace(/--[^\n]*/g, "");
assert(!/\bDELETE\s+FROM\b/i.test(migrationCode), "the decision migration deletes nothing");
assert(!/\bUPDATE\b/i.test(migrationCode), "existing rows stay status null");

console.log("agent-draft-decision: ok");
