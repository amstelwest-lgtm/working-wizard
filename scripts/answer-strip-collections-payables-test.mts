/**
 * Collections and Payables answer strips: one Draft status, one chip label.
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
} from "../src/lib/collections";
import {
  agedApProofLine,
  finalizePayables,
  payablesAnswerSentence,
  payablesNoFiguresLead,
  payablesStatementLead,
  XERO_AGED_AP_RECONNECT,
} from "../src/lib/payables";
import { figureSourceChipLabel } from "../src/lib/ledger-link-copy";
import { signoffStatusLine } from "../src/lib/signoff-status";
import { legacyPaneForSearch } from "../src/lib/client-route-search";

assert(signoffStatusLine({ kind: "draft" }) === "Draft", "Draft is the shared status line");
assert(figureSourceChipLabel("xero") === "Xero", "a Xero snapshot chips as Xero");
assert(figureSourceChipLabel("qbo") === "QuickBooks", "a QuickBooks snapshot chips as QuickBooks");
assert(figureSourceChipLabel("sage") === "Sage", "a Sage snapshot chips as Sage");
assert(figureSourceChipLabel("statement") === "Statement", "statement totals chip as Statement");
assert(figureSourceChipLabel(null) === null, "a missing source is not a chip");
assert(figureSourceChipLabel("") === null, "a blank source is not a chip");

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
  collectionsAnswerSentence(chased) === agedArProofLine(chased),
  "a collections snapshot uses the proof line",
);
assert(
  collectionsAnswerSentence(chased) === "Aged receivables as of 2026-09-30 · 1 contact · 1 invoice",
  "the collections sentence is the aged proof line",
);
assert(
  collectionsAnswerSentence(null) === collectionsNoFiguresLead(),
  "collections without a snapshot uses the empty sentence",
);
assert(
  !collectionsAnswerSentence(null).includes("next Sync"),
  "the empty collections sentence is not the pending sync line",
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
  payablesAnswerSentence(supplied) === agedApProofLine(supplied),
  "a payables snapshot uses the proof line",
);
assert(
  payablesAnswerSentence(supplied) === "Aged payables as of 2026-09-30 · 1 supplier · 1 bill",
  "the payables sentence is the aged proof line",
);
assert(
  payablesAnswerSentence(null) === payablesNoFiguresLead(),
  "payables without a snapshot uses the empty sentence",
);

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
assert(count(strip, "data-signoff-status") === 1, "the strip renders one status");
assert(strip.includes('signoffStatusLine({ kind: "draft" })'), "status is the shared Draft line");
assert(!strip.includes("ReviewSignoffButton"), "these tabs do not add a sign-off scope");
assert(strip.includes("data-source-chip"), "the strip can show one source chip");
assert(strip.includes("{chip ?"), "a blank chip is omitted");
assert(collections.includes("figureSourceChipLabel(snapshot.source)"), "collections chips the snapshot source");
assert(collections.includes('figureSourceChipLabel("statement")'), "collections chips Statement for totals only");
assert(payables.includes("figureSourceChipLabel(snapshot.source)"), "payables chips the snapshot source");
assert(payables.includes('figureSourceChipLabel("statement")'), "payables chips Statement for totals only");
assert(collections.includes("collectionsAnswerSentence"), "collections sentence is the proof line or the empty line");
assert(payables.includes("payablesAnswerSentence"), "payables sentence is the proof line or the empty line");
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
