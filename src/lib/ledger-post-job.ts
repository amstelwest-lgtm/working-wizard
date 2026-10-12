/**
 * Posting job interface. A later worker calls this before any ledger write.
 * This stub never calls Xero, QuickBooks, or Sage. It only checks that a named
 * human approved this exact payload.
 */
import { refusesSignOffWording } from "./agent-draft-decision.ts";
import {
  canonicalJson,
  expectedDraftHolding,
  sha256Hex,
  type DraftHolding,
  type LedgerTarget,
} from "./source-document-ledger.ts";

export const LEDGER_POSTING_JOB = "ledger-post-job";

export type PostingRefusal =
  | "not_approved"
  | "missing_human_approval"
  | "payload_hash_mismatch"
  | "payload_invalid"
  | "signed_off_refused"
  | "final_locked"
  | "statement_not_a_bill";

export type PostingJobResult =
  | { ok: true; ledgerCalled: false; action: "ready" | "held" }
  | { ok: false; ledgerCalled: false; action: "refused"; reason: PostingRefusal };

export type LedgerPostingJobInput = {
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  approverRole: string | null;
  canonicalPayload: string;
  payloadSha256: string;
  approvalPayloadSha256: string | null;
  /** Clean approved drafts already counted for this supplier. */
  cleanApprovedDrafts: number;
  /** From ledger_posting_config.final_unlock_after_clean_drafts. Default 3. */
  finalUnlockAfter: number;
};

type PayloadGuards = {
  low_confidence?: boolean;
  arithmetic_mismatch?: boolean;
  duplicate_file?: boolean;
  duplicate_document?: boolean;
  new_supplier?: boolean;
  bank_details_changed?: boolean;
  final_locked?: boolean;
};

function refused(reason: PostingRefusal): PostingJobResult {
  return { ok: false, ledgerCalled: false, action: "refused", reason };
}

function guardsBlockFinal(guards: PayloadGuards): boolean {
  return (
    guards.low_confidence === true ||
    guards.arithmetic_mismatch === true ||
    guards.duplicate_file === true ||
    guards.duplicate_document === true ||
    guards.new_supplier === true ||
    guards.bank_details_changed === true ||
    guards.final_locked === true
  );
}

/**
 * Returns ready when a later worker may send this payload.
 * Returns held when QuickBooks or Sage draft mode stays in Milōn.
 * Returns refused when the human approval does not cover this payload.
 * ledgerCalled is always false.
 */
export async function runLedgerPostingJob(input: LedgerPostingJobInput): Promise<PostingJobResult> {
  if (input.status !== "approved") return refused("not_approved");
  if (!input.approvedBy || !input.approvedAt) return refused("missing_human_approval");
  if (input.approverRole !== "accountant" && input.approverRole !== "owner") {
    return refused("missing_human_approval");
  }
  if (!input.approvalPayloadSha256 || input.approvalPayloadSha256 !== input.payloadSha256) {
    return refused("payload_hash_mismatch");
  }

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(input.canonicalPayload) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return refused("payload_invalid");
    parsed = value as Record<string, unknown>;
    if (canonicalJson(parsed) !== input.canonicalPayload) return refused("payload_hash_mismatch");
  } catch {
    return refused("payload_invalid");
  }

  const hash = await sha256Hex(input.canonicalPayload);
  if (hash !== input.payloadSha256 || hash !== input.approvalPayloadSha256) {
    return refused("payload_hash_mismatch");
  }

  const ledger = parsed.ledger;
  const mode = parsed.mode;
  const holding = parsed.draft_holding;
  const docType = parsed.doc_type;
  const label = typeof parsed.draft_label === "string" ? parsed.draft_label : "";
  if (ledger !== "xero" && ledger !== "qbo" && ledger !== "sage") return refused("payload_invalid");
  if (mode !== "draft" && mode !== "final") return refused("payload_invalid");
  if (holding !== "ledger_draft" && holding !== "held_in_milon") return refused("payload_invalid");
  if (expectedDraftHolding(ledger as LedgerTarget) !== (holding as DraftHolding)) return refused("payload_invalid");
  if (refusesSignOffWording(label) || refusesSignOffWording(typeof mode === "string" ? mode : "")) {
    return refused("signed_off_refused");
  }
  if (docType === "bank_statement") return refused("statement_not_a_bill");

  const guards = parsed.guards;
  if (!guards || typeof guards !== "object" || Array.isArray(guards)) return refused("payload_invalid");

  if (mode === "final") {
    const unlockAfter = input.finalUnlockAfter;
    const unlocked = unlockAfter >= 1 && input.cleanApprovedDrafts >= unlockAfter;
    if (!unlocked || guardsBlockFinal(guards as PayloadGuards)) return refused("final_locked");
    return { ok: true, ledgerCalled: false, action: "ready" };
  }

  if (holding === "held_in_milon") return { ok: true, ledgerCalled: false, action: "held" };
  return { ok: true, ledgerCalled: false, action: "ready" };
}
