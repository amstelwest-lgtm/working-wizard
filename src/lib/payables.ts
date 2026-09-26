/**
 * Aged payables pressure list — pure parsers and drafts.
 * Xero and QuickBooks sync write this shape into `*_sync_data.data_type = 'aged_ap'`.
 * Milōn reads the books. It does not send payments or record bills.
 */
import {
  ageBucketFromDue,
  parseQboAgedReceivables,
  parseReportMoney,
  parseXeroAgedReceivablesByContact,
  type CollectionsContact,
  type CollectionsInvoice,
} from "./collections.ts";

export type PayablesSource = "xero" | "qbo";
export type PayablesStatus = "applied" | "empty" | "skipped";
export type SupplierMove = "Pay" | "Delay" | "Renegotiate" | "Decide";

export type PayablesBill = {
  billId: string | null;
  reference: string;
  dueDate: string | null;
  amount: number;
  ageBucket: string;
};

export type PayablesSupplier = {
  supplierId: string;
  name: string;
  outstanding: number;
  overdue: number;
  ageBucket: string;
  buckets: { label: string; amount: number }[];
  bills: PayablesBill[];
};

export type PayablesSnapshot = {
  version: 1;
  source: PayablesSource;
  status: PayablesStatus;
  asOf: string | null;
  syncedAt: string;
  skipReason: string | null;
  note: string | null;
  supplierCount: number;
  billCount: number;
  totalOutstanding: number;
  totalOverdue: number;
  suppliers: PayablesSupplier[];
};

export type XeroSupplierCandidate = {
  contactId: string;
  name: string;
  isSupplier: boolean;
  updatedMs: number;
  /** Null when the contact list omitted balances. */
  outstanding: number | null;
  overdue: number | null;
  hasBalances: boolean;
};

const SOURCES = new Set<PayablesSource>(["xero", "qbo"]);
const STATUSES = new Set<PayablesStatus>(["applied", "empty", "skipped"]);

export const XERO_AGED_AP_RECONNECT =
  "Aged payables need a reconnect. Enable accounting.reports.aged.read and accounting.contacts.read on the Xero app, then disconnect and connect again.";

export const AGED_AP_PENDING = "Aged payables appear after the next Sync";

export const PAYABLES_TITLE = "Decide which overdue payables to pay, delay, or renegotiate";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function moneyOrZero(n: number): number {
  return Number.isFinite(n) ? round2(n) : 0;
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function normalizeRunwayWeeks(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function moneyPlain(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function weeksLabel(weeks: number): string {
  const shown = Number.isInteger(weeks) ? String(weeks) : weeks.toFixed(1);
  return `${shown} week${weeks === 1 ? "" : "s"}`;
}

/** Oldest non-current buckets are the ones a supplier is least likely to extend. */
function bucketIsOld(ageBucket: string): boolean {
  return /older|91|90\s*\+|3\s*months?|2\s*months?/i.test(ageBucket);
}

/**
 * Pay / delay / renegotiate from the age bucket plus a runway figure already
 * stored on the client. Without that figure the move stays "Decide".
 */
export function supplierMove(ageBucket: string, runwayWeeks: number | null | undefined): SupplierMove {
  const weeks = normalizeRunwayWeeks(runwayWeeks);
  if (weeks == null) return "Decide";
  const old = bucketIsOld(ageBucket);
  if (weeks <= 4) return old ? "Renegotiate" : "Delay";
  if (weeks >= 13) return "Pay";
  return old ? "Pay" : "Renegotiate";
}

function movePhrase(move: SupplierMove): string {
  if (move === "Pay") return "pay";
  if (move === "Delay") return "delay";
  if (move === "Renegotiate") return "renegotiate";
  return "pay, delay, or renegotiate";
}

export function finalizePayables(input: {
  source: PayablesSource;
  asOf: string | null;
  syncedAt: string;
  suppliers: PayablesSupplier[];
  note?: string | null;
}): PayablesSnapshot {
  const suppliers = [...input.suppliers]
    .filter((supplier) => supplier.name.trim() && Math.abs(supplier.outstanding) >= 0.005)
    .sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
  const billCount = suppliers.reduce((sum, supplier) => sum + supplier.bills.length, 0);
  const totalOutstanding = moneyOrZero(suppliers.reduce((sum, supplier) => sum + supplier.outstanding, 0));
  const totalOverdue = moneyOrZero(suppliers.reduce((sum, supplier) => sum + supplier.overdue, 0));
  const status: PayablesStatus = suppliers.length ? "applied" : "empty";
  return {
    version: 1,
    source: input.source,
    status,
    asOf: input.asOf,
    syncedAt: input.syncedAt,
    skipReason: null,
    note: input.note?.trim() || null,
    supplierCount: suppliers.length,
    billCount,
    totalOutstanding,
    totalOverdue,
    suppliers,
  };
}

export function skippedPayables(input: {
  source: PayablesSource;
  asOf: string | null;
  syncedAt: string;
  skipReason: string;
}): PayablesSnapshot {
  return {
    version: 1,
    source: input.source,
    status: "skipped",
    asOf: input.asOf,
    syncedAt: input.syncedAt,
    skipReason: input.skipReason.trim() || "Aged payables were not applied",
    note: null,
    supplierCount: 0,
    billCount: 0,
    totalOutstanding: 0,
    totalOverdue: 0,
    suppliers: [],
  };
}

function readBill(raw: unknown): PayablesBill | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const reference = typeof row.reference === "string" ? row.reference.trim() : "";
  if (!reference) return null;
  const amount = numOrNull(row.amount);
  return {
    billId: typeof row.billId === "string" && row.billId ? row.billId : null,
    reference,
    dueDate: typeof row.dueDate === "string" && row.dueDate ? row.dueDate : null,
    amount: amount ?? 0,
    ageBucket: typeof row.ageBucket === "string" ? row.ageBucket : "",
  };
}

function readSupplier(raw: unknown): PayablesSupplier | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const supplierId = typeof row.supplierId === "string" ? row.supplierId : "";
  if (!name || !supplierId) return null;
  const buckets = Array.isArray(row.buckets)
    ? row.buckets.flatMap((bucket) => {
        if (!bucket || typeof bucket !== "object") return [];
        const b = bucket as Record<string, unknown>;
        const label = typeof b.label === "string" ? b.label : "";
        const amount = numOrNull(b.amount);
        if (!label || amount == null) return [];
        return [{ label, amount }];
      })
    : [];
  const bills = Array.isArray(row.bills)
    ? row.bills.flatMap((bill) => {
        const parsed = readBill(bill);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    supplierId,
    name,
    outstanding: numOrNull(row.outstanding) ?? 0,
    overdue: numOrNull(row.overdue) ?? 0,
    ageBucket: typeof row.ageBucket === "string" ? row.ageBucket : "",
    buckets,
    bills,
  };
}

export function readPayablesSnapshot(raw: unknown): PayablesSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.version !== 1) return null;
  const source = row.source;
  const status = row.status;
  if (typeof source !== "string" || !SOURCES.has(source as PayablesSource)) return null;
  if (typeof status !== "string" || !STATUSES.has(status as PayablesStatus)) return null;
  const suppliers = Array.isArray(row.suppliers)
    ? row.suppliers.flatMap((supplier) => {
        const parsed = readSupplier(supplier);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    version: 1,
    source: source as PayablesSource,
    status: status as PayablesStatus,
    asOf: typeof row.asOf === "string" && row.asOf ? row.asOf : null,
    syncedAt: typeof row.syncedAt === "string" ? row.syncedAt : "",
    skipReason: typeof row.skipReason === "string" && row.skipReason.trim() ? row.skipReason : null,
    note: typeof row.note === "string" && row.note.trim() ? row.note : null,
    supplierCount: numOrNull(row.supplierCount) ?? suppliers.length,
    billCount: numOrNull(row.billCount) ?? suppliers.reduce((sum, s) => sum + s.bills.length, 0),
    totalOutstanding: numOrNull(row.totalOutstanding) ?? 0,
    totalOverdue: numOrNull(row.totalOverdue) ?? 0,
    suppliers,
  };
}

export function choosePayables(rows: Array<PayablesSnapshot | null | undefined>): PayablesSnapshot | null {
  const present = rows.filter((row): row is PayablesSnapshot => row != null);
  if (!present.length) return null;
  const usable = present.filter((row) => row.status === "applied" || row.status === "empty");
  const pool = usable.length ? usable : present;
  return [...pool].sort((a, b) => {
    const rank = (snap: PayablesSnapshot) => (snap.status === "applied" ? 2 : snap.status === "empty" ? 1 : 0);
    const byStatus = rank(b) - rank(a);
    if (byStatus !== 0) return byStatus;
    return (b.syncedAt || "").localeCompare(a.syncedAt || "");
  })[0];
}

export function payablesSourceLabel(source: PayablesSource): string {
  return source === "xero" ? "Xero" : "QuickBooks";
}

export function agedApProofLine(snap: PayablesSnapshot | null | undefined): string {
  if (!snap) return AGED_AP_PENDING;
  if (snap.status === "skipped") return snap.skipReason ?? "Aged payables were not applied";
  const when = snap.asOf ? `as of ${snap.asOf}` : "applied";
  if (snap.status === "empty" || snap.supplierCount === 0) {
    return `Aged payables ${when} · nothing outstanding`;
  }
  const suppliers = `${snap.supplierCount} supplier${snap.supplierCount === 1 ? "" : "s"}`;
  const bills =
    snap.billCount > 0
      ? ` · ${snap.billCount} bill${snap.billCount === 1 ? "" : "s"}`
      : " · bill numbers not on this report";
  return `Aged payables ${when} · ${suppliers}${bills}`;
}

// ─── Xero suppliers + AgedPayablesByContact ──────────────────────────────────

function xeroUpdatedMs(raw: unknown): number {
  if (typeof raw !== "string" || !raw) return 0;
  const stamped = /\/Date\((\d+)/.exec(raw);
  if (stamped) return Number(stamped[1]);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseXeroSuppliersPage(json: unknown): XeroSupplierCandidate[] {
  if (!json || typeof json !== "object") return [];
  const rows = (json as { Contacts?: unknown }).Contacts;
  if (!Array.isArray(rows)) return [];
  const out: XeroSupplierCandidate[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const contactId = typeof row.ContactID === "string" ? row.ContactID : "";
    const name = typeof row.Name === "string" ? row.Name.trim() : "";
    if (!contactId || !name) continue;
    const status = typeof row.ContactStatus === "string" ? row.ContactStatus.toUpperCase() : "ACTIVE";
    if (status === "ARCHIVED") continue;
    if (row.IsSupplier !== true) continue;
    const balances =
      row.Balances && typeof row.Balances === "object"
        ? (row.Balances as { AccountsPayable?: { Outstanding?: unknown; Overdue?: unknown } })
        : null;
    const ap = balances?.AccountsPayable;
    const hasBalances = Boolean(ap && (ap.Outstanding != null || ap.Overdue != null));
    out.push({
      contactId,
      name,
      isSupplier: true,
      updatedMs: xeroUpdatedMs(row.UpdatedDateUTC),
      outstanding: hasBalances ? numOrNull(ap?.Outstanding) : null,
      overdue: hasBalances ? numOrNull(ap?.Overdue) : null,
      hasBalances,
    });
  }
  return out;
}

export function selectXeroSuppliersForAging(
  suppliers: XeroSupplierCandidate[],
  cap: number,
): { selected: XeroSupplierCandidate[]; note: string | null } {
  const limit = Math.max(1, cap);
  const withBalances = suppliers.some((supplier) => supplier.hasBalances);
  if (withBalances) {
    const owing = suppliers
      .filter((supplier) => (supplier.outstanding ?? 0) >= 0.005 || (supplier.overdue ?? 0) >= 0.005)
      .sort(
        (a, b) => (b.overdue ?? 0) - (a.overdue ?? 0) || (b.outstanding ?? 0) - (a.outstanding ?? 0),
      );
    if (owing.length > limit) {
      return {
        selected: owing.slice(0, limit),
        note: `Showing the ${limit} largest balances. Other suppliers with a balance were not aged this sync.`,
      };
    }
    return { selected: owing, note: null };
  }
  const recent = [...suppliers].sort((a, b) => b.updatedMs - a.updatedMs);
  if (recent.length > limit) {
    return {
      selected: recent.slice(0, limit),
      note: `Contact balances were not on the Xero list, so this sync aged the ${limit} most recently updated suppliers.`,
    };
  }
  return {
    selected: recent,
    note: recent.length ? "Xero's contact list has no balances, so every supplier returned was aged." : null,
  };
}

function billsFromInvoices(invoices: CollectionsInvoice[]): PayablesBill[] {
  return invoices.map((invoice) => ({
    billId: invoice.invoiceId,
    reference: invoice.reference,
    dueDate: invoice.dueDate,
    amount: invoice.amount,
    ageBucket: invoice.ageBucket,
  }));
}

export function supplierFromAgedContact(contact: CollectionsContact): PayablesSupplier {
  return {
    supplierId: contact.contactId,
    name: contact.name,
    outstanding: contact.outstanding,
    overdue: contact.overdue,
    ageBucket: contact.ageBucket,
    buckets: contact.buckets,
    bills: billsFromInvoices(contact.invoices),
  };
}

/** Aged Payables by contact uses the same row shape as aged receivables. */
export function parseXeroAgedPayablesByContact(
  json: unknown,
  supplier: { contactId: string; name: string },
): PayablesSupplier | null {
  const parsed = parseXeroAgedReceivablesByContact(json, supplier);
  if (!parsed) return null;
  return supplierFromAgedContact(parsed);
}

// ─── QuickBooks AgedPayables + detail ─────────────────────────────────────────

type QboCell = { value?: string; id?: string };
type QboRow = {
  type?: string;
  group?: string;
  ColData?: QboCell[];
  Header?: { ColData?: QboCell[] };
  Rows?: { Row?: QboRow[] };
};
type QboReport = {
  Header?: { EndPeriod?: string };
  Columns?: { Column?: Array<{ ColTitle?: string; ColType?: string }> };
  Rows?: { Row?: QboRow[] };
};

function asQboReport(json: unknown): QboReport {
  if (!json || typeof json !== "object") return {};
  return json as QboReport;
}

function walkQbo(
  rows: QboRow[] | undefined,
  visit: (row: QboRow, header: { id: string; name: string } | null) => void,
  header: { id: string; name: string } | null = null,
) {
  if (!rows) return;
  for (const row of rows) {
    const headCell = row.Header?.ColData?.[0];
    const next =
      headCell && (headCell.value || headCell.id)
        ? { id: headCell.id ?? "", name: String(headCell.value ?? "").trim() }
        : header;
    visit(row, header);
    if (row.Rows?.Row?.length) walkQbo(row.Rows.Row, visit, next);
  }
}

function qboColumns(report: QboReport): Array<{ index: number; title: string; type: string }> {
  return (report.Columns?.Column ?? []).map((column, index) => ({
    index,
    title: String(column.ColTitle ?? "").trim(),
    type: String(column.ColType ?? "").toLowerCase(),
  }));
}

function cellTextQbo(cells: QboCell[], index: number): string {
  return String(cells[index]?.value ?? "").trim();
}

function isoDate(raw: string): string | null {
  const text = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function parseQboAgedPayables(json: unknown, asOf: string): PayablesSupplier[] {
  return parseQboAgedReceivables(json, asOf).map(supplierFromAgedContact);
}

export function attachQboBillDetail(
  suppliers: PayablesSupplier[],
  json: unknown,
  asOf: string,
): PayablesSupplier[] {
  const report = asQboReport(json);
  const columns = qboColumns(report);
  const findCol = (pred: (title: string, type: string) => boolean, fallback: number) => {
    const hit = columns.find((column) => pred(column.title.toLowerCase(), column.type));
    return hit?.index ?? fallback;
  };
  const numIdx = findCol((title) => title === "num" || title === "no." || title.includes("num"), 2);
  const dueIdx = findCol((title) => title.includes("due"), 3);
  const typeIdx = findCol((title, type) => title.includes("type") || type === "string", 1);
  const openIdx = findCol(
    (title) => title.includes("open") || title.includes("balance"),
    columns.length - 1,
  );
  const byId = new Map(suppliers.map((supplier) => [supplier.supplierId, supplier]));
  const byName = new Map(suppliers.map((supplier) => [supplier.name.toLowerCase(), supplier]));
  const bills = new Map<string, PayablesBill[]>();

  walkQbo(report.Rows?.Row, (row, header) => {
    const cells = row.ColData;
    if (!cells?.length || !header) return;
    const txn = cellTextQbo(cells, typeIdx).toLowerCase();
    if (txn.includes("payment")) return;
    if (txn && !txn.includes("bill")) return;
    const open = parseReportMoney(cellTextQbo(cells, openIdx));
    if (Math.abs(open) < 0.005) return;
    const reference = cellTextQbo(cells, numIdx) || cellTextQbo(cells, 0);
    if (!reference || /^total\b/i.test(reference)) return;
    const due = isoDate(cellTextQbo(cells, dueIdx));
    const supplier =
      (header.id && byId.get(header.id)) || byName.get(header.name.toLowerCase()) || null;
    if (!supplier) return;
    const list = bills.get(supplier.supplierId) ?? [];
    list.push({
      billId: cells[numIdx]?.id || cells[0]?.id || null,
      reference,
      dueDate: due,
      amount: moneyOrZero(open),
      ageBucket: ageBucketFromDue(due, asOf),
    });
    bills.set(supplier.supplierId, list);
  });

  return suppliers.map((supplier) => ({
    ...supplier,
    bills: bills.get(supplier.supplierId) ?? [],
  }));
}

export function qboAgedPayableSkipReason(message: string): string {
  if (/\b(401|403)\b/.test(message)) {
    return "QuickBooks did not return Aged Payables for this connection. Accounting scope is already requested — reconnect QuickBooks if this persists.";
  }
  const clean = message.replace(/\s+/g, " ").trim();
  return `Aged payables were not applied. ${clean.slice(0, 180)}`.trim();
}

// ─── Bot / Action Plan draft ──────────────────────────────────────────────────

export type PayablesDraft = {
  title: string;
  problem: string;
  rationale: string;
  assumptions: string[];
  evidence: Array<{
    kind: "transaction";
    key: string;
    label: string;
    value: number;
  }>;
  priority: "high";
  dataDepth: "transaction";
  expectedImpact: {
    metric: "cash";
    amount: number;
    horizonDays: 30;
    note: string;
  };
};

function isCurrentTitle(title: string): boolean {
  return title.trim().toLowerCase() === "current" || title.trim().toLowerCase().startsWith("current ");
}

export function runwayParagraph(weeks: number | null, overduePlain: string): string {
  if (weeks == null) {
    return "No cash-runway figure is stored on the forecast, so this draft does not quote weeks of cash or a cash balance.";
  }
  const label = weeksLabel(weeks);
  if (weeks >= 13) {
    return `The cash forecast on file shows ${label} of runway. It does not go through the floor inside that window, so paying the overdue ${overduePlain} is the default. Renegotiate only when a supplier will extend terms.`;
  }
  if (weeks <= 4) {
    return `The cash forecast on file shows ${label} of runway. That runway is already short. Delay or renegotiate these overdue balances before paying them in full. Pay a bill this week only when that supplier will not wait.`;
  }
  return `The cash forecast on file shows ${label} of runway. There is room to pay overdue bills that are already well past terms. Delay or renegotiate the ones a supplier will extend.`;
}

export function payablesPromptBlock(
  snap: PayablesSnapshot | null,
  runwayWeeks?: number | null,
): string {
  if (!snap || snap.status !== "applied" || snap.suppliers.length === 0) return "";
  const weeks = normalizeRunwayWeeks(runwayWeeks);
  const lines = [
    `Aged payables (${payablesSourceLabel(snap.source)}${snap.asOf ? `, as of ${snap.asOf}` : ""}):`,
    `Overdue total: ${moneyPlain(snap.totalOverdue)}. Outstanding total: ${moneyPlain(snap.totalOutstanding)}. Suppliers: ${snap.supplierCount}. Bill lines: ${snap.billCount}.`,
    weeks == null
      ? "No cash-runway figure is on file. Do not invent weeks of cash or a cash balance."
      : `Cash runway already on file: ${weeksLabel(weeks)}. Do not invent a different runway or cash figure.`,
  ];
  for (const supplier of snap.suppliers.slice(0, 8)) {
    const bills = supplier.bills
      .slice(0, 4)
      .map((bill) => `${bill.reference} (${moneyPlain(bill.amount)}${bill.ageBucket ? `, ${bill.ageBucket}` : ""})`)
      .join("; ");
    const move = movePhrase(supplierMove(supplier.ageBucket, weeks));
    lines.push(
      `- ${supplier.name}: ${move}; overdue ${moneyPlain(supplier.overdue)}, outstanding ${moneyPlain(supplier.outstanding)}, oldest bucket ${supplier.ageBucket || "n/a"}.${bills ? ` Bills: ${bills}.` : " Bill numbers were not on this pull."}`,
    );
  }
  if (snap.note) lines.push(snap.note);
  lines.push("Do not invent suppliers or bills beyond this list. Milōn does not send a payment or record a bill.");
  return lines.join("\n");
}

export function buildPayablesDraft(
  snap: PayablesSnapshot | null,
  runwayWeeks?: number | null,
): PayablesDraft | null {
  if (!snap || snap.status !== "applied" || snap.totalOverdue < 0.005) return null;
  const weeks = normalizeRunwayWeeks(runwayWeeks);
  const books = payablesSourceLabel(snap.source);
  const asOf = snap.asOf ? ` as of ${snap.asOf}` : "";
  const overdueSuppliers = snap.suppliers.filter((supplier) => supplier.overdue >= 0.005);
  const lines: string[] = [];
  overdueSuppliers.slice(0, 8).forEach((supplier, index) => {
    const move = movePhrase(supplierMove(supplier.ageBucket, weeks));
    const bills = supplier.bills
      .filter((bill) => !bill.ageBucket || !isCurrentTitle(bill.ageBucket))
      .slice(0, 4);
    const refs = bills.length
      ? ` Bills: ${bills
          .map((bill) => `${bill.reference} (${moneyPlain(bill.amount)}${bill.ageBucket ? `, ${bill.ageBucket}` : ""})`)
          .join("; ")}.`
      : " Bill numbers were not on this report — name the supplier and the age bucket only.";
    lines.push(
      `${index + 1}. ${supplier.name} — ${move} — overdue ${moneyPlain(supplier.overdue)} (${supplier.ageBucket || "aged"}).${refs}`,
    );
  });
  const depth = snap.billCount
    ? "Bill references are the ones printed on that report."
    : "This pull has supplier totals and age buckets. It does not have bill numbers, so the script does not invent them.";
  const overduePlain = moneyPlain(snap.totalOverdue);
  const rationale = [
    `Aged payables from ${books}${asOf}. This is the books' ageing report, not a second ledger. Milōn does not send a payment or record a bill.`,
    "",
    "Pay, delay, or renegotiate this week:",
    ...lines,
    "",
    runwayParagraph(weeks, overduePlain),
    `Outstanding on the report: ${moneyPlain(snap.totalOutstanding)}. Overdue: ${overduePlain}. Suppliers: ${snap.supplierCount}. Bill lines: ${snap.billCount}.`,
    depth,
    snap.note ?? "",
    "Statement creditor days are a separate total. Use them as context, not as a named supplier.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const evidence: PayablesDraft["evidence"] = [];
  for (const supplier of overdueSuppliers.slice(0, 8)) {
    evidence.push({
      kind: "transaction",
      key: `${snap.source}:supplier:${supplier.supplierId}`.slice(0, 120),
      label: `${supplier.name} · ${supplier.ageBucket || "overdue"}`.slice(0, 200),
      value: supplier.overdue,
    });
    for (const bill of supplier.bills.slice(0, 2)) {
      if (evidence.length >= 16) break;
      evidence.push({
        kind: "transaction",
        key: `${snap.source}:bill:${bill.billId || bill.reference}`.slice(0, 120),
        label: `${bill.reference} · ${supplier.name}`.slice(0, 200),
        value: bill.amount,
      });
    }
  }

  const runwayAssumption =
    weeks == null
      ? "No cash-runway figure is stored on the forecast. This draft does not quote weeks of cash."
      : `Cash runway already on file: ${weeksLabel(weeks)}. This draft does not invent a different figure.`;

  return {
    title: PAYABLES_TITLE,
    problem: `${books} aged payables${asOf} show ${overduePlain} overdue across ${overdueSuppliers.length} suppliers.`,
    rationale,
    assumptions: [
      `Read from the ${books} aged payables report${asOf}. Milōn does not send a payment or record a bill.`.slice(0, 300),
      depth.slice(0, 300),
      runwayAssumption.slice(0, 300),
      ...(snap.note ? [snap.note.slice(0, 300)] : []),
    ],
    evidence,
    priority: "high",
    dataDepth: "transaction",
    expectedImpact: {
      metric: "cash",
      amount: snap.totalOverdue,
      horizonDays: 30,
      note: "Illustrative: overdue on the aged payables report. Delaying it keeps that cash; paying it spends it. Not a forecast.",
    },
  };
}
