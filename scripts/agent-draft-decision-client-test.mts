/**
 * Owner mapping for agent-draft-decision v1. No database.
 * Run: pnpm test:agent-draft-decision-client
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerDraftCard } from "../src/components/owner-draft-card.tsx";
import {
  DRAFT_ALREADY_DECIDED,
  DRAFT_INVITE_ACCOUNTANT,
  DRAFT_NOT_SAVED,
  DRAFT_SIGNED_OFF,
  DRAFT_WITH_ACCOUNTANT,
  approvedLiveLink,
  interpretDraftDecisionResponse,
  resetDraftDecisionButtonsForTests,
} from "../src/lib/agent-draft-decision-client.ts";
import type { AgentFindingRow } from "../src/lib/milon-team-activity.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const recordId = "44444444-4444-4444-4444-444444444444";

const approved = interpretDraftDecisionResponse(200, {
  ok: true,
  finding_id: "finding",
  decision: "approve",
  already: false,
  status: "approved",
  record_table: "action_items",
  record_id: recordId,
  approved_by: "user",
  approved_at: "2026-10-11T10:00:00.000Z",
});
assert(approved.ok && approved.status === "approved" && approved.recordId === recordId, "approve returns the live row");
assert(approved.ok && approved.recordTable === "action_items" && approved.already === false, "approve names the table");

const again = interpretDraftDecisionResponse(200, {
  ok: true,
  finding_id: "finding",
  decision: "approve",
  already: true,
  status: "approved",
  record_table: "data_requests",
  record_id: recordId,
  approved_by: "user",
  approved_at: "2026-10-11T10:00:00.000Z",
});
assert(again.ok && again.already && again.recordId === recordId, "a repeat approve is success with the same row");

const dismissed = interpretDraftDecisionResponse(200, {
  ok: true,
  finding_id: "finding",
  decision: "dismiss",
  already: false,
  status: "dismissed",
  dismissed_reason: "dismissed by user",
});
assert(
  dismissed.ok && dismissed.status === "dismissed" && dismissed.dismissedReason === "dismissed by user",
  "dismiss returns the reason",
);

for (const error of ["already_approved", "already_dismissed", "approve_incomplete", "superseded"]) {
  const conflict = interpretDraftDecisionResponse(409, { ok: false, error });
  assert(
    !conflict.ok && conflict.message === DRAFT_ALREADY_DECIDED && conflict.refresh && !conflict.invite,
    `${error} is already decided`,
  );
}

const noFirm = interpretDraftDecisionResponse(409, { ok: false, error: "client_has_no_firm" });
assert(
  !noFirm.ok && noFirm.message === DRAFT_INVITE_ACCOUNTANT && noFirm.invite && !noFirm.refresh,
  "a client with no firm asks for an invite",
);

const openRequest = interpretDraftDecisionResponse(409, { ok: false, error: "accountant_request_already_open" });
assert(
  !openRequest.ok && openRequest.message === DRAFT_WITH_ACCOUNTANT && !openRequest.invite,
  "an open accountant request stays with the accountant",
);

const signed = interpretDraftDecisionResponse(400, { ok: false, error: "signed_off_refused" });
assert(!signed.ok && signed.message === DRAFT_SIGNED_OFF && !signed.hideButtons, "a sign-off is refused in plain words");

for (const status of [401, 403]) {
  const hidden = interpretDraftDecisionResponse(status, { ok: false, error: "forbidden" });
  assert(!hidden.ok && hidden.hideButtons, `${status} hides the buttons`);
}

const missing = interpretDraftDecisionResponse(404, null);
assert(!missing.ok && missing.hideButtons, "a missing function stays read-only");

const gone = interpretDraftDecisionResponse(404, { ok: false, error: "finding_not_found" });
assert(!gone.ok && gone.message === DRAFT_ALREADY_DECIDED && gone.refresh, "a missing draft refreshes");

const other = interpretDraftDecisionResponse(500, { ok: false, error: "record_not_saved" });
assert(!other.ok && other.message === DRAFT_NOT_SAVED && !other.hideButtons, "a save failure can be tried again");

assert(approvedLiveLink("action_items")?.label === "Open Next moves", "an action item opens Next moves");
assert(approvedLiveLink("proposed_next_steps")?.screen === "moves", "a proposed next step opens Next moves");
assert(approvedLiveLink("data_requests")?.label === "Open requests", "a data request opens requests");
assert(approvedLiveLink("data_requests")?.screen === "accountant", "requests live on the accountant tab");
assert(approvedLiveLink("deliverable_drafts") === null, "an owner does not get a deliverable link");

function row(partial: Partial<AgentFindingRow> & Pick<AgentFindingRow, "id" | "kind" | "title">): AgentFindingRow {
  return {
    agent: "financial_manager",
    client_id: "c",
    detail: "Please confirm the source.",
    evidence: { draft: true, requires_human_approval: true },
    as_of: null,
    created_at: "2026-10-09T11:00:00.000Z",
    ...partial,
  };
}

resetDraftDecisionButtonsForTests();
const owner = renderToStaticMarkup(
  createElement(OwnerDraftCard, {
    layout: "moves",
    row: row({ id: "owner", kind: "data_request_draft", title: "Gross margin is 0.6." }),
  }),
);
assert(owner.includes("Approve") && owner.includes("Dismiss"), "an owner draft shows Approve and Dismiss");
assert(owner.includes('data-draft-status="owner"'), "an owner draft is marked for the owner");
assert(!owner.includes("Confirm"), "the edit step waits for Approve");

const accountant = renderToStaticMarkup(
  createElement(OwnerDraftCard, {
    layout: "moves",
    row: row({ id: "accountant", kind: "accountant_handoff_draft", title: "Ask the accountant to confirm payroll." }),
  }),
);
assert(!accountant.includes("Approve") && !accountant.includes("Dismiss"), "an accountant draft has no owner buttons");
assert(
  accountant.includes("needs your accountant") && accountant.includes('data-draft-status="accountant"'),
  "an accountant draft says who must approve",
);

const advisory = renderToStaticMarkup(
  createElement(OwnerDraftCard, {
    layout: "moves",
    row: row({ id: "advisory", kind: "advisory_deliverable_draft", title: "Board note" }),
  }),
);
assert(!advisory.includes('data-draft-actions="owner"'), "an advisory draft stays read-only for the owner");

const live = renderToStaticMarkup(
  createElement(OwnerDraftCard, {
    layout: "moves",
    row: row({
      id: "live",
      kind: "action_point_draft",
      title: "Chase the oldest invoice",
      status: "approved",
      approved_table: "action_items",
      approved_row_id: recordId,
      evidence: { draft: false, requires_human_approval: true },
    }),
  }),
);
assert(live.includes("Approved") && live.includes("Open Next moves"), "an approved action shows the Next moves link");
assert(live.includes(`data-record-id="${recordId}"`), "the link carries the live row");
assert(!live.includes('data-draft-actions="owner"'), "an approved row has no second approve");

const request = renderToStaticMarkup(
  createElement(OwnerDraftCard, {
    layout: "moves",
    row: row({
      id: "request",
      kind: "data_request_draft",
      title: "Reconnect the ledger",
      status: "approved",
      approved_table: "data_requests",
      approved_row_id: recordId,
      evidence: { draft: false, requires_human_approval: true },
    }),
  }),
);
assert(request.includes("Open requests"), "an approved data request opens the accountant requests");

console.log("agent-draft-decision-client: ok");
