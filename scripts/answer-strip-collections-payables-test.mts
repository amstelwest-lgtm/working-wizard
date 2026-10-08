/**
 * Collections and Payables answer strips: sentences from figures already on the page, no status pill.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import {
  agedArProofLine,
  collectionsAnswerSentence,
  collectionsNoFiguresLead,
  collectionsStatementLead,
  finalizeCollections,
  XERO_AGED_RECONNECT,
  type StatementWorkingCapital,
} from "../src/lib/collections";
import {
  agedApProofLine,
  finalizePayables,
  payablesAnswerSentence,
  payablesNoFiguresLead,
  payablesStatementLead,
  XERO_AGED_AP_RECONNECT,
} from "../src/lib/payables";
import { figureSourceChipLabel, showFigureSourceChip } from "../src/lib/ledger-link-copy";
import { legacyPaneForSearch } from "../src/lib/client-route-search";
import { statementArApMetricOrder, statementArApMoney } from "../src/components/statement-arap-fallback";

const money = (n: number) => statementArApMoney(n);
const position: StatementWorkingCapital = {
  receivables: 92000,
  payables: 41000,
  debtorDays: 48,
  creditorDays: 31,
};

assert(figureSourceChipLabel("xero") === "Xero", "a Xero snapshot chips as Xero");
assert(figureSourceChipLabel("qbo") === "QuickBooks", "a QuickBooks snapshot chips as QuickBooks");
assert(figureSourceChipLabel("sage") === "Sage", "a Sage snapshot chips as Sage");
assert(figureSourceChipLabel("upload") === "Uploaded statement", "an uploaded statement chips like Health");
assert(figureSourceChipLabel(null) === null, "a missing source is not a chip");
assert(figureSourceChipLabel("") === null, "a blank source is not a chip");
assert(!showFigureSourceChip(null), "a missing source is omitted");
assert(!showFigureSourceChip(""), "a blank source is omitted");
assert(!showFigureSourceChip("   "), "whitespace is omitted");

const chased = finalizeCollections({
  source: "xero",
  asOf: "2026-09-30",
  syncedAt: "2026-10-01T00:00:00.000Z",
  contacts: [
    {
      contactId: "c1",
      name: "North Glass",
      outstanding: 1200,
      overdue: 800,
      ageBucket: "1 Month",
      buckets: [],
      invoices: [
        {
          invoiceId: "i1",
          reference: "INV-14",
          dueDate: "2026-08-01",
          amount: 800,
          ageBucket: "1 Month",
        },
      ],
    },
  ],
});
assert(
  collectionsAnswerSentence(chased, position, money) ===
    "R 800 is overdue across 1 customer; North Glass is the largest at R 800.",
  "a collections list uses the stored overdue total and the first name",
);
const chasedBook = finalizeCollections({
  source: "xero",
  asOf: "2026-09-30",
  syncedAt: "2026-10-01T00:00:00.000Z",
  contacts: [
    {
      contactId: "c-small",
      name: "Lane & Co",
      outstanding: 3000,
      overdue: 3000,
      ageBucket: "1 Month",
      buckets: [],
      invoices: [],
    },
    {
      contactId: "c-acme",
      name: "Acme",
      outstanding: 21000,
      overdue: 21000,
      ageBucket: "91+",
      buckets: [],
      invoices: [],
    },
    {
      contactId: "c-north",
      name: "North Glass",
      outstanding: 9000,
      overdue: 9000,
      ageBucket: "2 Months",
      buckets: [],
      invoices: [],
    },
    {
      contactId: "c-fit",
      name: "Harbour Fit",
      outstanding: 5000,
      overdue: 5000,
      ageBucket: "Current",
      buckets: [],
      invoices: [],
    },
  ],
});
assert(chasedBook.contacts[0]?.name === "Acme", "the stored list already leads with the largest overdue");
assert(chasedBook.totalOverdue === 38000, "the overdue total is the stored sum");
assert(chasedBook.contactCount === 4, "the customer count is the stored count");
assert(
  collectionsAnswerSentence(chasedBook, position, money) ===
    "R 38 000 is overdue across 4 customers; Acme is the largest at R 21 000.",
  "the populated collections sentence reads the stored total, count, and first name",
);
assert(
  !collectionsAnswerSentence(chased, position, money).includes("Aged receivables"),
  "the proof line is not the collections answer",
);
assert(
  agedArProofLine(chased) === "Aged receivables as of 2026-09-30 · 1 contact · 1 invoice",
  "the proof line stays available for the drawer",
);
assert(
  collectionsAnswerSentence(null, position, money) ===
    "R 92 000 is owed to you and customers take 48 days to pay. Upload the aged debtors report to see who to chase.",
  "collections leads with the statement figures",
);
assert(
  collectionsAnswerSentence(null, { ...position, debtorDays: null }, money) === collectionsNoFiguresLead(),
  "a missing day count keeps the collections empty sentence",
);
assert(
  collectionsAnswerSentence(null, { ...position, receivables: null }, money) === collectionsNoFiguresLead(),
  "a missing receivables total keeps the collections empty sentence",
);
assert(
  collectionsAnswerSentence(null, null, money) === collectionsNoFiguresLead(),
  "no statement figures keeps the collections empty sentence",
);

const supplied = finalizePayables({
  source: "qbo",
  asOf: "2026-09-30",
  syncedAt: "2026-10-01T00:00:00.000Z",
  suppliers: [
    {
      supplierId: "s1",
      name: "Kiln Gas",
      outstanding: 640,
      overdue: 640,
      ageBucket: "Current",
      buckets: [],
      bills: [
        {
          billId: "b1",
          reference: "BILL-3",
          dueDate: "2026-10-12",
          amount: 640,
          ageBucket: "Current",
        },
      ],
    },
  ],
});
assert(
  payablesAnswerSentence(supplied, position, money) ===
    "R 640 is overdue across 1 supplier; Kiln Gas is the largest at R 640.",
  "a payables list uses the stored overdue total and the first name",
);
const suppliedBook = finalizePayables({
  source: "xero",
  asOf: "2026-09-30",
  syncedAt: "2026-10-01T00:00:00.000Z",
  suppliers: [
    {
      supplierId: "s-freight",
      name: "Freight",
      outstanding: 3000,
      overdue: 3000,
      ageBucket: "Current",
      buckets: [],
      bills: [],
    },
    {
      supplierId: "s-kiln",
      name: "Kiln Gas",
      outstanding: 9000,
      overdue: 9000,
      ageBucket: "2 Months",
      buckets: [],
      bills: [],
    },
    {
      supplierId: "s-sand",
      name: "Sand Co",
      outstanding: 6000,
      overdue: 6000,
      ageBucket: "1 Month",
      buckets: [],
      bills: [],
    },
  ],
});
assert(suppliedBook.suppliers[0]?.name === "Kiln Gas", "the stored list already leads with the largest overdue");
assert(suppliedBook.totalOverdue === 18000, "the overdue total is the stored sum");
assert(suppliedBook.supplierCount === 3, "the supplier count is the stored count");
assert(
  payablesAnswerSentence(suppliedBook, position, money) ===
    "R 18 000 is overdue across 3 suppliers; Kiln Gas is the largest at R 9 000.",
  "the populated payables sentence reads the stored total, count, and first name",
);
assert(
  !payablesAnswerSentence(supplied, position, money).includes("Aged payables"),
  "the proof line is not the payables answer",
);
assert(
  agedApProofLine(supplied) === "Aged payables as of 2026-09-30 · 1 supplier · 1 bill",
  "the proof line stays available for the drawer",
);
assert(
  payablesAnswerSentence(null, position, money) ===
    "You owe suppliers R 41 000 and pay in 31 days. Upload the aged creditors report to see who to pay first.",
  "payables leads with the statement figures",
);
assert(
  payablesAnswerSentence(null, { ...position, creditorDays: null }, money) === payablesNoFiguresLead(),
  "a missing day count keeps the payables empty sentence",
);
assert(
  payablesAnswerSentence(null, { ...position, payables: null }, money) === payablesNoFiguresLead(),
  "a missing payables total keeps the payables empty sentence",
);
assert(statementArApMetricOrder()[0] === "dso", "collections keeps debtor cards first");
assert(statementArApMetricOrder("creditors")[0] === "dpo", "payables leads with creditor days");
assert(statementArApMetricOrder("creditors")[1] === "ap", "payables leads with the creditors total");

for (const lead of [collectionsStatementLead("za"), collectionsStatementLead("us"), payablesStatementLead("za"), payablesStatementLead("us")]) {
  for (const banned of ["Days AR", "Days AP", "Ratios", "DSO"]) {
    assert(!lead.includes(banned), `statement lead omits ${banned}`);
  }
}
assert(!XERO_AGED_RECONNECT.includes("accounting.reports.aged.read"), "receivables reconnect drops the scope id");
assert(!XERO_AGED_RECONNECT.includes("accounting.contacts.read"), "receivables reconnect drops the contacts scope id");
assert(XERO_AGED_RECONNECT.includes("aged-receivables access"), "receivables reconnect still says what to grant");
assert(!XERO_AGED_AP_RECONNECT.includes("accounting.reports.aged.read"), "payables reconnect drops the scope id");
assert(!XERO_AGED_AP_RECONNECT.includes("accounting.contacts.read"), "payables reconnect drops the contacts scope id");
assert(XERO_AGED_AP_RECONNECT.includes("aged-payables access"), "payables reconnect still says what to grant");

assert(legacyPaneForSearch({ tab: "overview", section: "collections" }) === "collections", "collections stays on its pane");
assert(legacyPaneForSearch({ tab: "overview", section: "payables" }) === "payables", "payables stays on its pane");

function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

function sliceBetween(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  assert(from !== -1 && to > from, `${start} precedes ${end}`);
  return src.slice(from, to);
}

const route = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const collections = readFileSync(resolve("src/components/collections-panel.tsx"), "utf8");
const payables = readFileSync(resolve("src/components/payables-panel.tsx"), "utf8");
const strip = readFileSync(resolve("src/components/arap-answer-strip.tsx"), "utf8");
const owner = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const sage = readFileSync(resolve("src/components/sage-connect.tsx"), "utf8");
const portalCss = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");

const collectionsPane = sliceBetween(route, 'id="pane-collections"', 'id="pane-payables"');
const payablesPane = sliceBetween(route, 'id="pane-payables"', 'id="pane-budget"');

assert(count(collections, "<ArapAnswerStrip") === 1, "collections has one strip");
assert(count(payables, "<ArapAnswerStrip") === 1, "payables has one strip");
assert(!strip.includes("data-signoff-status"), "no status pill without a review scope");
assert(!strip.includes("signoffStatusLine"), "these tabs do not invent a Draft status");
assert(!collections.includes("data-signoff-status"), "collections does not render a status");
assert(!payables.includes("data-signoff-status"), "payables does not render a status");
assert(!strip.includes("ReviewSignoffButton"), "these tabs do not add a sign-off scope");
assert(strip.includes("data-source-chip"), "the strip can show one source chip");
assert(strip.includes("{chip ?"), "a blank chip is omitted");
assert(collections.includes("figureSourceChipLabel(snapshot.source)"), "collections chips the snapshot source");
assert(collections.includes("figureSourceChipLabel(statementSource)"), "collections chips the statement source");
assert(!collections.includes('figureSourceChipLabel("statement")'), "collections does not invent a Statement chip");
assert(payables.includes("figureSourceChipLabel(snapshot.source)"), "payables chips the snapshot source");
assert(payables.includes("figureSourceChipLabel(statementSource)"), "payables chips the statement source");
assert(!payables.includes('figureSourceChipLabel("statement")'), "payables does not invent a Statement chip");
assert(collections.includes("agedArProofLine(snapshot)"), "the collections proof line is the drawer hint");
assert(payables.includes("agedApProofLine(snapshot)"), "the payables proof line is the drawer hint");
assert(collections.includes("collectionsAnswerSentence"), "collections sentence comes from the stored figures");
assert(payables.includes("payablesAnswerSentence"), "payables sentence comes from the stored figures");
assert(payables.includes('lead="creditors"'), "payables puts creditor cards first on the list");
assert(payables.includes('cardLead="creditors"'), "payables puts creditor cards first when only totals are showing");
assert(!collections.includes('lead="creditors"'), "collections keeps the debtor card order");
const figureSourceAt = route.indexOf("const figureSource = resolveFigureSource(");
const healthChipAt = route.indexOf("const healthChip = figureSourceChipLabel(figureSource)", figureSourceAt);
assert(figureSourceAt !== -1 && healthChipAt > figureSourceAt, "figure source is resolved before the chip");
const figureSourceCall = route.slice(figureSourceAt, healthChipAt);
assert(figureSourceCall.includes("financials,"), "figure source reads the statement file");
const resolver = readFileSync(resolve("src/lib/ledger-link-copy.ts"), "utf8");
const resolverFn = resolver.slice(
  resolver.indexOf("export function resolveFigureSource"),
  resolver.indexOf("export type LedgerProvider"),
);
const statementRead = resolverFn.indexOf("readStatementMeta(input.financials ?? null).statementSource");
const snapshotRead = resolverFn.indexOf("input.snapshotSource");
assert(statementRead !== -1 && snapshotRead > statementRead, "resolved figure source reads the statement source first");
assert(
  resolverFn.indexOf("if (fromBlob) return fromBlob;") < snapshotRead,
  "a statement source is returned before the snapshot is considered",
);
assert(collectionsPane.includes("statementSource={figureSource}"), "collections receives the statement source");
assert(payablesPane.includes("statementSource={figureSource}"), "payables receives the statement source");
assert(collections.includes("<ReviewInputsDrawer"), "collections inputs sit in the drawer");
assert(payables.includes("<ReviewInputsDrawer"), "payables inputs sit in the drawer");
assert(collections.includes("collectionsStatementLead"), "the collections statement explanation stays available");
assert(payables.includes("payablesStatementLead"), "the payables statement explanation stays available");
assert(!collectionsPane.includes("DeliverableTabHead"), "the collections tab head is the strip");
assert(!payablesPane.includes("DeliverableTabHead"), "the payables tab head is the strip");
assert(!collectionsPane.includes("Days AR"), "the collections pane drops Days AR");
assert(!payablesPane.includes("Days AR"), "the payables pane drops Days AR");
assert(!collections.includes("btn gold"), "collections keeps a single gold control on the strip");
assert(!payables.includes("btn gold"), "payables keeps a single gold control on the strip");
assert(collections.includes("COLLECTIONS_UPLOAD_CTA"), "upload stays the collections primary when there is no list");
assert(payables.includes("COLLECTIONS_UPLOAD_CTA"), "upload stays the payables primary when there is no list");
assert(collections.includes("Add chase draft"), "the chase action stays the primary once names exist");
assert(payables.includes("Add payables draft"), "the payables action stays the primary once names exist");

for (const label of ["Business Health", "Profit", "Cash Forecast", "Budget", "Next moves", "Action Plan"]) {
  assert(owner.includes(`label: "${label}"`), `owner tab ${label} stays`);
}
assert(!sage.includes("ArapAnswerStrip"), "sage connect is untouched");
const drawerRule = portalCss.slice(portalCss.indexOf(".review-inputs{"), portalCss.indexOf(".review-inputs__summary"));
assert(drawerRule.includes("margin:0 0 16px"), "the drawer keeps a 16px gap under it");
assert(portalCss.includes(".answer-strip__primary{width:100%;justify-content:center}"), "the gold primary is full width on a phone");

console.log("answer-strip collections + payables ok");
