/**
 * Source-document UI: upload path, approval copy, and who sees Approve.
 * Run: pnpm test:source-documents-ui
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceDocumentsView } from "../src/components/source-documents-panel";
import { uploadSourceDocument, type SourceUploadApi } from "../src/lib/source-documents-browser";
import {
  approvalSentence,
  buildSourceDocumentsModel,
  cleanApprovalProgress,
  extractSourceDocumentBody,
  holdingLabel,
  ledgerDecisionMessage,
  mayApproveLedgerPost,
  sanitizeSourceObjectName,
  sha256HexOfBytes,
  sourceObjectPath,
  type SourceProposalRow,
} from "../src/lib/source-documents-ui";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const CLIENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

assert(
  sanitizeSourceObjectName("My Invoice (final).pdf") === "My-Invoice-final.pdf",
  "spaces and brackets become dashes",
);
assert(
  sanitizeSourceObjectName("inv/../evil.pdf") === "evil.pdf",
  "a folder in the name is dropped",
);
assert(!sanitizeSourceObjectName("a/b/c.pdf").includes("/"), "the object name has no slash");
assert(sanitizeSourceObjectName("...") === "document", "an empty name falls back");
assert(
  /^[A-Za-z0-9._-]+$/.test(sanitizeSourceObjectName("Näïve #1.pdf")),
  "only the allowed characters remain",
);
assert(
  sourceObjectPath(CLIENT, "INV 14.pdf") === `${CLIENT}/INV-14.pdf`,
  "the storage path is client id plus one name",
);
assert(sourceObjectPath(CLIENT, "INV 14.pdf").split("/").length === 2, "there is no extra folder");

const abc = await sha256HexOfBytes(new TextEncoder().encode("abc"));
assert(
  abc === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "sha256 is computed from the file bytes",
);

assert(
  mayApproveLedgerPost({ clientHasFirm: true, isOwner: true, isFirmMemberWithAccess: false }) ===
    false,
  "an owner does not approve when a firm is on the file",
);
assert(
  mayApproveLedgerPost({ clientHasFirm: true, isOwner: false, isFirmMemberWithAccess: true }) ===
    true,
  "a firm member with access approves when the client has a firm",
);
assert(
  mayApproveLedgerPost({ clientHasFirm: false, isOwner: true, isFirmMemberWithAccess: false }) ===
    true,
  "the owner approves when there is no firm",
);
assert(
  mayApproveLedgerPost({ clientHasFirm: false, isOwner: false, isFirmMemberWithAccess: true }) ===
    false,
  "a firm member does not approve a client with no firm",
);

assert(
  holdingLabel("held_in_milon") === "Held in Milōn",
  "QuickBooks and Sage drafts say Held in Milōn",
);
assert(holdingLabel("ledger_draft") === null, "a Xero ledger draft does not use the held label");
assert(
  cleanApprovalProgress(1) === "1 of 3 clean approvals",
  "progress counts clean approvals toward 3",
);
assert(
  ledgerDecisionMessage("approver_forbidden", "accountant") ===
    "A firm member with access to this client approves it.",
  "approver_forbidden explains who can approve",
);
assert(
  ledgerDecisionMessage("not_proposed", null) ===
    "This proposal is no longer waiting for a decision.",
  "not_proposed says the proposal has moved on",
);
assert(
  ledgerDecisionMessage("signed_off_refused") ===
    "Choose Approve or Reject. This step is an approval.",
  "signed_off_refused stays an approval",
);
assert(
  extractSourceDocumentBody({ documentId: "doc-1", targetLedger: "sage", requestedMode: "final" })
    .requested_mode === "final",
  "extract sends the requested mode",
);

const uploaded: string[] = [];
const removed: string[] = [];
const api: SourceUploadApi = {
  upload: async (path) => {
    uploaded.push(path);
    return { error: null };
  },
  remove: async (path) => {
    removed.push(path);
  },
  register: async (args) => {
    assert(args.p_storage_path === uploaded[0], "register uses the uploaded path");
    assert(args.p_sha256 === abc, "register sends the client sha256");
    assert(args.p_channel === "upload", "the channel is upload");
    assert(
      !args.p_storage_path.slice(CLIENT.length + 1).includes("/"),
      "the registered name has no subfolder",
    );
    return { data: { ok: true, duplicate: true, document_id: "existing-doc" }, error: null };
  },
  existingPath: async () => `${CLIENT}/already.pdf`,
};

const file = new File([new TextEncoder().encode("abc")], "Invoice copy.pdf", {
  type: "application/pdf",
});
const outcome = await uploadSourceDocument({ clientId: CLIENT, file, channel: "upload" }, api);
assert(outcome.ok && outcome.duplicate, "a duplicate upload is reported");
assert(removed.length === 1, "the extra object is removed when the file is a duplicate");

const proposal = (patch: Partial<SourceProposalRow> = {}): SourceProposalRow => ({
  id: "proposal-1",
  document_id: "doc-1",
  target_ledger: "qbo",
  doc_type: "bill",
  mode: "draft",
  draft_holding: "held_in_milon",
  status: "proposed",
  supplier_key: "acme",
  supplier_display_name: "Acme Supplies",
  document_number: "INV-14",
  amount: 1150,
  issued_on: "2026-10-01",
  payload: {
    contact: { name: "Acme Supplies", vat_number: "4123456789", create_new: false },
    invoice_number: "INV-14",
    issued_on: "2026-10-01",
    currency: "ZAR",
    amounts_are: "inclusive",
    lines: [{ description: "Paper", amount: "1000.00" }],
    tax_total: "150.00",
    total: "1150.00",
    mode: "draft",
  },
  flags: { final_locked: true },
  created_at: "2026-10-11T08:00:00.000Z",
  ...patch,
});

const documents = [
  {
    id: "doc-1",
    storage_path: `${CLIENT}/acme-inv-14.pdf`,
    status: "proposed",
    received_at: "2026-10-11T08:00:00.000Z",
  },
];
const trust = [{ supplier_key: "acme", clean_approved_drafts: 1 }];

const ownerWithFirm = buildSourceDocumentsModel({
  surface: "upload",
  viewer: { clientHasFirm: true, isOwner: true, isFirmMemberWithAccess: false },
  documents,
  extractions: [],
  proposals: [proposal()],
  trust,
  duplicate: true,
  connectedLedgers: ["qbo"],
});
assert(ownerWithFirm.duplicate, "the model keeps the duplicate notice");
assert(ownerWithFirm.cards[0]?.holding === "Held in Milōn", "the owner card names the holding");
assert(
  ownerWithFirm.cards[0]?.progress?.includes("1 of 3 clean approvals"),
  "the owner card shows clean-approval progress",
);
assert(
  ownerWithFirm.cards[0]?.action.kind === "quiet",
  "the owner does not get Approve when a firm is on the file",
);
assert(
  ownerWithFirm.cards[0]?.answer === "Waiting for your accountant.",
  "the owner is told who approves",
);

const accountant = buildSourceDocumentsModel({
  surface: "review",
  viewer: { clientHasFirm: true, isOwner: false, isFirmMemberWithAccess: true, name: "Ada Nkosi" },
  documents,
  extractions: [],
  proposals: [proposal()],
  trust,
  connectedLedgers: ["qbo"],
});
assert(accountant.cards[0]?.action.kind === "approve", "the firm member sees Approve");
assert(
  accountant.cards[0]?.action.kind === "approve" && accountant.cards[0].action.button === "Approve",
  "the button is Approve",
);
assert(
  accountant.lede === "1 document is waiting for your approval.",
  "the review page has one answer",
);

const ownerAlone = buildSourceDocumentsModel({
  surface: "upload",
  viewer: { clientHasFirm: false, isOwner: true, isFirmMemberWithAccess: false },
  documents,
  extractions: [],
  proposals: [proposal({ target_ledger: "xero", draft_holding: "ledger_draft" })],
  trust,
  connectedLedgers: ["xero"],
});
assert(ownerAlone.cards[0]?.action.kind === "approve", "the owner approves when there is no firm");
assert(ownerAlone.cards[0]?.holding === null, "a Xero draft is not labelled Held in Milōn");

const approved = buildSourceDocumentsModel({
  surface: "review",
  viewer: { clientHasFirm: true, isOwner: false, isFirmMemberWithAccess: true },
  documents,
  extractions: [],
  proposals: [
    proposal({
      status: "approved",
      approved_by: "user-ada",
      approved_at: "2026-10-12T07:41:00.000Z",
      approver_role: "accountant",
    }),
  ],
  trust: [{ supplier_key: "acme", clean_approved_drafts: 2 }],
  names: { "user-ada": "Ada Nkosi" },
  timeZone: "UTC",
});
assert(
  approved.cards[0]?.approval === approvalSentence("Ada Nkosi", "12 Oct 2026, 07:41 UTC"),
  "an approval names the person and the time",
);
assert(approved.cards[0]?.action.kind === "quiet", "an approved proposal has no second decision");

function html(model: ReturnType<typeof buildSourceDocumentsModel>): string {
  return renderToStaticMarkup(createElement(SourceDocumentsView, { model }));
}

const ownerHtml = html(ownerWithFirm);
assert(ownerHtml.includes("Duplicate"), "the upload surface shows a Duplicate notice");
assert(ownerHtml.includes("Held in Milōn"), "the markup shows Held in Milōn");
assert(ownerHtml.includes("1 of 3 clean approvals"), "the markup shows the clean-approval count");
assert(!ownerHtml.includes(">Approve<"), "the owner with a firm has no Approve button");

const reviewHtml = html(accountant);
assert(reviewHtml.includes(">Approve<"), "the accountant markup has Approve");
assert(reviewHtml.includes(">Reject<"), "the accountant can reject");
assert(!/sign[\s-]*off/i.test(reviewHtml), "the review markup never says sign off");

const approvedHtml = html(approved);
assert(
  approvedHtml.includes("Approved by Ada Nkosi on 12 Oct 2026, 07:41 UTC."),
  "the markup shows who approved and when",
);

const panel = readFileSync("src/components/source-documents-panel.tsx", "utf8");
const ui = readFileSync("src/lib/source-documents-ui.ts", "utf8");
const browser = readFileSync("src/lib/source-documents-browser.ts", "utf8");
assert(!/sign[\s-]*off/i.test(panel), "the documents panel does not say sign off");
assert(
  !ui.includes("Sign off") && !ui.includes("sign-off"),
  "the documents copy does not say sign off",
);
assert(!/gold|#b8860b|#d4a550|#f3d98a/i.test(panel), "the documents panel does not use gold");
assert(
  panel.includes("#0B5FFF") && panel.includes("#102A43") && panel.includes("#DBEAFE"),
  "the panel uses brand v1.1 colours",
);
assert(browser.includes("SOURCE_DOCS_BUCKET"), "uploads use the source-docs bucket");
assert(browser.includes("upload.registerRpc"), "upload calls register_source_document");
assert(browser.includes("decide.rpc"), "a decision calls decide_ledger_post_proposal");
assert(browser.includes("extract.functionName"), "reading a file calls extract-source-document");
assert(
  browser.includes("list_note_collaborators"),
  "approver names come from people with client access",
);

const door = readFileSync("src/components/owner-door/owner-door.tsx", "utf8");
const brain = readFileSync("src/components/client-brain-summary.tsx", "utf8");
assert(door.includes('surface="upload"'), "owners upload from the documents area");
assert(brain.includes('surface="review"'), "accountants review on the client portal");
assert(
  door.includes("isFirmMemberWithAccess: false"),
  "the owner door does not treat the owner as the firm approver",
);
assert(
  brain.includes("isFirmMemberWithAccess: Boolean(firmId)"),
  "the portal approves only when the client has a firm",
);

console.log("source-documents-ui tests passed");
