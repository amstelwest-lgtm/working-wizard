/**
 * Aged receivables parsers, chase draft, and sync-card proof.
 * Run: pnpm test:collections
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  agedArProofLine,
  ageBucketFromDue,
  attachQboInvoiceDetail,
  buildCollectionsDraft,
  chooseCollections,
  collectionsPromptBlock,
  finalizeCollections,
  parseQboAgedReceivables,
  parseXeroAgedReceivablesByContact,
  parseXeroContactsPage,
  readCollectionsSnapshot,
  selectXeroContactsForAging,
  type CollectionsSnapshot,
} from "../src/lib/collections";
import {
  buildCollectionsDraft as edgeDraft,
  collectionsPromptBlock as edgeBlock,
  readCollectionsSnapshot as edgeRead,
} from "../supabase/functions/brain-propose/collections.ts";
import { checkRootCauseClaims } from "../src/lib/recommendations";
import { deliverableHandoff } from "../src/lib/workflow-coach";
import { xeroScopes } from "../src/lib/xero";
import { QBO_ACCOUNTING_SCOPE } from "../src/lib/qbo";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const xeroReport = {
  Reports: [
    {
      Rows: [
        {
          RowType: "Header",
          Cells: [
            { Value: "" },
            { Value: "Current" },
            { Value: "< 1 Month" },
            { Value: "1 Month" },
            { Value: "2 Months" },
            { Value: "3 Months" },
            { Value: "Older" },
          ],
        },
        {
          RowType: "Section",
          Rows: [
            {
              RowType: "Row",
              Cells: [
                {
                  Value: "INV-1042",
                  Attributes: [{ Id: "invoiceID", Value: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
                },
                { Value: "" },
                { Value: "" },
                { Value: "2100.00" },
                { Value: "" },
                { Value: "" },
                { Value: "" },
              ],
            },
            {
              RowType: "Row",
              Cells: [
                { Value: "INV-1048" },
                { Value: "500.00" },
                { Value: "" },
                { Value: "" },
                { Value: "" },
                { Value: "" },
                { Value: "" },
              ],
            },
          ],
        },
        {
          RowType: "Section",
          Title: "Total",
          Rows: [
            {
              RowType: "SummaryRow",
              Cells: [
                { Value: "Total" },
                { Value: "500.00" },
                { Value: "0.00" },
                { Value: "2100.00" },
                { Value: "0.00" },
                { Value: "0.00" },
                { Value: "0.00" },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const northwind = parseXeroAgedReceivablesByContact(xeroReport, {
  contactId: "c-1",
  name: "Northwind Traders",
});
assert(northwind != null, "xero contact parsed");
eq(northwind?.outstanding, 2600, "xero outstanding");
eq(northwind?.overdue, 2100, "xero overdue excludes current");
eq(northwind?.ageBucket, "1 Month", "oldest non-zero bucket");
eq(northwind?.invoices.length, 2, "two invoice rows");
eq(northwind?.invoices[0]?.invoiceId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "invoice id from the report");
eq(northwind?.invoices[0]?.reference, "INV-1042", "invoice reference");

const contacts = parseXeroContactsPage({
  Contacts: [
    {
      ContactID: "c-1",
      Name: "Northwind Traders",
      IsCustomer: true,
      ContactStatus: "ACTIVE",
      UpdatedDateUTC: "/Date(1700000000000+0000)/",
      Balances: { AccountsReceivable: { Outstanding: 2600, Overdue: 2100 } },
    },
    { ContactID: "s-1", Name: "Supplier Co", IsCustomer: false, IsSupplier: true },
    { ContactID: "z-1", Name: "Zero Ltd", IsCustomer: true, Balances: { AccountsReceivable: { Outstanding: 0, Overdue: 0 } } },
  ],
});
eq(contacts.length, 2, "suppliers dropped");
const picked = selectXeroContactsForAging(contacts, 40);
eq(picked.selected.length, 1, "zero balance not aged when balances are present");
eq(picked.selected[0]?.name, "Northwind Traders", "owing contact kept");
eq(picked.note, null, "no truncation note");

const noBalances = selectXeroContactsForAging(
  [
    { contactId: "a", name: "A", isCustomer: true, updatedMs: 1, outstanding: null, overdue: null, hasBalances: false },
    { contactId: "b", name: "B", isCustomer: true, updatedMs: 9, outstanding: null, overdue: null, hasBalances: false },
  ],
  1,
);
eq(noBalances.selected[0]?.contactId, "b", "without balances, most recently updated is aged");
assert(noBalances.note?.includes("most recently updated"), "cap is honest");

const snap = finalizeCollections({
  source: "xero",
  asOf: "2026-09-22",
  syncedAt: "2026-09-26T12:00:00.000Z",
  contacts: northwind ? [northwind] : [],
});
eq(snap.status, "applied", "applied when someone owes");
eq(agedArProofLine(snap), "Aged receivables as of 2026-09-22 · 1 contact · 2 invoices", "proof line");
eq(agedArProofLine(null), "Aged receivables appear after the next Sync", "pending proof");

const empty = finalizeCollections({
  source: "xero",
  asOf: "2026-09-22",
  syncedAt: "2026-09-26T12:00:00.000Z",
  contacts: [],
});
eq(empty.status, "empty", "empty report");
assert(agedArProofLine(empty).includes("nothing outstanding"), "empty proof");

const draft = buildCollectionsDraft(snap);
assert(draft != null, "overdue produces a draft");
assert(draft?.rationale.includes("Northwind Traders"), "draft names the contact");
assert(draft?.rationale.includes("INV-1042"), "draft cites the invoice");
assert(draft?.rationale.includes("does not email"), "draft does not pretend to send");
eq(draft?.dataDepth, "transaction", "named chase is transaction depth");
assert(
  checkRootCauseClaims({
    data_depth: "transaction",
    title: draft?.title,
    problem: draft?.problem,
    rationale: draft?.rationale,
  }).ok,
  "transaction-depth draft passes the claim check",
);
assert(
  !checkRootCauseClaims({
    data_depth: "statement",
    title: draft?.title,
    rationale: draft?.rationale,
  }).ok,
  "the same words would be refused at statement depth",
);
assert((draft?.evidence.length ?? 0) >= 2, "contact and invoice evidence");
eq(buildCollectionsDraft(empty), null, "nothing overdue, no chase draft");

const roundTrip = readCollectionsSnapshot(snap);
eq(roundTrip?.contactCount, 1, "cache round trip");
const edgeSnap = edgeRead(snap);
eq(JSON.stringify(edgeDraft(edgeSnap)), JSON.stringify(buildCollectionsDraft(snap)), "edge draft matches the app");
eq(edgeBlock(edgeSnap), collectionsPromptBlock(snap), "edge prompt block matches the app");

const qboSummary = {
  Header: { EndPeriod: "2026-09-22" },
  Columns: {
    Column: [
      { ColTitle: "", ColType: "Customer" },
      { ColTitle: "Current", ColType: "Money" },
      { ColTitle: "1 - 30", ColType: "Money" },
      { ColTitle: "31 - 60", ColType: "Money" },
      { ColTitle: "61 - 90", ColType: "Money" },
      { ColTitle: "91 and over", ColType: "Money" },
      { ColTitle: "Total", ColType: "Money" },
    ],
  },
  Rows: {
    Row: [
      {
        ColData: [
          { value: "Amy's Bird Sanctuary", id: "1" },
          { value: "100.00" },
          { value: "239.00" },
          { value: "0.00" },
          { value: "0.00" },
          { value: "450.00" },
          { value: "789.00" },
        ],
      },
      {
        group: "GrandTotal",
        Summary: {
          ColData: [{ value: "TOTAL" }, { value: "100.00" }, { value: "239.00" }, { value: "" }, { value: "" }, { value: "450.00" }, { value: "789.00" }],
        },
      },
    ],
  },
};
const qboContacts = parseQboAgedReceivables(qboSummary, "2026-09-22");
eq(qboContacts.length, 1, "qbo skips the grand total");
eq(qboContacts[0]?.outstanding, 789, "qbo outstanding from buckets, not a shifted total");
eq(qboContacts[0]?.overdue, 689, "qbo overdue");
eq(qboContacts[0]?.ageBucket, "91 and over", "qbo oldest bucket");

const withInvoices = attachQboInvoiceDetail(
  qboContacts,
  {
    Columns: {
      Column: [
        { ColTitle: "Date" },
        { ColTitle: "Transaction Type" },
        { ColTitle: "Num" },
        { ColTitle: "Due Date" },
        { ColTitle: "Amount" },
        { ColTitle: "Open Balance" },
      ],
    },
    Rows: {
      Row: [
        {
          Header: { ColData: [{ value: "Amy's Bird Sanctuary", id: "1" }] },
          Rows: {
            Row: [
              {
                ColData: [
                  { value: "2026-06-01" },
                  { value: "Invoice" },
                  { value: "1042", id: "inv-1" },
                  { value: "2026-07-01" },
                  { value: "450.00" },
                  { value: "450.00" },
                ],
              },
              {
                ColData: [
                  { value: "2026-09-01" },
                  { value: "Payment" },
                  { value: "9" },
                  { value: "" },
                  { value: "10.00" },
                  { value: "10.00" },
                ],
              },
            ],
          },
        },
      ],
    },
  },
  "2026-09-22",
);
eq(withInvoices[0]?.invoices.length, 1, "payments are not chase evidence");
eq(withInvoices[0]?.invoices[0]?.reference, "1042", "qbo invoice number");
eq(ageBucketFromDue("2026-07-01", "2026-09-22"), "61–90 days", "due date ages against the report date");

const newerEmpty: CollectionsSnapshot = {
  ...empty,
  syncedAt: "2026-09-27T00:00:00.000Z",
  source: "qbo",
};
const chosen = chooseCollections([newerEmpty, snap]);
eq(chosen?.source, "xero", "an applied chase list beats a newer empty pull");

const handoff = deliverableHandoff("Who is on the aged receivables chase list?");
eq(handoff?.tab, "collections", "bot hands collections questions to the chase list");
eq(deliverableHandoff("Will the 13-week cash forecast go negative?")?.tab, "cash", "cash questions stay on cash");

assert(xeroScopes().includes("accounting.reports.aged.read"), "aged scope requested");
assert(xeroScopes().includes("accounting.contacts.read"), "contacts read requested");
assert(!xeroScopes().includes("accounting.invoices"), "no invoice scope");
assert(!xeroScopes().includes("accounting.banktransactions"), "no bank transaction scope");
eq(QBO_ACCOUNTING_SCOPE, "com.intuit.quickbooks.accounting", "qbo stays on the accounting scope");

const fn = readFileSync(resolve("src/lib/xero.functions.ts"), "utf8");
assert(fn.includes('data_type: "aged_ar"'), "xero sync caches aged receivables on its own row");
assert(fn.includes("fetchXeroAgedReceivables"), "xero sync fetches the report");
const qboFn = readFileSync(resolve("src/lib/qbo.functions.ts"), "utf8");
assert(qboFn.includes('data_type: "aged_ar"'), "qbo sync caches aged receivables on its own row");
const card = readFileSync(resolve("src/components/xero-connect.tsx"), "utf8");
assert(card.includes('id="xero-aged-ar-status"'), "xero card shows aged receivables proof");
const qboCard = readFileSync(resolve("src/components/qbo-connect.tsx"), "utf8");
assert(qboCard.includes('id="qbo-aged-ar-status"'), "qbo card shows aged receivables proof");
const rail = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(rail.includes('label: "Collections"'), "collections is a deliverable rail item");
const propose = readFileSync(resolve("supabase/functions/brain-propose/index.ts"), "utf8");
assert(propose.includes("buildCollectionsDraft"), "propose files a collections draft from the cache");
assert(propose.includes('source: "ai", data_depth: "statement"'), "statement drafts stay statement depth");
assert(propose.includes("dropOverclaimingSteps(payload.next_steps)"), "ungrounded invoice claims are still dropped");

console.log("collections-test ok");
