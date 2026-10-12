/**
 * Source documents → ledger proposal. No database and no ledger calls.
 * Run: pnpm test:source-documents-ledger
 */
import { readFileSync } from "node:fs";
import { recordMarksSignedOff, refusesSignOffWording } from "../src/lib/agent-draft-decision.ts";
import { runLedgerPostingJob } from "../src/lib/ledger-post-job.ts";
import { sourceDocumentHooks } from "../src/lib/source-document-hooks.ts";
import {
  DEFAULT_FINAL_UNLOCK_AFTER_CLEAN_DRAFTS,
  SOURCE_DOC_PROMPT_VERSION,
  assessSourceDocument,
  callerMayDecidePosting,
  canonicalJson,
  decidePosting,
  documentNumberKey,
  draftHoldingLabel,
  extractionMimeSupported,
  finalPostingAllowed,
  findSourceDuplicates,
  fingerprintBankDetails,
  isValidSaVatNumber,
  normaliseConfidence,
  ownerMaySignOff,
  parseModelDocument,
  parseMoney,
  postingApproverRole,
  proposalIsClean,
  retentionUntil,
  reviseProposalPayload,
  saInputVatClaimable,
  sealPayload,
  sha256Hex,
  supplierKey,
  type ProposalDecisionState,
  type ProposalPayload,
} from "../src/lib/source-document-ledger.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function field(value: unknown, confidence = 0.99) {
  return { value, confidence, page: 1 };
}

function billJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    doc_type: "bill",
    is_statement: false,
    supplier_name: field("Acme (Pty) Ltd"),
    supplier_vat_number: field("4123456789"),
    invoice_number: field("INV-100"),
    issued_on: field("11/10/2026"),
    currency: field("ZAR"),
    amounts_are: field("exclusive"),
    tax_invoice_wording: field(true),
    recipient_name: field("Buyer CC"),
    line_items: [{ description: "Consulting", quantity: 1, amount: 100, tax: 15, confidence: 0.99 }],
    tax_total: field(15),
    total: field(115),
    bank_account_number: field(""),
    bank_branch_code: field(""),
    ...overrides,
  });
}

const migration = read("supabase/migrations/20261013170000_source_documents_to_ledger.sql");
const edge = read("supabase/functions/extract-source-document/index.ts");
const prompt = read("supabase/functions/extract-source-document/prompt.ts");
const jobSrc = read("src/lib/ledger-post-job.ts");
const sqlTest = read("scripts/source-documents-ledger-sql-tests.sql");

assert(canonicalJson({ b: 1, a: "x" }) === '{"a":"x","b":1}', "canonical JSON sorts keys");
assert((await sha256Hex("")) === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "sha256 of empty string");

const keptUntil = retentionUntil(new Date("2026-10-11T00:00:00.000Z"));
assert(keptUntil.toISOString().startsWith("2031-10-11"), "source files are kept for 5 years");
assert(DEFAULT_FINAL_UNLOCK_AFTER_CLEAN_DRAFTS === 3, "final mode unlocks after 3 clean drafts");
assert(normaliseConfidence(95) === 0.95, "a percent confidence becomes a fraction");
assert(normaliseConfidence(0.94) === 0.94, "a fraction confidence stays a fraction");
assert(supplierKey("Acme (Pty) Ltd") === "acme", "legal suffixes do not change the supplier key");
assert(supplierKey("ACME CC") === "acme", "CC is stripped from the supplier key");
assert(documentNumberKey("inv 100") === "INV100", "invoice numbers ignore case and spaces");
assert(documentNumberKey("INV-100") === "INV100", "invoice numbers ignore hyphens");
assert(parseMoney("R 1 150.00") === 1150, "SA amounts keep the cents");
assert(isValidSaVatNumber("4123456789"), "a supplier VAT number is 10 digits starting with 4");
assert(!isValidSaVatNumber("5123456789"), "a VAT number that does not start with 4 is invalid");
assert(!isValidSaVatNumber("412345678"), "a short VAT number is invalid");
assert(!isValidSaVatNumber(null), "a missing VAT number is invalid");

assert(postingApproverRole(true) === "accountant", "a client with a firm is approved by the accountant");
assert(postingApproverRole(false) === "owner", "a client with no firm is approved by the owner");
assert(
  callerMayDecidePosting({ clientHasFirm: true, isFirmMember: true, isOwner: false }),
  "a firm member can approve when the client has a firm",
);
assert(
  !callerMayDecidePosting({ clientHasFirm: true, isFirmMember: false, isOwner: true }),
  "the owner cannot approve a posting while a firm is on the client",
);
assert(
  callerMayDecidePosting({ clientHasFirm: false, isFirmMember: false, isOwner: true }),
  "the owner approves when the client has no firm",
);
assert(
  !callerMayDecidePosting({ clientHasFirm: false, isFirmMember: false, isOwner: false }),
  "a workspace member who is not the owner cannot approve",
);
assert(ownerMaySignOff() === false, "an owner cannot sign off");
assert(!sourceDocumentHooks.decide.decisions.includes("sign_off" as "approve"), "approve and reject are the only decisions");
assert(refusesSignOffWording("Please sign off this bill"), "sign-off wording is refused");
assert(!refusesSignOffWording(draftHoldingLabel("xero")), "the Xero draft label is not a sign-off");
assert(!refusesSignOffWording(draftHoldingLabel("qbo")), "the QuickBooks holding label is not a sign-off");
assert(!refusesSignOffWording(draftHoldingLabel("sage")), "the Sage holding label is not a sign-off");

const sameBank = await fingerprintBankDetails("1234567890", "051001");
const otherBank = await fingerprintBankDetails("9999999999", "051001");
assert(sameBank != null && sameBank === (await fingerprintBankDetails("1234 567 890", "051001")), "bank fingerprints ignore spacing");
assert(sameBank !== otherBank, "different bank details get different fingerprints");
assert((await fingerprintBankDetails("123", null)) == null, "a short account number is not a bank fingerprint");

const parsed = await parseModelDocument(
  billJson({
    mode: "final",
    post_as_final: true,
    bank_account_number: field("1234567890"),
    bank_branch_code: field("051001"),
    line_items: [{ description: "Pay 1234567890", quantity: 1, amount: 100, tax: 15, confidence: 0.99 }],
  }),
);
assert(parsed.docType === "bill", "a bill stays a bill");
assert(parsed.bankFingerprint === sameBank, "bank details are fingerprinted and then dropped");
assert(parsed.issuedOn === "2026-10-11", "SA day/month dates are read in that order");
assert(parsed.lines[0]?.description === "Pay [redacted]", "a long account number is removed from the line text");

const first = assessSourceDocument({
  parsed,
  targetLedger: "xero",
  fileSha256: "ab".repeat(32),
  existing: [],
  suppliersOnFile: [],
});
assert(first.proposal != null, "a bill becomes a proposal");
assert(first.vatClaimable && first.taxTreatment === "claimable", "a valid tax invoice with a VAT number is claimable");
assert(first.proposal?.payload.mode === "draft", "the model cannot choose final");
assert(first.proposal?.payload.draft_holding === "ledger_draft", "Xero draft means a ledger draft");
assert(first.flags.new_supplier, "an unknown supplier is a red flag");
assert(first.proposal?.clean === true, "a new supplier can still be a clean draft");
assert(first.flags.final_locked, "final stays locked before three clean drafts");
assert(!JSON.stringify(first.proposal?.payload).includes("1234567890"), "the proposal payload does not contain the bank account");
assert(!recordMarksSignedOff({ ...(first.proposal?.payload as object) }), "a proposal is not a sign-off record");

const noVat = assessSourceDocument({
  parsed: await parseModelDocument(billJson({ supplier_vat_number: field("") })),
  targetLedger: "qbo",
  fileSha256: "cd".repeat(32),
  existing: [],
  suppliersOnFile: [],
});
assert(!noVat.vatClaimable && noVat.taxTreatment === "non_claimable", "missing VAT number defaults to non-claimable");
assert(noVat.flags.vat_reason === "supplier_vat_number_missing_or_invalid", "the default reason is the missing VAT number");
assert(noVat.proposal?.payload.draft_holding === "held_in_milon", "QuickBooks draft is held in Milōn");

const badVat = saInputVatClaimable({
  docType: "bill",
  taxInvoiceWording: true,
  supplierName: "Acme",
  supplierVatNumber: "5123456789",
  invoiceNumber: "INV-1",
  issuedOn: "2026-10-11",
  total: 115,
  hasDescription: true,
  recipientName: "Buyer",
});
assert(!badVat.claimable, "an invalid VAT number is non-claimable");

const abridged = saInputVatClaimable({
  docType: "receipt",
  taxInvoiceWording: true,
  supplierName: "Acme",
  supplierVatNumber: "4 123 456 789",
  invoiceNumber: "R1",
  issuedOn: "2026-10-11",
  total: 200,
  hasDescription: true,
  recipientName: null,
});
assert(abridged.claimable, "an abridged tax invoice does not need the recipient");

const fullMissingRecipient = saInputVatClaimable({
  ...{
    docType: "bill" as const,
    taxInvoiceWording: true,
    supplierName: "Acme",
    supplierVatNumber: "4123456789",
    invoiceNumber: "INV-9",
    issuedOn: "2026-10-11",
    total: 6000,
    hasDescription: true,
    recipientName: null,
  },
});
assert(!fullMissingRecipient.claimable, "a tax invoice over R5 000 needs the recipient");

const low = assessSourceDocument({
  parsed: await parseModelDocument(billJson({ total: field(115, 0.5) })),
  targetLedger: "sage",
  fileSha256: "ef".repeat(32),
  existing: [],
  suppliersOnFile: [{ supplierKey: "acme", vatNumber: "4123456789", bankFingerprint: null, cleanApprovedDrafts: 3 }],
  finalUnlockAfter: 3,
});
assert(low.flags.low_confidence && low.flags.low_confidence_fields.includes("total"), "a weak total is flagged");
assert(low.proposal?.payload.mode === "draft" && low.flags.final_locked, "low confidence cannot be final");
assert(low.proposal?.payload.draft_holding === "held_in_milon", "Sage draft is held in Milōn");
assert(low.flags.new_supplier === false, "a VAT number match is the supplier on file");

const mismatched = assessSourceDocument({
  parsed: await parseModelDocument(
    billJson({
      line_items: [{ description: "Consulting", quantity: 1, amount: 100, tax: 20, confidence: 0.99 }],
      tax_total: field(20),
      total: field(120),
    }),
  ),
  targetLedger: "xero",
  fileSha256: "11".repeat(32),
  existing: [],
  suppliersOnFile: [],
});
assert(mismatched.flags.arithmetic_mismatch, "VAT that is not 15 percent fails the arithmetic check");
assert(!mismatched.vatClaimable, "a VAT arithmetic mismatch is non-claimable");
assert(!proposalIsClean(mismatched.flags), "an arithmetic mismatch is not a clean draft");

const fileSha = "22".repeat(32);
const duplicate = assessSourceDocument({
  parsed,
  targetLedger: "xero",
  fileSha256: fileSha,
  existing: [
    {
      documentId: "doc-old",
      sha256: fileSha,
      supplierKey: "other",
      documentNumber: "OTHER",
      amount: 1,
      issuedOn: "2026-01-01",
      status: "proposed",
    },
    {
      documentId: "doc-same",
      sha256: "33".repeat(32),
      supplierKey: "acme",
      documentNumber: "INV100",
      amount: 115,
      issuedOn: "2026-10-11",
      status: "approved",
    },
  ],
  suppliersOnFile: [],
  excludeDocumentId: "doc-current",
});
assert(duplicate.flags.duplicate_file, "the same file hash is a duplicate");
assert(duplicate.flags.duplicate_document, "the same supplier, number, amount, and date is a duplicate");

const near = findSourceDuplicates(
  {
    fileSha256: "44".repeat(32),
    supplierKey: "Acme Pty Ltd",
    documentNumber: "INV-100",
    amount: 115,
    issuedOn: "2026-10-09",
  },
  [
    {
      documentId: "doc-near",
      sha256: "55".repeat(32),
      supplierKey: "acme",
      documentNumber: "INV100",
      amount: 115.0,
      issuedOn: "2026-10-11",
      status: "proposed",
    },
  ],
);
assert(near.semantic, "the same invoice within 3 days is a duplicate");

const far = findSourceDuplicates(
  {
    fileSha256: "44".repeat(32),
    supplierKey: "acme",
    documentNumber: "INV100",
    amount: 115,
    issuedOn: "2026-10-07",
  },
  [
    {
      documentId: "doc-far",
      sha256: "55".repeat(32),
      supplierKey: "acme",
      documentNumber: "INV100",
      amount: 115,
      issuedOn: "2026-10-11",
    },
  ],
);
assert(!far.semantic && !far.file, "four days apart is not the same invoice");

const rejectedDup = findSourceDuplicates(
  {
    fileSha256: fileSha,
    supplierKey: "acme",
    documentNumber: "INV100",
    amount: 115,
    issuedOn: "2026-10-11",
  },
  [
    {
      documentId: "doc-rejected",
      sha256: fileSha,
      supplierKey: "acme",
      documentNumber: "INV100",
      amount: 115,
      issuedOn: "2026-10-11",
      status: "rejected",
    },
  ],
);
assert(!rejectedDup.file && !rejectedDup.semantic, "a rejected document does not count as a duplicate");

const bankFlag = assessSourceDocument({
  parsed,
  targetLedger: "xero",
  fileSha256: "66".repeat(32),
  existing: [],
  suppliersOnFile: [
    { supplierKey: "acme", vatNumber: "4123456789", bankFingerprint: otherBank, cleanApprovedDrafts: 3 },
  ],
});
assert(bankFlag.flags.bank_details_changed, "bank details that differ from the supplier on file are a red flag");
assert(!bankFlag.proposal?.clean, "a bank-detail change is not a clean draft");
assert(!finalPostingAllowed({ flags: bankFlag.flags, cleanApprovedDrafts: 3 }), "a bank-detail change cannot be final");

const statement = assessSourceDocument({
  parsed: await parseModelDocument(billJson({ doc_type: "bill", is_statement: true })),
  targetLedger: "xero",
  fileSha256: "77".repeat(32),
  existing: [],
  suppliersOnFile: [],
});
assert(statement.proposal == null && statement.skipReason === "bank_statement", "a statement is not proposed as a bill");
assert(statement.flags.statement_not_a_bill, "a statement is flagged");

const known = {
  supplierKey: "acme",
  vatNumber: "4123456789",
  bankFingerprint: sameBank,
  cleanApprovedDrafts: 3,
};
const finalBill = assessSourceDocument({
  parsed: await parseModelDocument(billJson()),
  targetLedger: "qbo",
  requestedMode: "final",
  fileSha256: "88".repeat(32),
  existing: [],
  suppliersOnFile: [known],
  finalUnlockAfter: 3,
});
assert(finalBill.proposal?.payload.mode === "final", "final is allowed after 3 clean drafts when nothing is flagged");
assert(!finalBill.flags.final_locked, "the final lock is open");
assert(finalBill.proposal?.payload.draft_holding === "held_in_milon", "a QuickBooks final still records that draft means held in Milōn");

const sealed = await sealPayload(finalBill.proposal?.payload as ProposalPayload);
assert(canonicalJson(JSON.parse(sealed.canonicalPayload)) === sealed.canonicalPayload, "the sealed payload round-trips");
const decided = decidePosting({
  proposal: {
    status: "proposed",
    canonicalPayload: sealed.canonicalPayload,
    payloadSha256: sealed.payloadSha256,
    approvalPayloadSha256: null,
    approvedBy: null,
    approvedAt: null,
    approverRole: null,
    rejectedBy: null,
    version: 1,
  },
  decision: "approve",
  callerId: "accountant-1",
  clientHasFirm: true,
  isFirmMember: true,
  isOwner: false,
  now: "2026-10-11T12:00:00.000Z",
});
assert(decided.ok && decided.proposal.status === "approved", "the accountant approves");
assert(decided.ok && decided.proposal.approvalPayloadSha256 === sealed.payloadSha256, "approval stores the payload hash");
assert(decided.ok && decided.proposal.approverRole === "accountant", "the stored role is accountant");
assert(
  !recordMarksSignedOff({
    approved_by: decided.ok ? decided.proposal.approvedBy : null,
    approved_at: decided.ok ? decided.proposal.approvedAt : null,
    approval_payload_sha256: decided.ok ? decided.proposal.approvalPayloadSha256 : null,
    status: decided.ok ? decided.proposal.status : null,
  }),
  "an approval row is not a sign-off",
);

const ownerBlocked = decidePosting({
  proposal: decided.ok ? { ...decided.proposal, status: "proposed", approvalPayloadSha256: null, approvedBy: null, approvedAt: null } : ({} as ProposalDecisionState),
  decision: "approve",
  callerId: "owner-1",
  clientHasFirm: true,
  isFirmMember: false,
  isOwner: true,
  now: "2026-10-11T12:00:00.000Z",
});
assert(!ownerBlocked.ok && ownerBlocked.error === "approver_forbidden", "the owner is refused when a firm is attached");

const signOff = decidePosting({
  proposal: {
    status: "proposed",
    canonicalPayload: sealed.canonicalPayload,
    payloadSha256: sealed.payloadSha256,
    approvalPayloadSha256: null,
    approvedBy: null,
    approvedAt: null,
    approverRole: null,
    rejectedBy: null,
    version: 1,
  },
  decision: "approve",
  note: "Sign-off please",
  callerId: "accountant-1",
  clientHasFirm: true,
  isFirmMember: true,
  isOwner: false,
  now: "2026-10-11T12:00:00.000Z",
});
assert(!signOff.ok && signOff.error === "signed_off_refused", "an approval note cannot say sign off");

const solo = decidePosting({
  proposal: {
    status: "proposed",
    canonicalPayload: sealed.canonicalPayload,
    payloadSha256: sealed.payloadSha256,
    approvalPayloadSha256: null,
    approvedBy: null,
    approvedAt: null,
    approverRole: null,
    rejectedBy: null,
    version: 1,
  },
  decision: "approve",
  callerId: "owner-2",
  clientHasFirm: false,
  isFirmMember: false,
  isOwner: true,
  now: "2026-10-11T12:00:00.000Z",
});
assert(solo.ok && solo.proposal.approverRole === "owner" && solo.proposal.status === "approved", "the owner approves when there is no firm");
assert(ownerMaySignOff() === false, "that approval is still not a sign-off");

assert(decided.ok, "the approved proposal is available");
const again = decidePosting({
  proposal: decided.proposal,
  decision: "approve",
  callerId: "accountant-1",
  clientHasFirm: true,
  isFirmMember: true,
  isOwner: false,
  now: "2026-10-11T13:00:00.000Z",
});
assert(again.ok && again.already && again.proposal.approvedAt === "2026-10-11T12:00:00.000Z", "a second approve returns the same approval");

const editedPayload: ProposalPayload = {
  ...(finalBill.proposal?.payload as ProposalPayload),
  total: "116.00",
};
const revised = await reviseProposalPayload(decided.proposal, editedPayload);
assert(revised.status === "proposed" && revised.approvalPayloadSha256 == null, "an edit clears the approval");
assert(revised.version === 2 && revised.payloadSha256 !== decided.proposal.payloadSha256, "an edit needs a new hash and a new approval");
const same = await reviseProposalPayload(decided.proposal, finalBill.proposal?.payload as ProposalPayload);
assert(same.status === "approved" && same.version === 1, "saving the same payload keeps the approval");

const approvedInput = {
  status: decided.proposal.status,
  approvedBy: decided.proposal.approvedBy,
  approvedAt: decided.proposal.approvedAt,
  approverRole: decided.proposal.approverRole,
  canonicalPayload: decided.proposal.canonicalPayload,
  payloadSha256: decided.proposal.payloadSha256,
  approvalPayloadSha256: decided.proposal.approvalPayloadSha256,
  cleanApprovedDrafts: 3,
  finalUnlockAfter: 3,
};
const ready = await runLedgerPostingJob(approvedInput);
assert(ready.ok && ready.action === "ready" && ready.ledgerCalled === false, "a matching final approval is ready and does not call a ledger");

const tampered = await runLedgerPostingJob({
  ...approvedInput,
  canonicalPayload: revised.canonicalPayload,
});
assert(!tampered.ok && tampered.action === "refused" && tampered.reason === "payload_hash_mismatch", "a changed payload is refused");
assert(tampered.ledgerCalled === false, "a mismatch does not call a ledger");

const xeroDraft = assessSourceDocument({
  parsed: await parseModelDocument(billJson()),
  targetLedger: "xero",
  fileSha256: "99".repeat(32),
  existing: [],
  suppliersOnFile: [known],
});
const xeroSealed = await sealPayload(xeroDraft.proposal?.payload as ProposalPayload);
const xeroJob = await runLedgerPostingJob({
  status: "approved",
  approvedBy: "accountant-1",
  approvedAt: "2026-10-11T12:00:00.000Z",
  approverRole: "accountant",
  canonicalPayload: xeroSealed.canonicalPayload,
  payloadSha256: xeroSealed.payloadSha256,
  approvalPayloadSha256: xeroSealed.payloadSha256,
  cleanApprovedDrafts: 0,
  finalUnlockAfter: 3,
});
assert(xeroJob.ok && xeroJob.action === "ready" && xeroJob.ledgerCalled === false, "an approved Xero draft is ready for a later draft post");

const qboDraft = assessSourceDocument({
  parsed: await parseModelDocument(billJson()),
  targetLedger: "qbo",
  fileSha256: "aa".repeat(32),
  existing: [],
  suppliersOnFile: [known],
});
const qboSealed = await sealPayload(qboDraft.proposal?.payload as ProposalPayload);
const held = await runLedgerPostingJob({
  status: "approved",
  approvedBy: "accountant-1",
  approvedAt: "2026-10-11T12:00:00.000Z",
  approverRole: "accountant",
  canonicalPayload: qboSealed.canonicalPayload,
  payloadSha256: qboSealed.payloadSha256,
  approvalPayloadSha256: qboSealed.payloadSha256,
  cleanApprovedDrafts: 3,
  finalUnlockAfter: 3,
});
assert(held.ok && held.action === "held" && held.ledgerCalled === false, "an approved QuickBooks draft stays held in Milōn");

const tooSoon = await runLedgerPostingJob({ ...approvedInput, cleanApprovedDrafts: 2 });
assert(!tooSoon.ok && tooSoon.reason === "final_locked", "final is refused before N clean drafts");
const unapproved = await runLedgerPostingJob({ ...approvedInput, status: "proposed", approvedBy: null, approvedAt: null });
assert(!unapproved.ok && unapproved.reason === "not_approved", "a proposal cannot be posted");
const nameless = await runLedgerPostingJob({ ...approvedInput, approvedBy: null });
assert(!nameless.ok && nameless.reason === "missing_human_approval", "posting requires a named human");

assert(!extractionMimeSupported("image/heic"), "HEIC is stored but not sent to the model");
assert(extractionMimeSupported("application/pdf"), "PDF extraction is supported");
assert(extractionMimeSupported("image/jpeg"), "JPEG extraction is supported");

assert(migration.includes("source documents read by client access"), "client members can read source documents");
assert(migration.includes("source documents insert by owner or firm"), "owners and firm members can upload rows");
assert(migration.includes("source docs read by client access"), "client members can read the bucket");
assert(migration.includes("source docs insert by owner or firm"), "owners and firm members can upload objects");
assert(/'source-docs'[\s\S]{0,80}false/.test(migration), "the source-docs bucket is private");
assert(migration.includes("final_unlock_after_clean_drafts integer NOT NULL DEFAULT 3"), "N defaults to 3");
assert(migration.includes("source_retention_years integer NOT NULL DEFAULT 5"), "retention is 5 years");
assert(migration.includes("approval_payload_sha256 = payload_sha256"), "an approval is locked to the payload hash");
assert(migration.includes("proposal_must_start_proposed"), "a proposal cannot arrive already approved");
assert(migration.includes("approval_requires_human"), "approval requires a logged-in human");
assert(migration.includes("WHEN c.firm_id IS NOT NULL THEN 'accountant'"), "the approver is the accountant when there is a firm");
assert(migration.includes("ELSE 'owner'"), "otherwise the approver is the owner");
const approverFn = migration.slice(
  migration.indexOf("CREATE OR REPLACE FUNCTION public.ledger_post_approver_role"),
  migration.indexOf("CREATE OR REPLACE FUNCTION public.ledger_post_caller_may_decide"),
);
const decideFn = migration.slice(
  migration.indexOf("CREATE OR REPLACE FUNCTION public.ledger_post_caller_may_decide"),
  migration.indexOf("-- ---------------------------------------------------------------------------\n-- Tables"),
);
assert(!approverFn.includes("has_client_access"), "approver role does not filter on client access");
assert(decideFn.includes("is_firm_member(p_user_id, c.firm_id)"), "an accountant must be in the client's firm");
assert(decideFn.includes("has_client_access(p_user_id, c.id)"), "an accountant must have client access");
assert(
  migration.includes("REVOKE EXECUTE ON FUNCTION public.ledger_post_caller_may_decide(uuid, uuid) FROM PUBLIC, anon, authenticated"),
  "authenticated cannot execute ledger_post_caller_may_decide",
);
assert(
  migration.includes("REVOKE EXECUTE ON FUNCTION public.supplier_final_unlocked(uuid, text) FROM PUBLIC, anon, authenticated"),
  "authenticated cannot execute supplier_final_unlocked",
);
assert(migration.includes("signed_off_refused"), "sign-off wording is refused in the database");
assert(migration.includes("held_in_milon"), "QuickBooks and Sage drafts are held in Milōn");
assert(migration.includes("abs(p.issued_on - p_issued_on) <= 3"), "the semantic duplicate window is 3 days");
assert(migration.includes("abs(p.amount - p_amount) <= 0.01"), "the semantic duplicate amount tolerance is one cent");
assert(migration.includes("supplier_vat_number_missing_or_invalid") === false, "the VAT default reason lives in the app, not as a SQL string");
assert(migration.includes("vat_claimable = false"), "VAT claimable defaults off unless the number is valid");
assert(migration.includes("supplier_vat_number IS NOT NULL"), "claimable VAT requires a supplier VAT number");
const supplierTrustAt = migration.indexOf("CREATE TABLE IF NOT EXISTS public.supplier_trust");
const unlockedAt = migration.indexOf("CREATE OR REPLACE FUNCTION public.supplier_final_unlocked");
assert(supplierTrustAt !== -1 && unlockedAt > supplierTrustAt, "supplier_final_unlocked is created after supplier_trust");
assert(!/check_function_bodies\s*=\s*off/i.test(migration), "function body checks stay on");
assert(migration.includes("NEW.received_at := now()"), "a signed-in insert cannot backdate received_at");
assert(migration.includes("NEW.status := 'received'"), "a signed-in insert cannot choose a status");
assert(migration.includes("supplier_bank_details_locked"), "a document cannot overwrite supplier bank details");

assert(edge.includes("claudeRequestFields"), "extraction uses the shared Claude request helper");
assert(edge.includes("CLAUDE_MODEL"), "extraction uses the Sonnet 5.5 model helper");
assert(edge.includes('status: "proposed"'), "the edge function writes a proposal, not a posting");
assert(!edge.includes("approved_by:"), "the edge function does not approve");
assert(!/from\s+["'][^"']*(xero|qbo|sage)/i.test(edge), "extraction does not import a ledger client");
assert(!/from\s+["'][^"']*(xero|qbo|sage)/i.test(jobSrc), "the posting job does not import a ledger client");
assert(!jobSrc.includes("ledgerCalled: true"), "the posting job cannot claim it called a ledger");
assert(prompt.includes("SOURCE_DOC_PROMPT_VERSION"), "the prompt uses the shared version");
assert(prompt.includes("untrusted data"), "document text is treated as data");
assert(prompt.includes("is_statement"), "a statement is distinguished from a bill");
assert(!refusesSignOffWording(prompt), "the extraction prompt does not call approval a sign-off");

assert(sqlTest.includes("SET LOCAL ROLE authenticated"), "the SQL test switches to the authenticated role");
assert(sqlTest.includes("approver_forbidden"), "the SQL test covers the approver rule");
assert(sqlTest.includes("payload_hash_mismatch"), "the SQL test covers the hash lock");
assert(sqlTest.includes("source_doc_can_upload"), "the SQL test covers upload rights");
assert(sqlTest.includes("vat_claimable"), "the SQL test covers the VAT default");
assert(sqlTest.includes("without client access"), "the SQL test refuses a firm member with no client access");
assert(sqlTest.includes("42501"), "the SQL test expects privilege error 42501");
assert(sqlTest.includes("has_function_privilege"), "the SQL test checks helper execute privileges");
assert(sqlTest.includes("2000-01-01"), "the SQL test covers a backdated received_at");
assert(sqlTest.includes("direct status insert"), "the SQL test covers a direct status insert");
assert(sqlTest.includes("protect_delete"), "the SQL test records why storage rows are left in place");
assert(!/DELETE\s+FROM\s+storage\.objects/i.test(sqlTest), "the SQL test does not delete storage.objects");

assert(sourceDocumentHooks.upload.bucket === "source-docs", "upload uses the source-docs bucket");
assert(sourceDocumentHooks.upload.registerRpc === "register_source_document", "upload registers the file through the RPC");
assert(sourceDocumentHooks.proposalsList.proposalsTable === "ledger_post_proposals", "the proposals list reads ledger_post_proposals");
assert(sourceDocumentHooks.proposalsList.filterColumn === "client_id", "the proposals list is filtered by client");
assert(sourceDocumentHooks.decide.rpc === "decide_ledger_post_proposal", "approve and reject use the decide RPC");

console.log("source-documents-ledger ok");
