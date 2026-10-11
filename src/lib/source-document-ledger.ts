/**
 * Source-document extraction, VAT, duplicate checks, and the approval hash.
 * The database trigger is what stores an approval. This module is the rules
 * the edge function and the posting job share. An agent can only propose.
 */
import { refusesSignOffWording } from "./agent-draft-decision.ts";
import {
  DEFAULT_FINAL_UNLOCK_AFTER_CLEAN_DRAFTS,
  SOURCE_RETENTION_YEARS,
} from "./source-document-hooks.ts";

export {
  DEFAULT_FINAL_UNLOCK_AFTER_CLEAN_DRAFTS,
  SOURCE_DOCS_BUCKET,
  SOURCE_DOCS_MAX_BYTES,
  SOURCE_RETENTION_YEARS,
  sourceDocumentHooks,
} from "./source-document-hooks.ts";

export const SOURCE_DOC_PROMPT_VERSION = "source-doc-v1";
export const FINAL_FIELD_CONFIDENCE = 0.95;
export const SEMANTIC_DATE_WINDOW_DAYS = 3;
export const AMOUNT_TOLERANCE = 0.01;
export const SA_VAT_RATE = 0.15;
export const FULL_TAX_INVOICE_RANDS = 5000;
export const TILL_SLIP_RANDS = 50;

export const REQUIRED_CONFIDENCE_FIELDS = ["total", "tax", "date", "invoice_number", "supplier_name"] as const;

/** A clean draft has none of these. A new supplier can still be clean. */
export const CLEAN_BLOCKING_FLAGS = [
  "low_confidence",
  "arithmetic_mismatch",
  "duplicate_file",
  "duplicate_document",
  "bank_details_changed",
] as const;

export type LedgerTarget = "xero" | "qbo" | "sage";
export type SourceDocType = "bill" | "receipt" | "sales_invoice" | "credit_note" | "bank_statement" | "other";
export type ProposalDocType = "bill" | "receipt";
export type DraftHolding = "ledger_draft" | "held_in_milon";
export type AmountsAre = "inclusive" | "exclusive" | "no_tax";
export type TaxTreatment = "claimable" | "non_claimable";
export type PostingMode = "draft" | "final";
export type ApproverRole = "accountant" | "owner";

export type ConfidenceField = {
  value: string | number | boolean | null;
  confidence: number;
  page: number | null;
};

export type ProposalFlags = {
  low_confidence: boolean;
  low_confidence_fields: string[];
  arithmetic_mismatch: boolean;
  duplicate_file: boolean;
  duplicate_document: boolean;
  new_supplier: boolean;
  bank_details_changed: boolean;
  bank_details_unverified: boolean;
  vat_claimable: boolean;
  not_valid_tax_invoice: boolean;
  final_locked: boolean;
  statement_not_a_bill: boolean;
  vat_reason: string;
};

export type ProposalLine = {
  description: string;
  amount: string;
  tax_treatment: TaxTreatment;
};

export type ProposalPayload = {
  ledger: LedgerTarget;
  doc_type: ProposalDocType;
  mode: PostingMode;
  draft_holding: DraftHolding;
  draft_label: string;
  contact: {
    name: string;
    vat_number: string | null;
    create_new: boolean;
  };
  invoice_number: string;
  issued_on: string;
  currency: string;
  amounts_are: AmountsAre;
  lines: ProposalLine[];
  tax_total: string;
  total: string;
  vat_claimable: boolean;
  tax_treatment: TaxTreatment;
  guards: {
    low_confidence: boolean;
    arithmetic_mismatch: boolean;
    duplicate_file: boolean;
    duplicate_document: boolean;
    new_supplier: boolean;
    bank_details_changed: boolean;
    bank_details_unverified: boolean;
    final_locked: boolean;
    vat_claimable: boolean;
  };
  low_confidence_fields: string[];
};

export type TotalsCheck = {
  ok: boolean;
  lineSum: number;
  tax: number;
  total: number;
  expected: number;
  difference: number;
  vatRateOk: boolean;
};

export type DedupeCandidate = {
  documentId: string;
  sha256: string;
  supplierKey: string;
  documentNumber: string;
  amount: number;
  issuedOn: string;
  status?: string | null;
};

export type SupplierOnFile = {
  supplierKey: string;
  vatNumber: string | null;
  bankFingerprint: string | null;
  cleanApprovedDrafts?: number;
};

export type ParsedLine = {
  description: string;
  quantity: number | null;
  amount: number;
  tax: number | null;
  confidence: number;
};

export type ParsedSourceDocument = {
  docType: SourceDocType;
  isStatement: boolean;
  amountsAre: AmountsAre;
  currency: string;
  fields: Record<string, ConfidenceField>;
  lines: ParsedLine[];
  supplierName: string | null;
  supplierVatNumber: string | null;
  invoiceNumber: string | null;
  issuedOn: string | null;
  total: number | null;
  taxTotal: number | null;
  taxInvoiceWording: boolean;
  recipientName: string | null;
  bankFingerprint: string | null;
  bankDetailsPresent: boolean;
};

export type ExtractionAssessment = {
  docType: SourceDocType;
  supplierName: string | null;
  supplierVatNumber: string | null;
  supplierKey: string;
  fields: Record<string, ConfidenceField>;
  lineItems: Array<{
    description: string;
    quantity: number | null;
    amount: string;
    tax: string | null;
    confidence: number;
  }>;
  totalsCheck: TotalsCheck;
  arithmeticOk: boolean;
  vatClaimable: boolean;
  taxTreatment: TaxTreatment;
  flags: ProposalFlags;
  proposal: null | {
    payload: ProposalPayload;
    flags: ProposalFlags;
    supplierKey: string;
    supplierDisplayName: string;
    supplierVatNumber: string | null;
    documentNumber: string;
    amount: number;
    issuedOn: string;
    clean: boolean;
  };
  skipReason: "bank_statement" | "unsupported_doc_type" | null;
};

const EXTRACTABLE_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
function isPostableDocType(value: SourceDocType): value is ProposalDocType {
  return value === "bill" || value === "receipt";
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function moneyString(value: number): string {
  if (!Number.isFinite(value)) throw new Error("amount_invalid");
  return round2(value).toFixed(2);
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("payload_number_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("payload_type_invalid");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sealPayload(payload: ProposalPayload): Promise<{ canonicalPayload: string; payloadSha256: string }> {
  const canonicalPayload = canonicalJson(payload);
  const payloadSha256 = await sha256Hex(canonicalPayload);
  return { canonicalPayload, payloadSha256 };
}

export function retentionUntil(uploadedAt: Date, years = SOURCE_RETENTION_YEARS): Date {
  const copy = new Date(uploadedAt.getTime());
  const month = copy.getUTCMonth();
  copy.setUTCFullYear(copy.getUTCFullYear() + years);
  if (copy.getUTCMonth() !== month) copy.setUTCDate(0);
  return copy;
}

export function normaliseMime(mime: string): string {
  const value = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (value === "image/jpg") return "image/jpeg";
  return value;
}

export function extractionMimeSupported(mime: string): boolean {
  return EXTRACTABLE_MIME.has(normaliseMime(mime));
}

export function normaliseConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || number < 0) return 0;
  if (number > 1 && number <= 100) return Math.round((number / 100) * 1000) / 1000;
  if (number > 100) return 0;
  return Math.round(number * 1000) / 1000;
}

/** Strip legal suffixes so "Acme (Pty) Ltd" and "Acme" share a key. */
export function supplierKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(proprietary|pty|ltd|limited|cc|inc|incorporated|llc|co|company)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function documentNumberKey(value: string | null | undefined): string {
  return (value ?? "").replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
}

export function normaliseSaVatNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export function isValidSaVatNumber(value: string | null | undefined): boolean {
  const digits = normaliseSaVatNumber(value);
  return digits != null && /^4\d{9}$/.test(digits);
}

export function stripLongDigitRuns(text: string): string {
  return text.replace(/\d{8,}/g, "[redacted]");
}

export async function fingerprintBankDetails(account: string | null, branch: string | null): Promise<string | null> {
  const accountDigits = (account ?? "").replace(/\D/g, "");
  const branchDigits = (branch ?? "").replace(/\D/g, "");
  if (accountDigits.length < 6) return null;
  return sha256Hex(`${accountDigits}|${branchDigits}`);
}

export function parseMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return round2(value);
  if (typeof value !== "string") return null;
  let text = value.trim().replace(/[Rr$£€]/g, "").replace(/\s/g, "");
  if (!text) return null;
  if (/^-?\d+,\d{2}$/.test(text)) text = text.replace(",", ".");
  text = text.replace(/,(?=\d{3}(\D|$))/g, "");
  text = text.replace(/[^0-9.-]/g, "");
  if (!text || text === "-" || text === ".") return null;
  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  return round2(number);
}

export function parseDocumentDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return validYmd(iso[1] ?? "", iso[2] ?? "", iso[3] ?? "");
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dmy) return validYmd(dmy[3] ?? "", dmy[2] ?? "", dmy[1] ?? "");
  return null;
}

function validYmd(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysApart(left: string, right: string): number | null {
  const a = Date.parse(`${left}T00:00:00Z`);
  const b = Date.parse(`${right}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round(Math.abs(a - b) / 86_400_000);
}

export function expectedDraftHolding(ledger: LedgerTarget): DraftHolding {
  return ledger === "xero" ? "ledger_draft" : "held_in_milon";
}

export function draftHoldingLabel(ledger: LedgerTarget): string {
  if (ledger === "xero") return "Xero draft. It is submitted in Xero and is not a final bill.";
  if (ledger === "qbo") return "Held in Milōn. It is not sent to QuickBooks until a final post.";
  return "Held in Milōn. It is not sent to Sage until a final post.";
}

/** Accountant when the client has a firm. Owner when the client has none. */
export function postingApproverRole(clientHasFirm: boolean): ApproverRole {
  return clientHasFirm ? "accountant" : "owner";
}

export function callerMayDecidePosting(input: {
  clientHasFirm: boolean;
  isFirmMember: boolean;
  isOwner: boolean;
}): boolean {
  if (input.clientHasFirm) return input.isFirmMember;
  return input.isOwner;
}

/** An owner can approve a posting when there is no firm. An owner cannot sign off. */
export function ownerMaySignOff(): false {
  return false;
}

export function proposalIsClean(flags: Pick<ProposalFlags, (typeof CLEAN_BLOCKING_FLAGS)[number]>): boolean {
  return CLEAN_BLOCKING_FLAGS.every((key) => flags[key] !== true);
}

export function finalPostingAllowed(input: {
  flags: ProposalFlags;
  cleanApprovedDrafts: number;
  finalUnlockAfter?: number;
}): boolean {
  const unlockAfter = input.finalUnlockAfter ?? DEFAULT_FINAL_UNLOCK_AFTER_CLEAN_DRAFTS;
  if (unlockAfter < 1) return false;
  if (input.flags.new_supplier || input.flags.bank_details_changed) return false;
  if (!proposalIsClean(input.flags)) return false;
  return input.cleanApprovedDrafts >= unlockAfter;
}

export function findSourceDuplicates(
  input: {
    fileSha256: string;
    supplierKey: string;
    documentNumber: string;
    amount: number;
    issuedOn: string;
    excludeDocumentId?: string | null;
  },
  existing: DedupeCandidate[],
): { file: boolean; semantic: boolean; fileDocumentId: string | null; semanticDocumentId: string | null } {
  const sha = input.fileSha256.toLowerCase();
  const supplier = supplierKey(input.supplierKey);
  const number = documentNumberKey(input.documentNumber);
  let fileDocumentId: string | null = null;
  let semanticDocumentId: string | null = null;
  for (const row of existing) {
    if (input.excludeDocumentId && row.documentId === input.excludeDocumentId) continue;
    const status = row.status ?? "";
    if (status === "rejected" || status === "rejected_intake") continue;
    if (!fileDocumentId && row.sha256.toLowerCase() === sha) fileDocumentId = row.documentId;
    if (!semanticDocumentId && supplier && number) {
      const apart = daysApart(input.issuedOn, row.issuedOn);
      if (
        supplierKey(row.supplierKey) === supplier &&
        documentNumberKey(row.documentNumber) === number &&
        Math.abs(row.amount - input.amount) <= AMOUNT_TOLERANCE &&
        apart != null &&
        apart <= SEMANTIC_DATE_WINDOW_DAYS
      ) {
        semanticDocumentId = row.documentId;
      }
    }
  }
  return {
    file: fileDocumentId != null,
    semantic: semanticDocumentId != null,
    fileDocumentId,
    semanticDocumentId,
  };
}

export function matchSupplier(
  extracted: { supplierKey: string; vatNumber: string | null },
  onFile: SupplierOnFile[],
): SupplierOnFile | null {
  const vat = normaliseSaVatNumber(extracted.vatNumber);
  if (isValidSaVatNumber(vat)) {
    const byVat = onFile.find((row) => normaliseSaVatNumber(row.vatNumber) === vat);
    if (byVat) return byVat;
  }
  if (!extracted.supplierKey) return null;
  return onFile.find((row) => supplierKey(row.supplierKey) === extracted.supplierKey) ?? null;
}

/** True only when the document and the supplier on file both have bank details and they differ. */
export function bankDetailsChanged(documentFingerprint: string | null, onFile: SupplierOnFile | null): boolean {
  if (!onFile || !documentFingerprint || !onFile.bankFingerprint) return false;
  return documentFingerprint !== onFile.bankFingerprint;
}

export function bankDetailsUnverified(documentFingerprint: string | null, onFile: SupplierOnFile | null): boolean {
  if (!onFile || !documentFingerprint) return false;
  return !onFile.bankFingerprint;
}

export function checkTotals(input: {
  amountsAre: AmountsAre;
  lines: Array<{ amount: number }>;
  taxTotal: number;
  total: number;
}): TotalsCheck {
  const lineSum = round2(input.lines.reduce((sum, line) => sum + line.amount, 0));
  const tax = round2(input.taxTotal);
  const total = round2(input.total);
  const expected = input.amountsAre === "exclusive" ? round2(lineSum + tax) : lineSum;
  const difference = round2(expected - total);
  const sumOk = input.lines.length > 0 && Math.abs(difference) <= AMOUNT_TOLERANCE;
  let vatRateOk = true;
  if (tax > 0 && input.lines.length > 0) {
    const expectedVat =
      input.amountsAre === "exclusive" ? round2(lineSum * SA_VAT_RATE) : round2((total * 15) / 115);
    vatRateOk = Math.abs(round2(expectedVat - tax)) <= 0.05;
  }
  return { ok: sumOk && vatRateOk, lineSum, tax, total, expected, difference, vatRateOk };
}

/**
 * Input VAT is claimable only for a valid tax invoice that carries the
 * supplier VAT number (10 digits starting with 4). Anything else stays
 * non-claimable.
 */
export function saInputVatClaimable(input: {
  docType: SourceDocType;
  taxInvoiceWording: boolean;
  supplierName: string | null;
  supplierVatNumber: string | null;
  invoiceNumber: string | null;
  issuedOn: string | null;
  total: number | null;
  hasDescription: boolean;
  recipientName: string | null;
}): { claimable: boolean; taxTreatment: TaxTreatment; reason: string } {
  if (!isValidSaVatNumber(input.supplierVatNumber)) {
    return { claimable: false, taxTreatment: "non_claimable", reason: "supplier_vat_number_missing_or_invalid" };
  }
  if (input.docType !== "bill" && input.docType !== "receipt") {
    return { claimable: false, taxTreatment: "non_claimable", reason: "not_an_input_document" };
  }
  const baseReady =
    !!input.supplierName && !!input.invoiceNumber && !!input.issuedOn && input.hasDescription && input.total != null;
  if (!baseReady) {
    return { claimable: false, taxTreatment: "non_claimable", reason: "tax_invoice_elements_missing" };
  }
  const total = input.total ?? 0;
  if (total <= TILL_SLIP_RANDS) {
    return { claimable: true, taxTreatment: "claimable", reason: "till_slip" };
  }
  if (!input.taxInvoiceWording) {
    return { claimable: false, taxTreatment: "non_claimable", reason: "tax_invoice_wording_missing" };
  }
  if (total > FULL_TAX_INVOICE_RANDS && !input.recipientName) {
    return { claimable: false, taxTreatment: "non_claimable", reason: "full_tax_invoice_recipient_missing" };
  }
  return { claimable: true, taxTreatment: "claimable", reason: "valid_tax_invoice" };
}

export function sonnet55CostUsd(inputTokens: number, outputTokens: number, cacheReadTokens = 0): number {
  const cost = (inputTokens * 2 + outputTokens * 10 + cacheReadTokens * 0.1) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

function readConfidence(raw: unknown): { value: unknown; confidence: number; page: number | null } {
  const record = asRecord(raw);
  if (!record || (!("value" in record) && !("confidence" in record))) {
    return { value: raw ?? null, confidence: 0, page: null };
  }
  const pageRaw = record.page ?? record.source_page;
  const page = typeof pageRaw === "number" && Number.isFinite(pageRaw) ? Math.trunc(pageRaw) : null;
  return { value: record.value ?? null, confidence: normaliseConfidence(record.confidence), page };
}

function normaliseDocType(value: unknown, isStatement: boolean): SourceDocType {
  if (isStatement) return "bank_statement";
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["bank_statement", "statement", "supplier_statement", "account_statement"].includes(text)) return "bank_statement";
  if (["bill", "invoice", "tax_invoice", "supplier_invoice", "supplier_bill"].includes(text)) return "bill";
  if (["receipt", "till_slip", "slip"].includes(text)) return "receipt";
  if (["sales_invoice", "customer_invoice"].includes(text)) return "sales_invoice";
  if (["credit_note", "supplier_credit_note", "credit_note"].includes(text)) return "credit_note";
  return "other";
}

function normaliseAmountsAre(value: unknown): AmountsAre {
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (text === "inclusive" || text === "incl" || text === "vat_inclusive") return "inclusive";
  if (text === "exclusive" || text === "excl" || text === "vat_exclusive") return "exclusive";
  if (text === "no_tax" || text === "none" || text === "no_vat") return "no_tax";
  return "exclusive";
}

export function extractJsonObject(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("extraction_json_invalid");
    return JSON.parse(match[0]);
  }
}

/** Model output is data. Mode, approval, and bank account numbers are not kept. */
export async function parseModelDocument(raw: string): Promise<ParsedSourceDocument> {
  const parsed = extractJsonObject(raw);
  const record = asRecord(parsed);
  if (!record) throw new Error("extraction_json_invalid");

  const isStatement =
    record.is_statement === true ||
    record.statement === true ||
    String(record.doc_type ?? "").toLowerCase().includes("statement");
  const docType = normaliseDocType(record.doc_type, isStatement);

  const supplier = readConfidence(record.supplier_name);
  const vat = readConfidence(record.supplier_vat_number);
  const invoice = readConfidence(record.invoice_number);
  const issued = readConfidence(record.issued_on);
  const totalField = readConfidence(record.total);
  const taxField = readConfidence(record.tax_total ?? record.tax);
  const currencyField = readConfidence(record.currency);
  const amountsField = readConfidence(record.amounts_are);
  const wordingField = readConfidence(record.tax_invoice_wording);
  const recipientField = readConfidence(record.recipient_name);
  const bankAccount = readConfidence(record.bank_account_number);
  const bankBranch = readConfidence(record.bank_branch_code);

  const supplierNameRaw = textValue(supplier.value);
  const supplierName = supplierNameRaw ? stripLongDigitRuns(supplierNameRaw).replace(/\s+/g, " ").trim() : null;
  const supplierVatNumber = normaliseSaVatNumber(textValue(vat.value));
  const invoiceNumber = textValue(invoice.value);
  const issuedOn = parseDocumentDate(textValue(issued.value) ?? (typeof issued.value === "string" ? issued.value : null));
  const total = parseMoney(totalField.value);
  const taxTotal = parseMoney(taxField.value);
  const currency = (textValue(currencyField.value) ?? "").toUpperCase();
  const amountsAre = normaliseAmountsAre(amountsField.value ?? amountsField.value);
  const taxInvoiceWording =
    wordingField.value === true ||
    String(wordingField.value ?? "").toLowerCase() === "true" ||
    String(wordingField.value ?? "").toLowerCase().includes("tax invoice");
  const recipientName = textValue(recipientField.value);

  const linesRaw = Array.isArray(record.line_items) ? record.line_items : [];
  const lines: ParsedLine[] = [];
  for (const item of linesRaw) {
    const line = asRecord(item);
    if (!line) continue;
    const amount = parseMoney(line.amount);
    if (amount == null) continue;
    const description = stripLongDigitRuns(textValue(line.description) ?? "").trim();
    lines.push({
      description,
      quantity: parseMoney(line.quantity),
      amount,
      tax: parseMoney(line.tax),
      confidence: normaliseConfidence(line.confidence),
    });
  }

  const bankFingerprint = await fingerprintBankDetails(textValue(bankAccount.value), textValue(bankBranch.value));

  const fields: Record<string, ConfidenceField> = {
    supplier_name: { value: supplierName, confidence: supplier.confidence, page: supplier.page },
    supplier_vat_number: { value: supplierVatNumber, confidence: vat.confidence, page: vat.page },
    invoice_number: { value: invoiceNumber, confidence: invoice.confidence, page: invoice.page },
    date: { value: issuedOn, confidence: issued.confidence, page: issued.page },
    total: { value: total, confidence: totalField.confidence, page: totalField.page },
    tax: { value: taxTotal, confidence: taxField.confidence, page: taxField.page },
    currency: { value: currency || null, confidence: currencyField.confidence, page: currencyField.page },
    amounts_are: { value: amountsAre, confidence: amountsField.confidence, page: amountsField.page },
    recipient_name: { value: recipientName, confidence: recipientField.confidence, page: recipientField.page },
    tax_invoice_wording: { value: taxInvoiceWording, confidence: wordingField.confidence, page: wordingField.page },
  };

  return {
    docType,
    isStatement,
    amountsAre,
    currency,
    fields,
    lines,
    supplierName,
    supplierVatNumber,
    invoiceNumber,
    issuedOn,
    total,
    taxTotal,
    taxInvoiceWording,
    recipientName,
    bankFingerprint,
    bankDetailsPresent: bankFingerprint != null,
  };
}

function storedFields(fields: Record<string, ConfidenceField>): Record<string, ConfidenceField> {
  const copy: Record<string, ConfidenceField> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (key.includes("bank")) continue;
    copy[key] = field;
  }
  return copy;
}

export function assessSourceDocument(input: {
  parsed: ParsedSourceDocument;
  targetLedger: LedgerTarget;
  requestedMode?: PostingMode;
  fileSha256: string;
  existing: DedupeCandidate[];
  suppliersOnFile: SupplierOnFile[];
  excludeDocumentId?: string | null;
  finalUnlockAfter?: number;
}): ExtractionAssessment {
  const parsed = input.parsed;
  const amountsAre = parsed.amountsAre;
  let taxTotal = parsed.taxTotal;
  const fields = storedFields(parsed.fields);
  const amountsConfidence = fields.amounts_are?.confidence ?? 0;
  if (amountsAre === "no_tax" && amountsConfidence >= FINAL_FIELD_CONFIDENCE && (taxTotal == null || taxTotal === 0)) {
    taxTotal = 0;
    fields.tax = {
      value: 0,
      confidence: Math.max(fields.tax?.confidence ?? 0, amountsConfidence),
      page: fields.tax?.page ?? fields.amounts_are?.page ?? null,
    };
  }

  const totals = checkTotals({
    amountsAre,
    lines: parsed.lines,
    taxTotal: taxTotal ?? 0,
    total: parsed.total ?? 0,
  });
  const arithmeticMismatch = parsed.total == null || !totals.ok;
  const hasDescription = parsed.lines.some((line) => line.description.trim().length > 0);
  let vat = saInputVatClaimable({
    docType: parsed.docType,
    taxInvoiceWording: parsed.taxInvoiceWording,
    supplierName: parsed.supplierName,
    supplierVatNumber: parsed.supplierVatNumber,
    invoiceNumber: parsed.invoiceNumber,
    issuedOn: parsed.issuedOn,
    total: parsed.total,
    hasDescription,
    recipientName: parsed.recipientName,
  });
  if (!totals.vatRateOk) {
    vat = { claimable: false, taxTreatment: "non_claimable", reason: "vat_arithmetic_mismatch" };
  }

  const lowFields: string[] = [];
  for (const key of REQUIRED_CONFIDENCE_FIELDS) {
    const field = fields[key];
    if (!field || field.value == null || field.value === "" || field.confidence < FINAL_FIELD_CONFIDENCE) {
      lowFields.push(key);
    }
  }
  if (parsed.lines.length === 0) lowFields.push("lines");

  const supplierKeyValue = supplierKey(parsed.supplierName);
  const numberKey = documentNumberKey(parsed.invoiceNumber);
  const duplicates = findSourceDuplicates(
    {
      fileSha256: input.fileSha256,
      supplierKey: supplierKeyValue,
      documentNumber: numberKey,
      amount: parsed.total ?? 0,
      issuedOn: parsed.issuedOn ?? "",
      excludeDocumentId: input.excludeDocumentId,
    },
    input.existing,
  );
  const onFile = matchSupplier(
    { supplierKey: supplierKeyValue, vatNumber: parsed.supplierVatNumber },
    input.suppliersOnFile,
  );
  const isNew = !onFile;
  const bankChanged = bankDetailsChanged(parsed.bankFingerprint, onFile);
  const bankUnverified = bankDetailsUnverified(parsed.bankFingerprint, onFile);
  const statement = parsed.docType === "bank_statement" || parsed.isStatement;

  const flags: ProposalFlags = {
    low_confidence: lowFields.length > 0,
    low_confidence_fields: [...lowFields].sort(),
    arithmetic_mismatch: arithmeticMismatch,
    duplicate_file: duplicates.file,
    duplicate_document: duplicates.semantic,
    new_supplier: isNew && !statement,
    bank_details_changed: bankChanged,
    bank_details_unverified: bankUnverified,
    vat_claimable: vat.claimable,
    not_valid_tax_invoice: !vat.claimable,
    final_locked: true,
    statement_not_a_bill: statement,
    vat_reason: vat.reason,
  };

  const cleanCount = onFile?.cleanApprovedDrafts ?? 0;
  const unlockAfter = input.finalUnlockAfter ?? DEFAULT_FINAL_UNLOCK_AFTER_CLEAN_DRAFTS;
  flags.final_locked = !finalPostingAllowed({ flags, cleanApprovedDrafts: cleanCount, finalUnlockAfter: unlockAfter });

  const lineItems = parsed.lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    amount: moneyString(line.amount),
    tax: line.tax == null ? null : moneyString(line.tax),
    confidence: line.confidence,
  }));

  const base = {
    docType: parsed.docType,
    supplierName: parsed.supplierName,
    supplierVatNumber: parsed.supplierVatNumber,
    supplierKey: supplierKeyValue,
    fields,
    lineItems,
    totalsCheck: totals,
    arithmeticOk: !arithmeticMismatch,
    vatClaimable: vat.claimable,
    taxTreatment: vat.taxTreatment,
    flags,
  };

  if (statement) {
    return { ...base, proposal: null, skipReason: "bank_statement" };
  }
  if (
    !isPostableDocType(parsed.docType) ||
    parsed.total == null ||
    !parsed.issuedOn ||
    !numberKey ||
    !supplierKeyValue
  ) {
    return { ...base, proposal: null, skipReason: "unsupported_doc_type" };
  }

  const requested = input.requestedMode === "final" ? "final" : "draft";
  const mode: PostingMode = requested === "final" && !flags.final_locked ? "final" : "draft";
  const payload: ProposalPayload = {
    ledger: input.targetLedger,
    doc_type: parsed.docType,
    mode,
    draft_holding: expectedDraftHolding(input.targetLedger),
    draft_label: draftHoldingLabel(input.targetLedger),
    contact: {
      name: parsed.supplierName ?? "",
      vat_number: parsed.supplierVatNumber,
      create_new: flags.new_supplier,
    },
    invoice_number: numberKey,
    issued_on: parsed.issuedOn,
    currency: parsed.currency,
    amounts_are: amountsAre,
    lines: parsed.lines.map((line) => ({
      description: line.description,
      amount: moneyString(line.amount),
      tax_treatment: vat.taxTreatment,
    })),
    tax_total: moneyString(taxTotal ?? 0),
    total: moneyString(parsed.total),
    vat_claimable: vat.claimable,
    tax_treatment: vat.taxTreatment,
    guards: {
      low_confidence: flags.low_confidence,
      arithmetic_mismatch: flags.arithmetic_mismatch,
      duplicate_file: flags.duplicate_file,
      duplicate_document: flags.duplicate_document,
      new_supplier: flags.new_supplier,
      bank_details_changed: flags.bank_details_changed,
      bank_details_unverified: flags.bank_details_unverified,
      final_locked: flags.final_locked,
      vat_claimable: flags.vat_claimable,
    },
    low_confidence_fields: flags.low_confidence_fields,
  };

  return {
    ...base,
    skipReason: null,
    proposal: {
      payload,
      flags,
      supplierKey: supplierKeyValue,
      supplierDisplayName: parsed.supplierName ?? "",
      supplierVatNumber: parsed.supplierVatNumber,
      documentNumber: numberKey,
      amount: parsed.total,
      issuedOn: parsed.issuedOn,
      clean: proposalIsClean(flags),
    },
  };
}

export type ProposalDecisionState = {
  status: "proposed" | "approved" | "rejected" | "posted" | "failed";
  canonicalPayload: string;
  payloadSha256: string;
  approvalPayloadSha256: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approverRole: ApproverRole | null;
  rejectedBy: string | null;
  version: number;
};

export type PostingDecisionResult =
  | { ok: true; already: boolean; proposal: ProposalDecisionState }
  | {
      ok: false;
      error: "unauthorised" | "decision_invalid" | "signed_off_refused" | "approver_forbidden" | "not_proposed";
      approverRole: ApproverRole;
    };

/**
 * Same rules as decide_ledger_post_proposal. The RPC is what the app calls.
 * A later payload change has to come back through reviseProposalPayload, which
 * clears the approval.
 */
export function decidePosting(input: {
  proposal: ProposalDecisionState;
  decision: string;
  note?: string | null;
  callerId: string | null;
  clientHasFirm: boolean;
  isFirmMember: boolean;
  isOwner: boolean;
  now: string;
}): PostingDecisionResult {
  const approverRole = postingApproverRole(input.clientHasFirm);
  if (!input.callerId) return { ok: false, error: "unauthorised", approverRole };
  if (refusesSignOffWording(input.decision) || refusesSignOffWording(input.note)) {
    return { ok: false, error: "signed_off_refused", approverRole };
  }
  if (input.decision !== "approve" && input.decision !== "reject") {
    return { ok: false, error: "decision_invalid", approverRole };
  }
  const allowed = callerMayDecidePosting({
    clientHasFirm: input.clientHasFirm,
    isFirmMember: input.isFirmMember,
    isOwner: input.isOwner,
  });
  if (!allowed) return { ok: false, error: "approver_forbidden", approverRole };

  const current = input.proposal;
  if (
    input.decision === "approve" &&
    current.status === "approved" &&
    current.approvedBy === input.callerId &&
    current.approvalPayloadSha256 === current.payloadSha256 &&
    current.approvedAt
  ) {
    return { ok: true, already: true, proposal: current };
  }
  if (current.status !== "proposed") return { ok: false, error: "not_proposed", approverRole };

  if (input.decision === "approve") {
    return {
      ok: true,
      already: false,
      proposal: {
        ...current,
        status: "approved",
        approvedBy: input.callerId,
        approvedAt: input.now,
        approverRole,
        approvalPayloadSha256: current.payloadSha256,
        rejectedBy: null,
      },
    };
  }
  return {
    ok: true,
    already: false,
    proposal: {
      ...current,
      status: "rejected",
      rejectedBy: input.callerId,
      approvedBy: null,
      approvedAt: null,
      approverRole: null,
      approvalPayloadSha256: null,
    },
  };
}

/** Any payload edit clears the approval and bumps the version. */
export async function reviseProposalPayload(
  proposal: ProposalDecisionState,
  nextPayload: ProposalPayload,
): Promise<ProposalDecisionState> {
  if (proposal.status === "posted") throw new Error("posted_payload_locked");
  const sealed = await sealPayload(nextPayload);
  if (sealed.canonicalPayload === proposal.canonicalPayload && sealed.payloadSha256 === proposal.payloadSha256) {
    return proposal;
  }
  return {
    ...proposal,
    canonicalPayload: sealed.canonicalPayload,
    payloadSha256: sealed.payloadSha256,
    approvalPayloadSha256: null,
    approvedBy: null,
    approvedAt: null,
    approverRole: null,
    rejectedBy: null,
    status: "proposed",
    version: proposal.version + 1,
  };
}
