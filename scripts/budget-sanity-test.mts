/**
 * Quick sanity checks for budget overlap, VAT cash, and depreciation.
 */
import { computeDriverOverlap } from "../src/lib/budget.model-change";
import { fyMonths, currentFyStart, createBudgetDocument } from "../src/lib/budget.months";
import { computeBudgetMonths, normalizeBudgetDocument } from "../src/lib/budget.compute";
import type { BudgetQualification } from "../src/lib/budget.types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const overlap = computeDriverOverlap(
  ["units_sold", "avg_basket", "old_only"],
  ["units_sold", "avg_basket", "new_only"],
);
assert(overlap.matched === 2, "expected 2 matched");
assert(Math.round(overlap.overlapPct) === 67, `expected ~67 got ${overlap.overlapPct}`);

const months = fyMonths("2026-03");
assert(months.length === 12, "12 months");
assert(months[0] === "2026-03" && months[11] === "2027-02", "FY span");

const q: BudgetQualification = {
  payModel: "products",
  subtype: "retail",
  driverKind: "units_price",
  costShape: "balanced",
  debtorDaysDefault: 7,
  capexMode: "light",
  confirmedAt: new Date().toISOString(),
};
const doc = createBudgetDocument({ templateId: "retail_units", qualification: q, fyStartMonth: 3 });
doc.revenueLines[0].months["2026-03"] = { volume: 10, price: 100 };
doc.gpPct = 40;
doc.openingCash = 5000;
doc.vatMode = "exclusive";
doc.vatRate = 0.15;
doc.wc.debtorDays = 0;
doc.wc.creditorDays = 0;
doc.wc.inventoryDays = 0;

const rows = computeBudgetMonths(doc, "base");
assert(rows[0].revenue === 1000, `rev ${rows[0].revenue}`);
assert(rows[0].cogs === 600, `cogs ${rows[0].cogs}`);
// exclusive: cash in includes VAT on revenue
assert(Math.round(rows[0].cashIn) === 1150, `cashIn ${rows[0].cashIn}`);
assert(rows[0].closingCash === 5000 + rows[0].netCash, "opening cash applied");

// Capex depreciation
doc.capex = [
  {
    id: "cx1",
    name: "Machine",
    month: "2026-03",
    amount: 36000,
    funding: "finance",
    usefulLifeMonths: 36,
    residual: 0,
  },
];
const withDep = computeBudgetMonths(doc, "base");
assert(Math.round(withDep[0].depreciation) === 1000, `dep ${withDep[0].depreciation}`);
assert(Math.round(withDep[0].ebit) === Math.round(withDep[0].ebitda - 1000), "ebit = ebitda - dep");
assert(withDep[0].capexCash === 0, "finance funding skips cash hit");

const legacy = normalizeBudgetDocument({
  ...doc,
  vatRate: undefined as unknown as number,
  openingCash: undefined as unknown as number,
} as typeof doc);
assert(legacy.vatRate === 0.15, "normalize vat");
assert(legacy.openingCash === 0 || legacy.openingCash === 5000, "normalize opening");

assert(currentFyStart(3, new Date("2026-08-01")).startsWith("2026-03"), "current FY");

console.log("budget sanity ok (phase 2+3)");
