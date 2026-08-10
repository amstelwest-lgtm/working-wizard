/**
 * Quick sanity checks for budget overlap + month helpers.
 */
import { computeDriverOverlap } from "../src/lib/budget.model-change";
import { fyMonths, currentFyStart, createBudgetDocument } from "../src/lib/budget.months";
import { computeBudgetMonths } from "../src/lib/budget.compute";
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
const rows = computeBudgetMonths(doc, "base");
assert(rows[0].revenue === 1000, `rev ${rows[0].revenue}`);
assert(rows[0].cogs === 600, `cogs ${rows[0].cogs}`);

assert(currentFyStart(3, new Date("2026-08-01")).startsWith("2026-03"), "current FY");

console.log("budget sanity ok");
