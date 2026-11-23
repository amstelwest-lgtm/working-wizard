/**
 * Client-update draft: shape, approval before send, From / Reply-To, no branding, audit.
 * Run: pnpm test:client-update-draft
 * No live Resend call.
 */
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerDraftCard } from "../src/components/owner-draft-card.tsx";
import { draftFindingLabel, DRAFT_NEEDS_ACCOUNTANT } from "../src/hooks/owner-agent-ui.ts";
import type { AgentFindingRow } from "../src/lib/milon-team-activity.ts";
import { handoffTimeline, parseHandoffRunDetail } from "../src/lib/handoff-timeline.ts";
import { STRIKE7_BEN_ID } from "./strike7-firms.ts";
import {
  CLIENT_UPDATE_AUTO_SEND,
  CLIENT_UPDATE_DRAFT_KIND,
  buildUnsentClientUpdateFinding,
  clientUpdateFromHeader,
  clientUpdateIdempotencyKey,
  dismissClientUpdatePatch,
  parseClientUpdateDetail,
  planClientUpdateSend,
  publicSendError,
  readClientUpdateAudit,
  renderClientUpdateBody,
  sentClientUpdatePatch,
  shapeAdvisorClientUpdateArgs,
} from "../src/lib/client-update-draft.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const BEN = STRIKE7_BEN_ID;
assert(BEN.startsWith("e8f7a440"), "fixture firm is Ben Accountants");
assert(!BEN.startsWith("fca0f102"), "fixture firm is not the demo firm");

const draft = {
  done: "We refreshed the 13-week cash view.",
  found: "Cash covers six weeks on the books on file.",
  nextSteps: [
    "Send the latest debtor list.",
    "Confirm rent for next month.",
    "Review the cash weeks together.",
  ] as [string, string, string],
};
const basis = ["September cash closing"];
const modelDetail = [
  "Based on: September cash closing",
  "What was done: We refreshed the 13-week cash view.",
  "What was found: Cash covers six weeks on the books on file.",
  "Next steps:",
  "1. Send the latest debtor list.",
  "2. Confirm rent for next month.",
  "3. Review the cash weeks together.",
].join("\n");

const parsed = parseClientUpdateDetail(modelDetail);
assert(parsed.ok, "the model detail parses");
if (!parsed.ok) throw new Error("parse");
assert(parsed.draft.done === draft.done, "what was done");
assert(parsed.draft.found === draft.found, "what was found");
assert(parsed.draft.nextSteps.length === 3, "the next 3 steps");
assert(parsed.draft.nextSteps[2] === draft.nextSteps[2], "the third step is kept");
assert(parseClientUpdateDetail(modelDetail.replace("3. Review the cash weeks together.", "")).ok === false, "two steps are refused");
assert(
  parseClientUpdateDetail(`${modelDetail}\n4. File the return.`).ok === false,
  "a fourth step is refused",
);

const shaped = shapeAdvisorClientUpdateArgs({
  kind: CLIENT_UPDATE_DRAFT_KIND,
  severity: "info",
  title: "Cash update",
  detail: modelDetail,
  figures: { cash_weeks: 6 },
});
assert(shaped.ok, "an advisor draft argument is shaped");
if (!shaped.ok) throw new Error("shape");
assert(shaped.args.kind === CLIENT_UPDATE_DRAFT_KIND, "kind stays client_update_draft");
assert(String(shaped.args.detail).includes("What was done"), "the stored detail is the email");
assert(String(shaped.args.detail).includes("Based on: September cash closing"), "the review copy says what it is based on");
assert(
  shapeAdvisorClientUpdateArgs({ ...shaped.args, detail: "Milōn refreshed the cash view.\n" + modelDetail }).ok === false,
  "a branded draft is not saved",
);

const finding = buildUnsentClientUpdateFinding({
  firmId: BEN,
  draft,
  basis,
  figures: { cash_weeks: 6 },
});
assert(finding.kind === CLIENT_UPDATE_DRAFT_KIND, "kind is free text on the finding");
assert(finding.evidence.draft === true, "the finding is still a draft");
assert(finding.evidence.requires_human_approval === true, "a person has to approve");
assert(finding.evidence.autoSend === false && CLIENT_UPDATE_AUTO_SEND === false, "auto-send stays off");
assert(finding.evidence.sent === false, "first runs are unsent");
assert(!readClientUpdateAudit(finding.evidence), "an unsent draft has no audit");
assert(finding.evidence.firmId === BEN, "the draft records the practice");
const stored = finding.evidence.clientUpdate as { nextSteps: string[]; done: string; found: string; basis: string[] };
assert(stored.done === draft.done && stored.found === draft.found && stored.nextSteps.length === 3, "the shape is on the finding");
assert(stored.basis[0] === "September cash closing", "the basis is stored");
const figures = finding.evidence.figures as Record<string, number>;
assert(figures.cash_weeks === 6 && Object.keys(figures).length > 0, "evidence.figures stays non-empty");
assert(
  draftFindingLabel({ kind: finding.kind, evidence: finding.evidence }) === DRAFT_NEEDS_ACCOUNTANT,
  "the draft waits in the accountant review queue",
);

const practice = "Ben Accountants";
const accountantEmail = "ada@ben.example";
const clientEmail = "owner@client.example";
const fromRaw = "MILŌN <team@trymilon.com>";
const blocked = planClientUpdateSend({
  approval: null,
  practiceName: practice,
  accountantEmail,
  to: clientEmail,
  subject: "Cash update",
  body: renderClientUpdateBody({ draft, basis }),
  fromEmailRaw: fromRaw,
});
assert(blocked.send === false && blocked.reason === "approval_required", "nothing is sent without a named accountant");
const auto = planClientUpdateSend({
  approval: { approverName: "Ada Ben", approvedAt: "2026-11-23T15:00:00.000Z" },
  requestedAutoSend: true,
  practiceName: practice,
  accountantEmail,
  to: clientEmail,
  subject: "Cash update",
  body: renderClientUpdateBody({ draft, basis }),
  fromEmailRaw: fromRaw,
});
assert(auto.send === false && auto.reason === "auto_send_off", "auto-send is not a send path");
const unnamed = planClientUpdateSend({
  approval: { approverName: "   ", approvedAt: "2026-11-23T15:00:00.000Z" },
  practiceName: practice,
  accountantEmail,
  to: clientEmail,
  subject: "Cash update",
  body: renderClientUpdateBody({ draft, basis }),
  fromEmailRaw: fromRaw,
});
assert(unnamed.send === false && unnamed.reason === "approval_required", "a blank name is not an approval");
const emailName = planClientUpdateSend({
  approval: { approverName: accountantEmail, approvedAt: "2026-11-23T15:00:00.000Z" },
  practiceName: practice,
  accountantEmail,
  to: clientEmail,
  subject: "Cash update",
  body: renderClientUpdateBody({ draft, basis }),
  fromEmailRaw: fromRaw,
});
assert(emailName.send === false && emailName.reason === "approval_required", "an email address is not a name");

const edited = "What was done\nWe agreed the rent figure.\n\nWhat was found\nCash covers six weeks.\n\nNext steps\n1. Send the debtor list.\n2. Confirm rent.\n3. Meet on Thursday.";
const planned = planClientUpdateSend({
  approval: { approverName: "Ada Ben", approvedAt: "2026-11-23T15:04:00.000Z" },
  practiceName: practice,
  accountantEmail,
  to: clientEmail,
  subject: "Cash update",
  body: edited,
  fromEmailRaw: fromRaw,
});
assert(planned.send, "edit-then-approve can send");
if (!planned.send) throw new Error("plan");
assert(planned.payload.from === clientUpdateFromHeader({ practiceName: practice, fromEmailRaw: fromRaw }), "From uses the helper");
assert(planned.payload.from.startsWith("Ben Accountants <"), "From name is the practice");
assert(planned.payload.from.endsWith("team@trymilon.com>"), "From address is the existing sending mailbox");
assert(!planned.payload.from.startsWith("MIL"), "the display name is not the product");
assert(planned.payload.reply_to === accountantEmail, "Reply-To is the accountant");
assert(planned.payload.to[0] === clientEmail, "the client is the recipient");
assert(planned.payload.text === edited, "the edited text is what would be sent");
assert(!/\bmilon\b/i.test(planned.payload.text.normalize("NFKD").replace(/\p{M}/gu, "")), "the body has no product name");
assert(!/powered by/i.test(planned.payload.text), "the body has no powered-by line");
assert(!("html" in planned.payload), "there is no branded html part");

const branded = planClientUpdateSend({
  approval: { approverName: "Ada Ben", approvedAt: "2026-11-23T15:04:00.000Z" },
  practiceName: practice,
  accountantEmail,
  to: clientEmail,
  subject: "Cash update",
  body: `${edited}\nPowered by Milōn`,
  fromEmailRaw: fromRaw,
});
assert(branded.send === false && branded.reason === "branded", "branding in the final text blocks the send");

const patch = sentClientUpdatePatch({
  evidence: finding.evidence,
  userId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  approverName: "Ada Ben",
  approvedAt: "2026-11-23T15:04:00.000Z",
  resendMessageId: "re_test_123",
  finalText: planned.payload.text,
  subject: planned.payload.subject,
});
assert(!("status" in patch), "approval does not pretend a live row exists");
assert(!("approved_table" in patch), "approval does not name another table");
const audit = readClientUpdateAudit(patch.evidence);
assert(audit?.approverName === "Ada Ben", "audit stores the approver name");
assert(audit?.approvedAt === "2026-11-23T15:04:00.000Z", "audit stores the time");
assert(audit?.resendMessageId === "re_test_123", "audit stores the Resend message id");
assert(audit?.finalText === edited, "audit stores the final text");
assert((patch.evidence as { figures: { cash_weeks: number } }).figures.cash_weeks === 6, "the send keeps figures");
assert((patch.evidence as { draft: boolean }).draft === false, "a sent update leaves the review queue");

const run = parseHandoffRunDetail(
  {
    id: "run-1",
    agent: "advisor",
    status: "succeeded",
    stop_reason: "objective_complete",
    summary: "Draft saved.",
    queued_at: "2026-11-23T15:00:00.000Z",
    started_at: "2026-11-23T15:00:05.000Z",
    finished_at: "2026-11-23T15:01:00.000Z",
    trace: [],
  },
  [{ id: "finding-1", title: "Client update", detail: edited, severity: "info", evidence: patch.evidence }],
);
const steps = handoffTimeline({ agentName: "Advisor", run });
const sentStep = steps.find((step) => step.key === "client-update-sent");
assert(sentStep, "the client timeline has a sent step");
assert(sentStep?.label === "Ada Ben sent the client update", "the timeline names the approver");
assert(sentStep?.at === "2026-11-23T15:04:00.000Z", "the timeline shows the time");
assert(sentStep?.detail?.includes("re_test_123"), "the timeline shows the Resend message id");
assert(sentStep?.detail?.includes(edited), "the timeline shows the final text");

const dismissed = dismissClientUpdatePatch(finding.evidence);
assert(dismissed.status === "dismissed", "dismiss uses the findings status");
assert(!readClientUpdateAudit(dismissed.evidence), "dismiss does not invent a send");

const same = clientUpdateIdempotencyKey("finding-1", edited);
assert(same === clientUpdateIdempotencyKey("finding-1", edited), "the same text reuses one send key");
assert(same !== clientUpdateIdempotencyKey("finding-1", `${edited}\n`), "an edit is a different send");
assert(publicSendError(422, 'Bearer re_secret sk_live_abc {"message":"no"}').includes("[redacted]"), "provider errors are redacted");
assert(!publicSendError(422, "re_secret").includes("re_secret"), "a Resend token is not shown");

const fn = readFileSync("src/lib/client-update-draft.functions.ts", "utf8");
assert(fn.indexOf("if (!planned.send)") < fn.indexOf("api.resend.com"), "approve plans the send before Resend is called");
assert(fn.includes("planClientUpdateSend"), "approve uses the send plan");
assert(fn.includes("RESEND_API_KEY") && fn.includes("RESEND_FROM_EMAIL"), "the existing Resend env names are reused");
assert(!fn.includes('status: "approved"'), "the handler does not mark a live-row approval");
assert(!/\b(xero|quickbooks|sage|sars|whatsapp)\b/i.test(fn), "no ledger, tax, or WhatsApp path");
assert(!fn.includes("requestedAutoSend: true"), "the handler does not ask for auto-send");

const execute = readFileSync("supabase/functions/agent-advisor/execute.ts", "utf8");
assert(execute.includes("shapeAdvisorClientUpdateArgs"), "an advisor run shapes the unsent draft");
assert(!execute.includes("api.resend.com"), "the advisor run does not send");
const prompt = readFileSync("supabase/functions/_shared/agent-prompts/advisor.ts", "utf8");
assert(prompt.includes("client_update_draft"), "the advisor can record this kind");
assert(/not sent from this run/i.test(prompt), "the run leaves the draft unsent");

const card = readFileSync("src/components/owner-draft-card.tsx", "utf8");
assert(card.includes("reviewClientUpdateDraft"), "approve on the review card uses this send");
assert(card.includes('action: "approve"') && card.includes('action: "dismiss"'), "edit-then-approve and dismiss are both wired");
const shelf = readFileSync("src/components/agent-draft-shelf.tsx", "utf8");
assert(shelf.includes("CLIENT_UPDATE_DRAFT_KIND") && shelf.includes('decisionSeat='), "the review queue can approve a client update");

function row(seat: "owner" | "firm") {
  const findingRow: AgentFindingRow = {
    id: "draft-1",
    agent: "advisor",
    client_id: "c",
    kind: CLIENT_UPDATE_DRAFT_KIND,
    title: "Cash update",
    detail: finding.detail,
    evidence: finding.evidence,
    as_of: null,
    created_at: "2026-11-23T15:00:00.000Z",
  };
  return renderToStaticMarkup(
    createElement(OwnerDraftCard, { layout: "moves", row: findingRow, decisionSeat: seat }),
  );
}
const firmCard = row("firm");
assert(firmCard.includes("Approve") && firmCard.includes("Dismiss"), "the accountant review card can approve or dismiss");
assert(firmCard.includes("Client update"), "the queue names the draft");
assert(firmCard.includes("September cash closing"), "the queue shows what the draft is based on");
assert(!firmCard.includes("Remember this"), "this approval does not offer a private rule");
const ownerCard = row("owner");
assert(!ownerCard.includes("Approve"), "the client owner cannot approve the send");

console.log("client-update-draft ok");
