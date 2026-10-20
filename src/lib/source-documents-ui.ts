/**
 * Source-document UI rules. Pure: no Supabase, no posting.
 * Approve is the only decision word.
 */
import { refusesSignOffWording } from "@/lib/agent-draft-decision";
import { formatCalendarDay, formatDateTime, marketForClient } from "@/lib/market";
import {
  DEFAULT_FINAL_UNLOCK_AFTER_CLEAN_DRAFTS,
  SOURCE_DOCS_MAX_BYTES,
  sourceDocumentHooks,
} from "@/lib/source-document-hooks";

export const SOURCE_DOC_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LedgerChoice = "xero" | "qbo" | "sage";
export type PostingModeChoice = "draft" | "final";
export type SourceDocSurface = "upload" | "review";

export type SourceDocViewer = {
  clientHasFirm: boolean;
  isOwner: boolean;
  isFirmMemberWithAccess: boolean;
  userId?: string | null;
  name?: string | null;
};

export type SourceDocumentRow = {
  id: string;
  storage_path: string;
  status: string;
  received_at?: string | null;
  mime?: string | null;
};

export type SourceExtractionRow = {
  document_id: string;
  doc_type?: string | null;
  flags?: unknown;
  created_at?: string | null;
};

export type SourceProposalRow = {
  id: string;
  document_id: string;
  target_ledger: string;
  doc_type?: string | null;
  mode?: string | null;
  draft_holding?: string | null;
  status: string;
  supplier_key?: string | null;
  supplier_display_name?: string | null;
  document_number?: string | null;
  amount?: number | string | null;
  issued_on?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  approver_role?: string | null;
  rejection_note?: string | null;
  payload?: unknown;
  flags?: unknown;
  created_at?: string | null;
};

export type SupplierTrustRow = {
  supplier_key: string;
  clean_approved_drafts?: number | null;
};

const LEDGER_LABEL: Record<LedgerChoice, string> = {
  xero: "Xero",
  qbo: "QuickBooks",
  sage: "Sage",
};

export function ledgerLabel(ledger: string): string {
  if (ledger === "xero" || ledger === "qbo" || ledger === "sage") return LEDGER_LABEL[ledger];
  return ledger;
}

/** Object name: [A-Za-z0-9._-] only, no folders. */
export function sanitizeSourceObjectName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-+\./g, ".")
    .replace(/\.+/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "");
  const sliced = cleaned.slice(0, 200);
  return sliced || "document";
}

export function suffixSourceObjectName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const suffix = `-${n}`;
  const room = 200 - suffix.length - ext.length;
  return `${stem.slice(0, Math.max(1, room))}${suffix}${ext}`.slice(0, 200);
}

/** `{client_id}/{object_name}` with a lowercase client id and no extra folder. */
export function sourceObjectPath(clientId: string, fileName: string): string {
  const id = clientId.trim().toLowerCase();
  if (!UUID.test(id)) throw new Error("client_invalid");
  const name = sanitizeSourceObjectName(fileName);
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(name) || name.includes("/")) {
    throw new Error("storage_path_invalid");
  }
  return `${id}/${name}`;
}

export function sourceFileName(storagePath: string): string {
  const name = storagePath.split("/").pop() ?? "";
  return name || "Document";
}

export function sourceDocumentMime(file: { name: string; type?: string | null }): string | null {
  const raw = (file.type ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  const normalized = raw === "image/jpg" ? "image/jpeg" : raw;
  if (ALLOWED_MIME.has(normalized)) return normalized;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? null;
}

export function sourceDocumentSizeError(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return "This file is empty.";
  if (bytes > SOURCE_DOCS_MAX_BYTES) return "This file is over 20 MB.";
  return null;
}

export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Firm member with client access when the client has a firm. Otherwise the owner. */
export function mayApproveLedgerPost(viewer: SourceDocViewer): boolean {
  if (viewer.clientHasFirm) return viewer.isFirmMemberWithAccess;
  return viewer.isOwner;
}

export function cleanApprovalProgress(
  count: number | null | undefined,
  unlockAfter = DEFAULT_FINAL_UNLOCK_AFTER_CLEAN_DRAFTS,
): string {
  const safe = Number.isFinite(Number(count)) && Number(count) > 0 ? Math.floor(Number(count)) : 0;
  const need = unlockAfter >= 1 ? unlockAfter : DEFAULT_FINAL_UNLOCK_AFTER_CLEAN_DRAFTS;
  return `${safe} of ${need} clean approvals`;
}

export function finalPostingLocked(input: {
  cleanApprovedDrafts: number | null | undefined;
  finalLocked?: boolean | null;
  unlockAfter?: number;
}): boolean {
  const need = input.unlockAfter ?? DEFAULT_FINAL_UNLOCK_AFTER_CLEAN_DRAFTS;
  const count =
    Number.isFinite(Number(input.cleanApprovedDrafts)) && Number(input.cleanApprovedDrafts) > 0
      ? Math.floor(Number(input.cleanApprovedDrafts))
      : 0;
  if (input.finalLocked === true) return true;
  return count < need;
}

export function finalLockLine(count: number | null | undefined, locked: boolean): string {
  const progress = cleanApprovalProgress(count);
  return locked ? `Final stays locked · ${progress}` : progress;
}

/** Exact words for QuickBooks and Sage drafts held in Milōn. */
export function holdingLabel(draftHolding: string | null | undefined): "Held in Milōn" | null {
  return draftHolding === "held_in_milon" ? "Held in Milōn" : null;
}

export function formatIssuedOn(isoDate: string, market: { locale?: string | null }): string {
  const label = formatCalendarDay(isoDate, market);
  return label === "—" ? isoDate : label;
}

export function formatDecisionWhen(
  iso: string,
  timeZone: string,
  market: { locale?: string | null; timezone?: string },
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const zone = timeZone || market.timezone || "UTC";
  return formatDateTime(date, { locale: market.locale, timezone: zone });
}

export function approvalSentence(name: string, when: string): string {
  return `Approved by ${name} on ${when}.`;
}

export function ledgerDecisionMessage(error: string, approverRole?: string | null): string {
  const code = error.toLowerCase();
  if (code.includes("signed_off_refused")) {
    return "Choose Approve or Reject. This step is an approval.";
  }
  if (code.includes("not_proposed")) {
    return "This proposal is no longer waiting for a decision.";
  }
  if (code.includes("approver_forbidden")) {
    if (approverRole === "accountant")
      return "A firm member with access to this client approves it.";
    if (approverRole === "owner") return "The owner approves this. There is no firm on the file.";
    return "You can't approve this. A firm member with access approves when the client has a firm. Otherwise the owner does.";
  }
  return "That didn't save. Try again.";
}

export function noteRefused(note: string | null | undefined): boolean {
  return refusesSignOffWording(note);
}

export function extractSourceDocumentBody(input: {
  documentId: string;
  targetLedger: LedgerChoice;
  requestedMode: PostingModeChoice;
}): { document_id: string; target_ledger: LedgerChoice; requested_mode: PostingModeChoice } {
  return {
    document_id: input.documentId,
    target_ledger: input.targetLedger,
    requested_mode: input.requestedMode,
  };
}

export const SOURCE_DOC_REGISTER_RPC = sourceDocumentHooks.upload.registerRpc;
export const SOURCE_DOC_DECIDE_RPC = sourceDocumentHooks.decide.rpc;
export const SOURCE_DOC_EXTRACT_FN = sourceDocumentHooks.extract.functionName;

type PayloadLine = { description?: unknown; amount?: unknown };
type PayloadContact = { name?: unknown; vat_number?: unknown; create_new?: unknown };
type Payload = {
  contact?: PayloadContact;
  invoice_number?: unknown;
  issued_on?: unknown;
  currency?: unknown;
  amounts_are?: unknown;
  lines?: unknown;
  tax_total?: unknown;
  total?: unknown;
  mode?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function payloadOf(value: unknown): Payload {
  return record(value) as Payload;
}

function flagNotes(flags: Record<string, unknown>): string[] {
  const notes: string[] = [];
  if (flags.bank_details_changed === true)
    notes.push("Bank details differ from the supplier on file.");
  if (flags.duplicate_file === true || flags.duplicate_document === true)
    notes.push("This looks like a duplicate.");
  if (flags.not_valid_tax_invoice === true)
    notes.push("Not a valid tax invoice, so VAT is not claimable.");
  if (flags.low_confidence === true) notes.push("Check the amounts before you approve.");
  if (flags.arithmetic_mismatch === true) notes.push("The lines do not add up to the total.");
  if (flags.statement_not_a_bill === true) notes.push("This is a statement, not a bill.");
  return notes;
}

function amountsLabel(value: string): string {
  if (value === "inclusive") return "Inclusive";
  if (value === "exclusive") return "Exclusive";
  if (value === "no_tax") return "No tax";
  return value;
}

function latestByDocument<T extends { document_id: string; created_at?: string | null }>(
  rows: T[],
): Map<string, T> {
  const map = new Map<string, T>();
  const sorted = [...rows].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );
  for (const row of sorted) map.set(row.document_id, row);
  return map;
}

export type SourceDocCardAction =
  | {
      kind: "extract";
      documentId: string;
      ledger: LedgerChoice | null;
      ledgerOptions: LedgerChoice[];
      button: string;
      finalCopy: string;
    }
  | { kind: "approve"; proposalId: string; button: "Approve" }
  | { kind: "quiet" };

export type SourceDocCard = {
  id: string;
  fileName: string;
  answer: string;
  detail: string | null;
  holding: "Held in Milōn" | null;
  progress: string | null;
  rows: { label: string; value: string }[];
  lines: { description: string; amount: string }[];
  notes: string[];
  approval: string | null;
  action: SourceDocCardAction;
};

export type SourceDocumentsModel = {
  heading: "Documents";
  lede: string;
  showUpload: boolean;
  duplicate: boolean;
  empty: string | null;
  cards: SourceDocCard[];
  primaryId: string | null;
};

function approverName(
  userId: string | null | undefined,
  names: Record<string, string>,
  viewer: SourceDocViewer,
): string {
  const id = userId ?? "";
  const named = (id && names[id]) || (id && id === viewer.userId ? viewer.name : "") || "";
  return named.trim() || "a named approver";
}

function proposalRows(
  proposal: SourceProposalRow,
  market: { locale?: string | null },
): { label: string; value: string }[] {
  const payload = payloadOf(proposal.payload);
  const contact = payload.contact ?? {};
  const supplier = text(contact.name) || text(proposal.supplier_display_name) || "Supplier";
  const created = contact.create_new === true ? `${supplier} (new)` : supplier;
  const vat = text(contact.vat_number);
  const invoice = text(payload.invoice_number) || text(proposal.document_number) || "—";
  const issued = text(payload.issued_on) || text(proposal.issued_on);
  const currency = text(payload.currency) || "ZAR";
  const total = text(payload.total) || (proposal.amount == null ? "" : String(proposal.amount));
  const tax = text(payload.tax_total);
  const mode = proposal.mode === "final" || payload.mode === "final" ? "Final" : "Draft";
  const rows = [
    { label: "Supplier", value: vat ? `${created} · ${vat}` : created },
    { label: "Invoice", value: invoice },
    { label: "Date", value: issued ? formatIssuedOn(issued, market) : "—" },
    { label: "Ledger", value: ledgerLabel(proposal.target_ledger) },
    { label: "Mode", value: mode },
    { label: "Amounts", value: amountsLabel(text(payload.amounts_are)) || "—" },
  ];
  if (tax) rows.push({ label: "Tax", value: `${currency} ${tax}` });
  if (total) rows.push({ label: "Total", value: `${currency} ${total}` });
  return rows;
}

function proposalLines(proposal: SourceProposalRow): { description: string; amount: string }[] {
  const lines = payloadOf(proposal.payload).lines;
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => {
      const row = line as PayloadLine;
      const description = text(row.description);
      const amount = text(row.amount);
      if (!description && !amount) return null;
      return { description: description || "Line", amount };
    })
    .filter((line): line is { description: string; amount: string } => line != null);
}

function extractButton(ledger: LedgerChoice): string {
  return `Propose a ${ledgerLabel(ledger)} draft`;
}

export function buildSourceDocumentsModel(input: {
  surface: SourceDocSurface;
  viewer: SourceDocViewer;
  documents: SourceDocumentRow[];
  extractions: SourceExtractionRow[];
  proposals: SourceProposalRow[];
  trust: SupplierTrustRow[];
  names?: Record<string, string>;
  connectedLedgers?: LedgerChoice[];
  ledgerChoice?: Partial<Record<string, LedgerChoice>>;
  duplicate?: boolean;
  timeZone?: string;
  market?: { locale?: string | null; timezone?: string };
}): SourceDocumentsModel {
  const canApprove = mayApproveLedgerPost(input.viewer);
  const names = input.names ?? {};
  const market = input.market ?? marketForClient(null);
  const timeZone = input.market?.timezone ?? input.timeZone ?? "UTC";
  const connected = input.connectedLedgers ?? [];
  const options: LedgerChoice[] = connected.length ? connected : ["xero", "qbo", "sage"];
  const extractions = latestByDocument(input.extractions);
  const proposals = latestByDocument(input.proposals);
  const trustCount = new Map<string, number>();
  for (const row of input.trust) {
    trustCount.set(row.supplier_key, Number(row.clean_approved_drafts ?? 0));
  }

  const documents = [...input.documents].sort((a, b) =>
    String(b.received_at ?? "").localeCompare(String(a.received_at ?? "")),
  );

  const cards: SourceDocCard[] = documents.map((document) => {
    const proposal = proposals.get(document.id) ?? null;
    const extraction = extractions.get(document.id) ?? null;
    const fileName = sourceFileName(document.storage_path);
    const flags = record(proposal?.flags ?? extraction?.flags);

    if (proposal) {
      const count = trustCount.get(proposal.supplier_key ?? "") ?? 0;
      const locked = finalPostingLocked({
        cleanApprovedDrafts: count,
        finalLocked:
          flags.final_locked === true ? true : flags.final_locked === false ? false : null,
      });
      const holding = holdingLabel(proposal.draft_holding);
      const ledger = ledgerLabel(proposal.target_ledger);
      const approval =
        proposal.approved_by && proposal.approved_at
          ? approvalSentence(
              approverName(proposal.approved_by, names, input.viewer),
              formatDecisionWhen(proposal.approved_at, timeZone, market),
            )
          : null;
      const base = {
        id: document.id,
        fileName,
        holding,
        progress: finalLockLine(count, locked),
        rows: proposalRows(proposal, market),
        lines: proposalLines(proposal),
        notes: flagNotes(flags),
        approval,
      };

      if (proposal.status === "approved" || proposal.status === "posted") {
        return {
          ...base,
          answer: approval ?? "Approved by a named approver.",
          detail: "Nothing posts to the ledger without this approval.",
          action: { kind: "quiet" },
        };
      }
      if (proposal.status === "rejected") {
        return {
          ...base,
          answer: "Rejected.",
          detail: text(proposal.rejection_note) || "This proposal will not post.",
          progress: null,
          action: { kind: "quiet" },
        };
      }
      if (proposal.status === "failed") {
        return {
          ...base,
          answer: approval ? `${approval} Posting did not complete.` : "Posting did not complete.",
          detail: "The approval still stands. Nothing posted.",
          action: { kind: "quiet" },
        };
      }
      if (proposal.status === "proposed" && canApprove) {
        return {
          ...base,
          answer: `Approve this ${ledger} draft.`,
          detail: holding
            ? "Nothing posts until you approve."
            : `Nothing posts to ${ledger} until you approve.`,
          action: { kind: "approve", proposalId: proposal.id, button: "Approve" },
        };
      }
      return {
        ...base,
        answer: input.viewer.clientHasFirm
          ? "Waiting for your accountant."
          : "Waiting for the owner.",
        detail: "Nothing posts until they approve.",
        action: { kind: "quiet" },
      };
    }

    if (document.status === "duplicate") {
      return {
        id: document.id,
        fileName,
        answer: "Duplicate",
        detail: "This file is already saved.",
        holding: null,
        progress: null,
        rows: [],
        lines: [],
        notes: [],
        approval: null,
        action: { kind: "quiet" },
      };
    }

    const statement =
      extraction?.doc_type === "bank_statement" || flags.statement_not_a_bill === true;
    if (
      statement ||
      (document.status === "extracted" &&
        extraction?.doc_type !== "bill" &&
        extraction?.doc_type !== "receipt")
    ) {
      const kept =
        extraction?.doc_type === "bank_statement" || statement
          ? "This bank statement stays on file. It is not posted as a bill."
          : "This file stays on file. There is nothing to post.";
      return {
        id: document.id,
        fileName,
        answer: kept,
        detail: null,
        holding: null,
        progress: null,
        rows: [],
        lines: [],
        notes: [],
        approval: null,
        action: { kind: "quiet" },
      };
    }

    if (document.status === "extracting") {
      return {
        id: document.id,
        fileName,
        answer: "Reading this document.",
        detail: null,
        holding: null,
        progress: null,
        rows: [],
        lines: [],
        notes: [],
        approval: null,
        action: { kind: "quiet" },
      };
    }

    if (input.surface === "review") {
      return {
        id: document.id,
        fileName,
        answer:
          document.status === "extract_failed"
            ? "This file could not be read."
            : "Waiting for a proposal.",
        detail: "The owner uploads invoices, bills, receipts, and bank statements.",
        holding: null,
        progress: null,
        rows: [],
        lines: [],
        notes: [],
        approval: null,
        action: { kind: "quiet" },
      };
    }

    const chosen = input.ledgerChoice?.[document.id];
    const ledger: LedgerChoice | null =
      chosen && options.includes(chosen) ? chosen : options.length === 1 ? options[0]! : null;
    const retry = document.status === "extract_failed";
    return {
      id: document.id,
      fileName,
      answer: retry
        ? "This file could not be read."
        : ledger
          ? extractButton(ledger)
          : "Choose the ledger, then propose a draft.",
      detail: retry
        ? "Try again, or upload a clearer PDF or photo."
        : "Draft is the next step. Nothing posts until a person approves it.",
      holding: null,
      progress: null,
      rows: [],
      lines: [],
      notes: [],
      approval: null,
      action: {
        kind: "extract",
        documentId: document.id,
        ledger,
        ledgerOptions: options.length === 1 ? [] : options,
        button: retry ? "Try again" : ledger ? extractButton(ledger) : "Propose a draft",
        finalCopy: "Final stays locked until this supplier has 3 clean approvals.",
      },
    };
  });

  const waiting = cards.filter((card) => card.action.kind === "approve").length;
  const lede = pageLede(input.surface, canApprove, waiting, input.viewer.clientHasFirm);
  const primary =
    cards.find((card) => card.action.kind === "approve") ??
    cards.find((card) => card.action.kind === "extract") ??
    null;

  return {
    heading: "Documents",
    lede,
    showUpload: input.surface === "upload",
    duplicate: input.duplicate === true,
    empty:
      cards.length === 0
        ? input.surface === "upload"
          ? "Upload an invoice, bill, receipt, or bank statement."
          : "No document is waiting for approval."
        : null,
    cards,
    primaryId: primary?.id ?? (input.surface === "upload" && cards.length === 0 ? "upload" : null),
  };
}

function pageLede(
  surface: SourceDocSurface,
  canApprove: boolean,
  waiting: number,
  clientHasFirm: boolean,
): string {
  if (surface === "upload") {
    return canApprove
      ? "Upload an invoice, bill, receipt, or bank statement. You approve it before anything posts."
      : "Upload an invoice, bill, receipt, or bank statement. Your accountant approves it before anything posts.";
  }
  if (waiting === 1 && canApprove) return "1 document is waiting for your approval.";
  if (waiting > 1 && canApprove) return `${waiting} documents are waiting for your approval.`;
  if (waiting > 0) {
    return clientHasFirm
      ? "Waiting for your accountant to approve."
      : "Waiting for the owner to approve.";
  }
  return "No document is waiting for approval.";
}
