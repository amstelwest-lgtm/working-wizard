/**
 * Aged payables parsers, pay/delay/renegotiate draft, and sync-card proof.
 * Run: pnpm test:payables
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ageBucketFromDue } from "../src/lib/collections";
import {
  agedApProofLine,
  attachQboBillDetail,
  buildPayablesDraft,
  choosePayables,
  parseQboAgedPayables,
  parseXeroAgedPayablesByContact,
  parseXeroSuppliersPage,
  payablesPromptBlock,
  readPayablesSnapshot,
  selectXeroSuppliersForAging,
  supplierMove,
  type PayablesSnapshot,
} from "../src/lib/payables";
import {
  buildPayablesDraft as edgeDraft,
  payablesPromptBlock as edgeBlock,
  readPayablesSnapshot as edgeRead,
} from "../supabase/functions/brain-propose/payables.ts";
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
                  Value: "BILL-1042",
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
                { Value: "BILL-1048" },
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

const harbour = parseXeroAgedPayablesByContact(xeroReport, {
  contactId: "s-1",
  name: "Harbour Supplies",
});
assert(harbour != null, "xero supplier parsed");
eq(harbour?.outstanding, 2600, "xero outstanding");
eq(harbour?.overdue, 2100, "xero overdue excludes current");
eq(harbour?.ageBucket, "1 Month", "oldest non-zero bucket");
eq(harbour?.bills.length, 2, "two bill rows");
eq(harbour?.bills[0]?.billId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "bill id from the report");
eq(harbour?.bills[0]?.reference, "BILL-1042", "bill reference");

const suppliers = parseXeroSuppliersPage({
  Contacts: [
    {
      ContactID: "s-1",
      Name: "Harbour Supplies",
      IsSupplier: true,
      IsCustomer: false,
      ContactStatus: "ACTIVE",
      UpdatedDateUTC: "/Date(1700000000000+0000)/",
      Balances: { AccountsPayable: { Outstanding: 2600, Overdue: 2100 } },
    },
    { ContactID: "c-1", Name: "Northwind Traders", IsCustomer: true, IsSupplier: false },
    {
      ContactID: "z-1",
      Name: "Zero Ltd",
      IsSupplier: true,
      Balances: { AccountsPayable: { Outstanding: 0, Overdue: 0 } },
    },
  ],
});
eq(suppliers.length, 2, "customers dropped");
const picked = selectXeroSuppliersForAging(suppliers, 40);
eq(picked.selected.length, 1, "zero balance not aged when balances are present");
eq(picked.selected[0]?.name, "Harbour Supplies", "owing supplier kept");
eq(picked.note, null, "no truncation note");

const noBalances = selectXeroSuppliersForAging(
  [
    {
      contactId: "a",
      name: "A",
      isSupplier: true,
      updatedMs: 1,
      outstanding: null,
      overdue: null,
      hasBalances: false,
    },
    {
      contactId: "b",
      name: "B",
      isSupplier: true,
      updatedMs: 9,
      outstanding: null,
      overdue: null,
      hasBalances: false,
    },
  ],
  1,
);
eq(noBalances.selected[0]?.contactId, "b", "without balances, most recently updated is aged");
assert(noBalances.note?.includes("most recently updated"), "cap is honest");
assert(noBalances.note?.toLowerCase().includes("balance"), "missing balances are named");

const snap = {
  ...{
    version: 1 as const,
    source: "xero" as const,
    status: "applied" as const,
    asOf: "2026-09-22",
    syncedAt: "2026-09-26T12:00:00.000Z",
    skipReason: null,
    note: null,
    supplierCount: 1,
    billCount: harbour?.bills.length ?? 0,
    totalOutstanding: harbour?.outstanding ?? 0,
    totalOverdue: harbour?.overdue ?? 0,
    suppliers: harbour ? [harbour] : [],
  },
};
eq(agedApProofLine(snap), "Aged payables as of 2026-09-22 · 1 supplier · 2 bills", "proof line");
eq(agedApProofLine(null), "Aged payables appear after the next Sync", "pending proof");

const empty: PayablesSnapshot = {
  ...snap,
  status: "empty",
  supplierCount: 0,
  billCount: 0,
  totalOutstanding: 0,
  totalOverdue: 0,
  suppliers: [],
};
assert(agedApProofLine(empty).includes("nothing outstanding"), "empty proof");

eq(supplierMove("1 Month", null), "Decide", "no runway, no invented move");
eq(supplierMove("1 Month", 3), "Delay", "short runway delays a younger bucket");
eq(supplierMove("2 Months", 3), "Renegotiate", "short runway renegotiates an older bucket");
eq(supplierMove("91 and over", 13), "Pay", "full runway pays the overdue balance");

const tight = buildPayablesDraft(snap, 3);
assert(tight != null, "overdue produces a draft");
assert(tight?.rationale.includes("Harbour Supplies"), "draft names the supplier");
assert(tight?.rationale.includes("BILL-1042"), "draft cites the bill");
assert(tight?.rationale.includes("does not send a payment"), "draft does not pretend to pay");
assert(tight?.rationale.includes("3 weeks"), "draft uses the stored runway");
assert(!tight?.rationale.includes("50,000"), "draft does not invent the danger-floor cash figure");
assert(tight?.rationale.toLowerCase().includes("delay"), "short runway uses delay language");
eq(tight?.dataDepth, "transaction", "named supplier list is transaction depth");
assert(
  checkRootCauseClaims({
    data_depth: "transaction",
    title: tight?.title,
    problem: tight?.problem,
    rationale: tight?.rationale,
  }).ok,
  "transaction-depth draft passes the claim check",
);
assert((tight?.evidence.length ?? 0) >= 2, "supplier and bill evidence");

const undecided = buildPayablesDraft(snap, null);
assert(undecided?.rationale.includes("does not quote weeks of cash"), "missing runway stays honest");
assert(!/\b\d+\s+weeks of runway\b/.test(undecided?.rationale ?? ""), "no invented week count");
eq(buildPayablesDraft(empty, 3), null, "nothing overdue, no payables draft");

const roundTrip = readPayablesSnapshot(snap);
eq(roundTrip?.supplierCount, 1, "cache round trip");
const edgeSnap = edgeRead(snap);
eq(JSON.stringify(edgeDraft(edgeSnap, 3)), JSON.stringify(buildPayablesDraft(snap, 3)), "edge draft matches the app");
eq(edgeBlock(edgeSnap, 3), payablesPromptBlock(snap, 3), "edge prompt block matches the app");

const qboSummary = {
  Header: { EndPeriod: "2026-09-22" },
  Columns: {
    Column: [
      { ColTitle: "", ColType: "Vendor" },
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
          { value: "Hicks Hardware", id: "42" },
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
          ColData: [
            { value: "TOTAL" },
            { value: "100.00" },
            { value: "239.00" },
            { value: "" },
            { value: "" },
            { value: "450.00" },
            { value: "789.00" },
          ],
        },
      },
    ],
  },
};
const qboSuppliers = parseQboAgedPayables(qboSummary, "2026-09-22");
eq(qboSuppliers.length, 1, "qbo skips the grand total");
eq(qboSuppliers[0]?.outstanding, 789, "qbo outstanding from buckets, not a shifted total");
eq(qboSuppliers[0]?.overdue, 689, "qbo overdue");
eq(qboSuppliers[0]?.ageBucket, "91 and over", "qbo oldest bucket");

const withBills = attachQboBillDetail(
  qboSuppliers,
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
          Header: { ColData: [{ value: "Hicks Hardware", id: "42" }] },
          Rows: {
            Row: [
              {
                ColData: [
                  { value: "2026-06-01" },
                  { value: "Bill" },
                  { value: "1042", id: "bill-1" },
                  { value: "2026-07-01" },
                  { value: "450.00" },
                  { value: "450.00" },
                ],
              },
              {
                ColData: [
                  { value: "2026-09-01" },
                  { value: "Bill Payment (Check)" },
                  { value: "9" },
                  { value: "" },
                  { value: "10.00" },
                  { value: "10.00" },
                ],
              },
              {
                ColData: [
                  { value: "2026-08-01" },
                  { value: "Vendor Credit" },
                  { value: "VC-1" },
                  { value: "" },
                  { value: "20.00" },
                  { value: "20.00" },
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
eq(withBills[0]?.bills.length, 1, "payments and credits are not payables evidence");
eq(withBills[0]?.bills[0]?.reference, "1042", "qbo bill number");
eq(ageBucketFromDue("2026-07-01", "2026-09-22"), "61–90 days", "due date ages against the report date");

const newerEmpty: PayablesSnapshot = {
  ...empty,
  syncedAt: "2026-09-27T00:00:00.000Z",
  source: "qbo",
};
const chosen = choosePayables([newerEmpty, snap]);
eq(chosen?.source, "xero", "an applied payables list beats a newer empty pull");

const handoff = deliverableHandoff("Who should we pay on the aged payables list?");
eq(handoff?.tab, "payables", "bot hands payables questions to the supplier list");
eq(deliverableHandoff("Who is on the aged receivables chase list?")?.tab, "collections", "collections stays collections");
eq(deliverableHandoff("Will the 13-week cash forecast go negative?")?.tab, "cash", "cash questions stay on cash");

assert(xeroScopes().includes("accounting.reports.aged.read"), "aged scope already requested");
assert(xeroScopes().includes("accounting.contacts.read"), "contacts read already requested");
assert(!xeroScopes().includes("accounting.invoices"), "no invoice scope");
assert(!xeroScopes().includes("accounting.banktransactions"), "no bank transaction scope");
assert(!xeroScopes().includes("accounting.budgets.read"), "no budget scope");
eq(QBO_ACCOUNTING_SCOPE, "com.intuit.quickbooks.accounting", "qbo stays on the accounting scope");

const fn = readFileSync(resolve("src/lib/xero.functions.ts"), "utf8");
assert(fn.includes('data_type: "aged_ap"'), "xero sync caches aged payables on its own row");
assert(fn.includes("fetchXeroAgedPayables"), "xero sync fetches the report");
assert(fn.includes('data_type: "pl"'), "statement rows are still saved");
const qboFn = readFileSync(resolve("src/lib/qbo.functions.ts"), "utf8");
assert(qboFn.includes('data_type: "aged_ap"'), "qbo sync caches aged payables on its own row");
assert(qboFn.includes("fetchQboAgedPayables"), "qbo sync fetches aged payables");
const card = readFileSync(resolve("src/components/xero-connect.tsx"), "utf8");
assert(card.includes('id="xero-aged-ap-status"'), "xero card shows aged payables proof");
const qboCard = readFileSync(resolve("src/components/qbo-connect.tsx"), "utf8");
assert(qboCard.includes('id="qbo-aged-ap-status"'), "qbo card shows aged payables proof");
const rail = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(rail.includes('label: "Payables"'), "payables is a deliverable rail item");
const propose = readFileSync(resolve("supabase/functions/brain-propose/index.ts"), "utf8");
assert(propose.includes("buildPayablesDraft"), "propose files a payables draft from the cache");
assert(propose.includes("cash_runway_weeks"), "propose reads the runway already on the client");
assert(propose.includes('source: "ai", data_depth: "statement"'), "statement drafts stay statement depth");
assert(propose.includes("dropOverclaimingSteps(payload.next_steps)"), "ungrounded invoice claims are still dropped");

console.log("payables-test ok");
