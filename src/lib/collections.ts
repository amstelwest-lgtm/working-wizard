/**
 * Aged receivables chase list — pure parsers and drafts.
 * Xero and QuickBooks sync write this shape into `*_sync_data.data_type = 'aged_ar'`.
 * Milōn reads the books. It does not send chases or record receipts.
 */

export type CollectionsSource = "xero" | "qbo";
export type CollectionsStatus = "applied" | "empty" | "skipped";

export type CollectionsInvoice = {
  invoiceId: string | null;
  reference: string;
  dueDate: string | null;
  amount: number;
  ageBucket: string;
};

export type CollectionsContact = {
  contactId: string;
  name: string;
  outstanding: number;
  overdue: number;
  ageBucket: string;
  buckets: { label: string; amount: number }[];
  invoices: CollectionsInvoice[];
};

export type CollectionsSnapshot = {
  version: 1;
  source: CollectionsSource;
  status: CollectionsStatus;
  asOf: string | null;
  syncedAt: string;
  skipReason: string | null;
  note: string | null;
  contactCount: number;
  invoiceCount: number;
  totalOutstanding: number;
  totalOverdue: number;
  contacts: CollectionsContact[];
};

export type XeroContactCandidate = {
  contactId: string;
  name: string;
  isCustomer: boolean;
  updatedMs: number;
  /** Null when the contact list omitted balances. */
  outstanding: number | null;
  overdue: number | null;
  hasBalances: boolean;
};

const SOURCES = new Set<CollectionsSource>(["xero", "qbo"]);
const STATUSES = new Set<CollectionsStatus>(["applied", "empty", "skipped"]);

export const XERO_AGED_RECONNECT =
  "Aged receivables need a reconnect. Enable accounting.reports.aged.read and accounting.contacts.read on the Xero app, then disconnect and connect again.";

export const AGED_AR_PENDING = "Aged receivables appear after the next Sync";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseReportMoney(raw: string): number {
  const text = raw.trim();
  if (!text || text === "-" || text === "–") return 0;
  const paren = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[(),\s]/g, "").replace(/[$R]/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return paren ? -Math.abs(n) : n;
}

function moneyOrZero(n: number): number {
  return Number.isFinite(n) ? round2(n) : 0;
}

type BucketDraft = { label: string; amount: number; current: boolean };

function oldestBucket(buckets: BucketDraft[]): string {
  for (let i = buckets.length - 1; i >= 0; i--) {
    const bucket = buckets[i];
    if (bucket.current) continue;
    if (Math.abs(bucket.amount) >= 0.005) return bucket.label;
  }
  const current = buckets.find((bucket) => bucket.current && Math.abs(bucket.amount) >= 0.005);
  return current?.label ?? "Current";
}

function publicBuckets(buckets: BucketDraft[]): { label: string; amount: number }[] {
  return buckets.map((bucket) => ({ label: bucket.label, amount: moneyOrZero(bucket.amount) }));
}

function totalsFromBuckets(buckets: BucketDraft[]): { outstanding: number; overdue: number; ageBucket: string } {
  const outstanding = moneyOrZero(buckets.reduce((sum, bucket) => sum + bucket.amount, 0));
  const current = buckets.filter((bucket) => bucket.current).reduce((sum, bucket) => sum + bucket.amount, 0);
  const overdue = moneyOrZero(outstanding - current);
  return { outstanding, overdue: overdue > 0 ? overdue : 0, ageBucket: oldestBucket(buckets) };
}

export function finalizeCollections(input: {
  source: CollectionsSource;
  asOf: string | null;
  syncedAt: string;
  contacts: CollectionsContact[];
  note?: string | null;
}): CollectionsSnapshot {
  const contacts = [...input.contacts]
    .filter((contact) => contact.name.trim() && Math.abs(contact.outstanding) >= 0.005)
    .sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
  const invoiceCount = contacts.reduce((sum, contact) => sum + contact.invoices.length, 0);
  const totalOutstanding = moneyOrZero(contacts.reduce((sum, contact) => sum + contact.outstanding, 0));
  const totalOverdue = moneyOrZero(contacts.reduce((sum, contact) => sum + contact.overdue, 0));
  const status: CollectionsStatus = contacts.length ? "applied" : "empty";
  return {
    version: 1,
    source: input.source,
    status,
    asOf: input.asOf,
    syncedAt: input.syncedAt,
    skipReason: null,
    note: input.note?.trim() || null,
    contactCount: contacts.length,
    invoiceCount,
    totalOutstanding,
    totalOverdue,
    contacts,
  };
}

export function skippedCollections(input: {
  source: CollectionsSource;
  asOf: string | null;
  syncedAt: string;
  skipReason: string;
}): CollectionsSnapshot {
  return {
    version: 1,
    source: input.source,
    status: "skipped",
    asOf: input.asOf,
    syncedAt: input.syncedAt,
    skipReason: input.skipReason.trim() || "Aged receivables were not applied",
    note: null,
    contactCount: 0,
    invoiceCount: 0,
    totalOutstanding: 0,
    totalOverdue: 0,
    contacts: [],
  };
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readInvoice(raw: unknown): CollectionsInvoice | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const reference = typeof row.reference === "string" ? row.reference.trim() : "";
  if (!reference) return null;
  const amount = numOrNull(row.amount);
  return {
    invoiceId: typeof row.invoiceId === "string" && row.invoiceId ? row.invoiceId : null,
    reference,
    dueDate: typeof row.dueDate === "string" && row.dueDate ? row.dueDate : null,
    amount: amount ?? 0,
    ageBucket: typeof row.ageBucket === "string" ? row.ageBucket : "",
  };
}

function readContact(raw: unknown): CollectionsContact | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const contactId = typeof row.contactId === "string" ? row.contactId : "";
  if (!name || !contactId) return null;
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
  const invoices = Array.isArray(row.invoices)
    ? row.invoices.flatMap((invoice) => {
        const parsed = readInvoice(invoice);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    contactId,
    name,
    outstanding: numOrNull(row.outstanding) ?? 0,
    overdue: numOrNull(row.overdue) ?? 0,
    ageBucket: typeof row.ageBucket === "string" ? row.ageBucket : "",
    buckets,
    invoices,
  };
}

export function readCollectionsSnapshot(raw: unknown): CollectionsSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.version !== 1) return null;
  const source = row.source;
  const status = row.status;
  if (typeof source !== "string" || !SOURCES.has(source as CollectionsSource)) return null;
  if (typeof status !== "string" || !STATUSES.has(status as CollectionsStatus)) return null;
  const contacts = Array.isArray(row.contacts)
    ? row.contacts.flatMap((contact) => {
        const parsed = readContact(contact);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    version: 1,
    source: source as CollectionsSource,
    status: status as CollectionsStatus,
    asOf: typeof row.asOf === "string" && row.asOf ? row.asOf : null,
    syncedAt: typeof row.syncedAt === "string" ? row.syncedAt : "",
    skipReason: typeof row.skipReason === "string" && row.skipReason.trim() ? row.skipReason : null,
    note: typeof row.note === "string" && row.note.trim() ? row.note : null,
    contactCount: numOrNull(row.contactCount) ?? contacts.length,
    invoiceCount: numOrNull(row.invoiceCount) ?? contacts.reduce((sum, c) => sum + c.invoices.length, 0),
    totalOutstanding: numOrNull(row.totalOutstanding) ?? 0,
    totalOverdue: numOrNull(row.totalOverdue) ?? 0,
    contacts,
  };
}

export function chooseCollections(
  rows: Array<CollectionsSnapshot | null | undefined>,
): CollectionsSnapshot | null {
  const present = rows.filter((row): row is CollectionsSnapshot => row != null);
  if (!present.length) return null;
  const usable = present.filter((row) => row.status === "applied" || row.status === "empty");
  const pool = usable.length ? usable : present;
  return [...pool].sort((a, b) => {
    const rank = (snap: CollectionsSnapshot) =>
      snap.status === "applied" ? 2 : snap.status === "empty" ? 1 : 0;
    const byStatus = rank(b) - rank(a);
    if (byStatus !== 0) return byStatus;
    return (b.syncedAt || "").localeCompare(a.syncedAt || "");
  })[0];
}

export function sourceLabel(source: CollectionsSource): string {
  return source === "xero" ? "Xero" : "QuickBooks";
}

export function agedArProofLine(snap: CollectionsSnapshot | null | undefined): string {
  if (!snap) return AGED_AR_PENDING;
  if (snap.status === "skipped") return snap.skipReason ?? "Aged receivables were not applied";
  const when = snap.asOf ? `as of ${snap.asOf}` : "applied";
  if (snap.status === "empty" || snap.contactCount === 0) {
    return `Aged receivables ${when} · nothing outstanding`;
  }
  const contacts = `${snap.contactCount} contact${snap.contactCount === 1 ? "" : "s"}`;
  const invoices =
    snap.invoiceCount > 0
      ? ` · ${snap.invoiceCount} invoice${snap.invoiceCount === 1 ? "" : "s"}`
      : " · invoice numbers not on this report";
  return `Aged receivables ${when} · ${contacts}${invoices}`;
}

// ─── Xero contacts + AgedReceivablesByContact ────────────────────────────────

function xeroUpdatedMs(raw: unknown): number {
  if (typeof raw !== "string" || !raw) return 0;
  const stamped = /\/Date\((\d+)/.exec(raw);
  if (stamped) return Number(stamped[1]);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseXeroContactsPage(json: unknown): XeroContactCandidate[] {
  if (!json || typeof json !== "object") return [];
  const rows = (json as { Contacts?: unknown }).Contacts;
  if (!Array.isArray(rows)) return [];
  const out: XeroContactCandidate[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const contactId = typeof row.ContactID === "string" ? row.ContactID : "";
    const name = typeof row.Name === "string" ? row.Name.trim() : "";
    if (!contactId || !name) continue;
    const status = typeof row.ContactStatus === "string" ? row.ContactStatus.toUpperCase() : "ACTIVE";
    if (status === "ARCHIVED") continue;
    const isCustomer = row.IsCustomer !== false;
    if (!isCustomer) continue;
    const balances =
      row.Balances && typeof row.Balances === "object"
        ? (row.Balances as { AccountsReceivable?: { Outstanding?: unknown; Overdue?: unknown } })
        : null;
    const ar = balances?.AccountsReceivable;
    const hasBalances = Boolean(ar && (ar.Outstanding != null || ar.Overdue != null));
    out.push({
      contactId,
      name,
      isCustomer: true,
      updatedMs: xeroUpdatedMs(row.UpdatedDateUTC),
      outstanding: hasBalances ? numOrNull(ar?.Outstanding) : null,
      overdue: hasBalances ? numOrNull(ar?.Overdue) : null,
      hasBalances,
    });
  }
  return out;
}

export function selectXeroContactsForAging(
  contacts: XeroContactCandidate[],
  cap: number,
): { selected: XeroContactCandidate[]; note: string | null } {
  const limit = Math.max(1, cap);
  const withBalances = contacts.some((contact) => contact.hasBalances);
  if (withBalances) {
    const owing = contacts
      .filter((contact) => (contact.outstanding ?? 0) >= 0.005 || (contact.overdue ?? 0) >= 0.005)
      .sort(
        (a, b) =>
          (b.overdue ?? 0) - (a.overdue ?? 0) || (b.outstanding ?? 0) - (a.outstanding ?? 0),
      );
    if (owing.length > limit) {
      return {
        selected: owing.slice(0, limit),
        note: `Showing the ${limit} largest balances. Other customers with a balance were not aged this sync.`,
      };
    }
    return { selected: owing, note: null };
  }
  const recent = [...contacts].sort((a, b) => b.updatedMs - a.updatedMs);
  if (recent.length > limit) {
    return {
      selected: recent.slice(0, limit),
      note: `Contact balances were not on the Xero list, so this sync aged the ${limit} most recently updated customers.`,
    };
  }
  return {
    selected: recent,
    note: recent.length
      ? "Xero's contact list has no balances, so every customer returned was aged."
      : null,
  };
}

type XeroCell = { Value?: string; Attributes?: Array<{ Id?: string; Value?: string }> };
type XeroRow = { RowType?: string; Title?: string; Cells?: XeroCell[]; Rows?: XeroRow[] };

function walkXero(rows: XeroRow[] | undefined, visit: (row: XeroRow) => void) {
  if (!rows) return;
  for (const row of rows) {
    visit(row);
    if (row.Rows?.length) walkXero(row.Rows, visit);
  }
}

function cellText(cells: XeroCell[] | undefined, index: number): string {
  return String(cells?.[index]?.Value ?? "").trim();
}

function invoiceIdFrom(cell: XeroCell | undefined): string | null {
  const attrs = cell?.Attributes;
  if (!Array.isArray(attrs)) return null;
  for (const attr of attrs) {
    const id = typeof attr?.Id === "string" ? attr.Id : "";
    if (!/invoice/i.test(id)) continue;
    return typeof attr?.Value === "string" && attr.Value ? attr.Value : null;
  }
  return null;
}

function isCurrentTitle(title: string): boolean {
  return title.trim().toLowerCase() === "current" || title.trim().toLowerCase().startsWith("current ");
}

function isTotalTitle(title: string): boolean {
  return /^total\b/i.test(title.trim());
}

export function parseXeroAgedReceivablesByContact(
  json: unknown,
  contact: { contactId: string; name: string },
): CollectionsContact | null {
  const report = (json as { Reports?: Array<{ Rows?: XeroRow[] }> } | null)?.Reports?.[0];
  const rows = report?.Rows ?? [];
  let header: XeroRow | undefined;
  walkXero(rows, (row) => {
    if (header) return;
    if ((row.RowType ?? "").toLowerCase() === "header") header = row;
  });
  const titles = (header?.Cells ?? []).map((cell) => String(cell?.Value ?? "").trim());
  const columns: Array<{ index: number; label: string; current: boolean; total: boolean }> = [];
  titles.forEach((label, index) => {
    if (index === 0 || !label) return;
    columns.push({
      index,
      label,
      current: isCurrentTitle(label),
      total: isTotalTitle(label),
    });
  });
  const aging = columns.filter((column) => !column.total);

  const invoices: CollectionsInvoice[] = [];
  let summary: BucketDraft[] | null = null;
  walkXero(rows, (row) => {
    const type = (row.RowType ?? "").toLowerCase();
    if (type !== "row" && type !== "summaryrow") return;
    const label = cellText(row.Cells, 0);
    if (!label || /^total\b/i.test(label)) {
      if (type === "summaryrow" || /^total\b/i.test(label)) {
        summary = aging.map((column) => ({
          label: column.label,
          amount: parseReportMoney(cellText(row.Cells, column.index)),
          current: column.current,
        }));
      }
      return;
    }
    if (type === "summaryrow") return;
    const buckets = aging.map((column) => ({
      label: column.label,
      amount: parseReportMoney(cellText(row.Cells, column.index)),
      current: column.current,
    }));
    const amount = moneyOrZero(buckets.reduce((sum, bucket) => sum + bucket.amount, 0));
    if (Math.abs(amount) < 0.005) return;
    invoices.push({
      invoiceId: invoiceIdFrom(row.Cells?.[0]),
      reference: label,
      dueDate: null,
      amount,
      ageBucket: oldestBucket(buckets),
    });
  });

  const buckets = summary ?? sumInvoiceBuckets(invoices, aging);
  if (!buckets.length && !invoices.length) return null;
  const totals = buckets.length
    ? totalsFromBuckets(buckets)
    : {
        outstanding: moneyOrZero(invoices.reduce((sum, invoice) => sum + invoice.amount, 0)),
        overdue: moneyOrZero(
          invoices
            .filter((invoice) => invoice.ageBucket && !isCurrentTitle(invoice.ageBucket))
            .reduce((sum, invoice) => sum + invoice.amount, 0),
        ),
        ageBucket: invoices[0]?.ageBucket || "Current",
      };
  if (Math.abs(totals.outstanding) < 0.005 && invoices.length === 0) return null;
  return {
    contactId: contact.contactId,
    name: contact.name.trim(),
    outstanding: totals.outstanding,
    overdue: totals.overdue,
    ageBucket: totals.ageBucket,
    buckets: publicBuckets(buckets),
    invoices,
  };
}

function sumInvoiceBuckets(
  invoices: CollectionsInvoice[],
  aging: Array<{ label: string; current: boolean }>,
): BucketDraft[] {
  if (!invoices.length || !aging.length) return [];
  return aging.map((column) => ({
    label: column.label,
    current: column.current,
    amount: moneyOrZero(
      invoices
        .filter((invoice) => invoice.ageBucket === column.label)
        .reduce((sum, invoice) => sum + invoice.amount, 0),
    ),
  }));
}

// ─── QuickBooks AgedReceivables + detail ─────────────────────────────────────

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

export function parseQboAgedReceivables(json: unknown, asOf: string): CollectionsContact[] {
  const report = asQboReport(json);
  const columns = qboColumns(report);
  const aging = columns.filter((column, index) => {
    if (index === 0) return false;
    if (column.type === "customer") return false;
    if (isTotalTitle(column.title)) return false;
    return true;
  });
  const contacts: CollectionsContact[] = [];
  walkQbo(report.Rows?.Row, (row) => {
    if ((row.group ?? "").toLowerCase() === "grandtotal") return;
    const cells = row.ColData;
    if (!cells?.length) return;
    const name = String(cells[0]?.value ?? "").trim();
    if (!name || /^total\b/i.test(name)) return;
    const buckets: BucketDraft[] = aging.map((column) => ({
      label: column.title || "Amount",
      amount: parseReportMoney(String(cells[column.index]?.value ?? "")),
      current: isCurrentTitle(column.title),
    }));
    const totals = totalsFromBuckets(buckets);
    if (Math.abs(totals.outstanding) < 0.005) return;
    contacts.push({
      contactId: cells[0]?.id || name,
      name,
      outstanding: totals.outstanding,
      overdue: totals.overdue,
      ageBucket: totals.ageBucket,
      buckets: publicBuckets(buckets),
      invoices: [],
    });
  });
  void asOf;
  return contacts;
}

function isoDate(raw: string): string | null {
  const text = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function ageBucketFromDue(due: string | null, asOf: string): string {
  if (!due || !asOf) return "";
  const dueMs = Date.parse(`${due}T00:00:00Z`);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(dueMs) || !Number.isFinite(asOfMs)) return "";
  const days = Math.round((asOfMs - dueMs) / 86_400_000);
  if (days <= 0) return "Current";
  if (days <= 30) return "1–30 days";
  if (days <= 60) return "31–60 days";
  if (days <= 90) return "61–90 days";
  return "91+ days";
}

export function attachQboInvoiceDetail(
  contacts: CollectionsContact[],
  json: unknown,
  asOf: string,
): CollectionsContact[] {
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
  const byId = new Map(contacts.map((contact) => [contact.contactId, contact]));
  const byName = new Map(contacts.map((contact) => [contact.name.toLowerCase(), contact]));
  const invoices = new Map<string, CollectionsInvoice[]>();

  walkQbo(report.Rows?.Row, (row, header) => {
    const cells = row.ColData;
    if (!cells?.length || !header) return;
    const txn = cellTextQbo(cells, typeIdx).toLowerCase();
    if (txn && !txn.includes("invoice")) return;
    const open = parseReportMoney(cellTextQbo(cells, openIdx));
    if (Math.abs(open) < 0.005) return;
    const reference = cellTextQbo(cells, numIdx) || cellTextQbo(cells, 0);
    if (!reference || /^total\b/i.test(reference)) return;
    const due = isoDate(cellTextQbo(cells, dueIdx));
    const contact =
      (header.id && byId.get(header.id)) || byName.get(header.name.toLowerCase()) || null;
    if (!contact) return;
    const list = invoices.get(contact.contactId) ?? [];
    list.push({
      invoiceId: cells[numIdx]?.id || cells[0]?.id || null,
      reference,
      dueDate: due,
      amount: moneyOrZero(open),
      ageBucket: ageBucketFromDue(due, asOf),
    });
    invoices.set(contact.contactId, list);
  });

  return contacts.map((contact) => ({
    ...contact,
    invoices: invoices.get(contact.contactId) ?? [],
  }));
}

function cellTextQbo(cells: QboCell[], index: number): string {
  return String(cells[index]?.value ?? "").trim();
}

export function qboAgedSkipReason(message: string): string {
  if (/\b(401|403)\b/.test(message)) {
    return "QuickBooks did not return Aged Receivables for this connection. Accounting scope is already requested — reconnect QuickBooks if this persists.";
  }
  const clean = message.replace(/\s+/g, " ").trim();
  return `Aged receivables were not applied. ${clean.slice(0, 180)}`.trim();
}

// ─── Bot / Action Plan draft ──────────────────────────────────────────────────

export type CollectionsDraft = {
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

const COLLECTIONS_TITLE = "Chase overdue receivables from the aged report";

function moneyPlain(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function collectionsPromptBlock(snap: CollectionsSnapshot | null): string {
  if (!snap || snap.status !== "applied" || snap.contacts.length === 0) return "";
  const lines = [
    `Aged receivables (${sourceLabel(snap.source)}${snap.asOf ? `, as of ${snap.asOf}` : ""}):`,
    `Overdue total: ${moneyPlain(snap.totalOverdue)}. Outstanding total: ${moneyPlain(snap.totalOutstanding)}. Contacts: ${snap.contactCount}. Invoice lines: ${snap.invoiceCount}.`,
  ];
  for (const contact of snap.contacts.slice(0, 8)) {
    const invoices = contact.invoices
      .slice(0, 4)
      .map((invoice) => `${invoice.reference} (${moneyPlain(invoice.amount)}${invoice.ageBucket ? `, ${invoice.ageBucket}` : ""})`)
      .join("; ");
    lines.push(
      `- ${contact.name}: overdue ${moneyPlain(contact.overdue)}, outstanding ${moneyPlain(contact.outstanding)}, oldest bucket ${contact.ageBucket || "n/a"}.${invoices ? ` Invoices: ${invoices}.` : " Invoice numbers were not on this pull."}`,
    );
  }
  if (snap.note) lines.push(snap.note);
  lines.push("Do not invent customers or invoices beyond this list. Milōn does not send the chase or record the receipt.");
  return lines.join("\n");
}

export function buildCollectionsDraft(snap: CollectionsSnapshot | null): CollectionsDraft | null {
  if (!snap || snap.status !== "applied" || snap.totalOverdue < 0.005) return null;
  const books = sourceLabel(snap.source);
  const asOf = snap.asOf ? ` as of ${snap.asOf}` : "";
  const lines: string[] = [];
  snap.contacts
    .filter((contact) => contact.overdue >= 0.005)
    .slice(0, 8)
    .forEach((contact, index) => {
      const invoices = contact.invoices
        .filter((invoice) => !invoice.ageBucket || !isCurrentTitle(invoice.ageBucket))
        .slice(0, 4);
      const refs = invoices.length
        ? ` Invoices: ${invoices
            .map((invoice) => `${invoice.reference} (${moneyPlain(invoice.amount)}${invoice.ageBucket ? `, ${invoice.ageBucket}` : ""})`)
            .join("; ")}.`
        : " Invoice numbers were not on this report — name the contact and the age bucket only.";
      lines.push(
        `${index + 1}. ${contact.name} — overdue ${moneyPlain(contact.overdue)} (${contact.ageBucket || "aged"}).${refs}`,
      );
    });
  const depth = snap.invoiceCount
    ? "Invoice references are the ones printed on that report."
    : "This pull has contact totals and age buckets. It does not have invoice numbers, so the script does not invent them.";
  const rationale = [
    `Aged receivables from ${books}${asOf}. This is the books' ageing report, not a second ledger. Milōn does not email the customer or record a receipt.`,
    "",
    "Chase this week:",
    ...lines,
    "",
    `Outstanding on the report: ${moneyPlain(snap.totalOutstanding)}. Overdue: ${moneyPlain(snap.totalOverdue)}. Contacts: ${snap.contactCount}. Invoice lines: ${snap.invoiceCount}.`,
    depth,
    snap.note ?? "",
    "Statement debtor days are a separate total. Use them as context, not as a named customer.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const evidence: CollectionsDraft["evidence"] = [];
  for (const contact of snap.contacts.filter((row) => row.overdue >= 0.005).slice(0, 8)) {
    evidence.push({
      kind: "transaction",
      key: `${snap.source}:contact:${contact.contactId}`.slice(0, 120),
      label: `${contact.name} · ${contact.ageBucket || "overdue"}`.slice(0, 200),
      value: contact.overdue,
    });
    for (const invoice of contact.invoices.slice(0, 2)) {
      if (evidence.length >= 16) break;
      const key = `${snap.source}:invoice:${invoice.invoiceId || invoice.reference}`.slice(0, 120);
      evidence.push({
        kind: "transaction",
        key,
        label: `${invoice.reference} · ${contact.name}`.slice(0, 200),
        value: invoice.amount,
      });
    }
  }

  return {
    title: COLLECTIONS_TITLE,
    problem: `${books} aged receivables${asOf} show ${moneyPlain(snap.totalOverdue)} overdue across ${snap.contacts.filter((c) => c.overdue >= 0.005).length} contacts.`,
    rationale,
    assumptions: [
      `Read from the ${books} aged receivables report${asOf}. Milōn does not send chase emails or record receipts.`.slice(0, 300),
      depth.slice(0, 300),
      ...(snap.note ? [snap.note.slice(0, 300)] : []),
    ],
    evidence,
    priority: "high",
    dataDepth: "transaction",
    expectedImpact: {
      metric: "cash",
      amount: snap.totalOverdue,
      horizonDays: 30,
      note: "Illustrative: the overdue balance on the aged report, not a forecast.",
    },
  };
}
