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
import { draftWhenLabel, findingCardCopy, formatFindingProse, type AgentFindingRow } from "../src/lib/milon-team-activity.ts";
import { formatDate } from "../src/lib/market/format.ts";
import { resolveMarket, ZA_MARKET } from "../src/lib/market/resolve.ts";

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

const US = { currency: "USD" as const, locale: "en-US" };
const realRequest: AgentFindingRow = {
  id: "8063df10-3cdf-447e-91a5-169dda603f95",
  agent: "financial_manager",
  client_id: "3cc31b6a-10a6-4202-bec7-ebb32a4e1f7a",
  kind: "data_request_draft",
  title:
    "QuickBooks sync is in error; Oct 2026 upload has no statement totals. Please confirm the source of the ledger data.",
  detail:
    "Books on file (ledger or upload, not a bank feed): QuickBooks is connected but its sync status is error and there is no last-synced time. Xero and Sage are not connected. The latest source on file is a manual upload (Oct 2026, dated 2026-10-05). The stored statement totals for that period are empty and no liabilities total or cash runway is stored, so the ratios cannot be tied back to statement lines. Please (1) reconnect or re-sync QuickBooks, or confirm the manual upload is the intended source; and (2) provide the Oct 2026 statement lines (receivables, payables, revenue, cost of sales, overheads) so debtor and creditor days can be checked. Draft only: a person approves before anything is sent.",
  evidence: {
    draft: true,
    requires_human_approval: true,
    snapshot_id: "b6e99169-94ac-4fdb-9df5-056c7cb33209",
    period_label: "Oct 2026",
    figures: {
      has_upload: 1,
      "Debtor Days": 43.8,
      "Gross Margin": 0.6,
      "Creditor Days": 73,
      "Operating Margin": 0.16,
      connected_ledgers: 1,
    },
  },
  as_of: null,
  created_at: "2026-10-11T08:00:00.000Z",
};
const realCopy = findingCardCopy(realRequest, US);
assert(realCopy.lead.startsWith("QuickBooks sync is in error"), `the real request leads with the ask (${realCopy.lead})`);
assert(!realCopy.lead.includes("0.6") && !realCopy.lead.includes("43.8"), "the ask does not keep the raw ratios");
assert(
  realCopy.context === "Debtor days are 44, creditor days 73, gross margin 60%, operating margin 16%",
  `structured figures are the muted line (${realCopy.context})`,
);
const realCard = renderToStaticMarkup(
  createElement(OwnerDraftCard, { layout: "moves", row: realRequest, market: US }),
);
const createdAt = "2026-10-05T03:30:00.000Z";
const updatedAt = "2026-10-06T03:30:00.000Z";
const usMarket = resolveMarket({ country: "US", regionCode: "NY" });
assert(
  draftWhenLabel(createdAt, createdAt, ZA_MARKET) === `Created ${formatDate(createdAt, ZA_MARKET)}`,
  "a draft stamp uses the ZA market day",
);
assert(
  draftWhenLabel(createdAt, createdAt, usMarket) === `Created ${formatDate(createdAt, usMarket)}`,
  "a draft stamp uses the US market day",
);
assert(formatDate(createdAt, ZA_MARKET) !== formatDate(createdAt, usMarket), "ZA and US days differ for the same instant");
assert(
  draftWhenLabel(createdAt, updatedAt, usMarket) ===
    `Created ${formatDate(createdAt, usMarket)} · Updated ${formatDate(updatedAt, usMarket)}`,
  "an updated draft shows both market days",
);
const stamped = renderToStaticMarkup(
  createElement(OwnerDraftCard, {
    layout: "moves",
    row: { ...realRequest, created_at: createdAt, last_seen: updatedAt },
    market: usMarket,
  }),
);
assert(
  stamped.includes(`data-draft-when="Created ${formatDate(createdAt, usMarket)} · Updated ${formatDate(updatedAt, usMarket)}"`),
  "the Next moves card shows the market stamp",
);
const dumped = findingCardCopy(
  {
    kind: "data_request_draft",
    title: "Send the September debtors age analysis.\ngrossMargin: 0.42\nevidence keys you may cite: grossMargin",
    detail: "currentRatio: 1.4\nRatios:\nstored_ratios: {\"grossMargin\":0.42}",
    evidence: { draft: true, figures: { "Gross Margin": 0.6, "Debtor Days": 43.8 } },
  },
  ZA_MARKET,
);
assert(dumped.lead.includes("Send the September debtors age analysis"), dumped.lead);
assert(!/grossMargin\s*:/.test(dumped.lead), dumped.lead);
assert(!/evidence keys you may cite/i.test(`${dumped.lead} ${dumped.context ?? ""}`), dumped.lead);
const ratioCard = findingCardCopy(
  {
    kind: "cost_ratio",
    title: "Current ratio is thin.\ngrossMargin: 0.42\ncurrentRatio: 1.4\nevidence keys you may cite: currentRatio",
    detail: "Debtor days are 44 days.",
    evidence: { figures: { "Current Ratio": 1.4 } },
  },
  ZA_MARKET,
);
assert(ratioCard.lead.includes("Current ratio is thin"), ratioCard.lead);
assert(!/grossMargin\s*:/.test(ratioCard.lead), ratioCard.lead);
assert(!/currentRatio\s*:/.test(ratioCard.lead), ratioCard.lead);
assert(!/evidence keys you may cite/i.test(ratioCard.lead), ratioCard.lead);
assert(realCard.includes("QuickBooks sync is in error"), "the card shows the ask");
assert(realCard.includes('data-draft-context="Debtor days are 44, creditor days 73, gross margin 60%, operating margin 16%"'), "the card shows the muted ratios");
assert(!realCard.includes("0.6") && !realCard.includes("43.8"), "the card does not dump raw ratios");
assert(!realCard.includes("has_upload") && !realCard.includes("connected"), "flags stay off the muted line");

const dumpCopy = findingCardCopy(
  {
    kind: "data_request_draft",
    title: "Gross margin is 0.6. Debtor days are 43.8.",
    detail: "Send the September debtors age analysis",
    evidence: {
      draft: true,
      requires_human_approval: true,
      figures: { "Debtor Days": 43.8, "Gross Margin": 0.6 },
    },
  },
  ZA_MARKET,
);
assert(dumpCopy.lead === "Send the September debtors age analysis", `a ratio title yields the ask (${dumpCopy.lead})`);
assert(dumpCopy.context === "Debtor days are 44, gross margin 60%", `the dump becomes the muted line (${dumpCopy.context})`);

const evidenceAsk = findingCardCopy(
  {
    kind: "data_request_draft",
    title: "Gross margin is 0.6. Debtor days are 43.8.",
    detail: null,
    evidence: {
      draft: true,
      request_title: "Send the September debtors age analysis",
      figures: { "Gross Margin": 0.6, "Debtor Days": 43.8 },
    },
  },
  ZA_MARKET,
);
assert(evidenceAsk.lead === "Send the September debtors age analysis", "an evidence request title is the ask");

assert(
  formatFindingProse(
    "Gross margin is 0.6 and net margin 0.0857 on revenue of 700,000.",
    [
      { key: "Gross Margin", value: 0.6 },
      { key: "Net Margin", value: 0.08571428571428572 },
      { key: "revenue", value: 700000 },
    ],
    US,
  ) === "Gross margin is 60% and net margin 8.6% on revenue of $700,000.",
  "free text uses the evidence metric and the client currency",
);
assert(
  formatFindingProse(
    "Debtor days are 43.8.",
    [{ key: "Debtor Days", value: 43.8 }],
    ZA_MARKET,
  ) === "Debtor days are 44 days.",
  "days in the finding text round",
);
assert(
  formatFindingProse("Revenue of 700,000.", [{ key: "revenue", value: 700000 }], ZA_MARKET) === "Revenue of R 700 000.",
  "rand amounts use the client market",
);
assert(
  formatFindingProse(
    "Profit is the weakest pillar at 70 out of 100.",
    [{ key: "pillar:profit", value: 70 }],
    US,
  ) === "Profit is the weakest pillar at 70.",
  "a pillar score is not currency",
);
assert(
  formatFindingProse("The weakest pillar is at $70 out of 100.", [], US) ===
    "The weakest pillar is at 70.",
  "a stored score dollar sign is removed",
);
assert(
  formatFindingProse(
    "The opening balance of $0 is on file.",
    [{ key: "openingBalance", value: 0 }],
    US,
  ) === "The opening balance of $0 is on file.",
  "an amount that already has a symbol does not gain a second one",
);
assert(
  formatFindingProse("The opening balance of $$0 is on file.", [], US) ===
    "The opening balance of $0 is on file.",
  "a doubled dollar sign collapses",
);

console.log("agent-draft-decision-client: ok");
