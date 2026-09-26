/**
 * Budget PDF view model stays on clients.budget + the existing variance engine.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/budget-pdf-test.mts
 */
import { buildBudgetPdfModel, illustrativeBudgetPack, parseBudgetDocument } from "../src/lib/budget-pdf";
import { computeBudgetMonths } from "../src/lib/budget.compute";
import { computeMonthVariance, normalizeTaxonomyTotals } from "../src/lib/budget.variance";
import { ZA_MARKET } from "../src/lib/market/resolve";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const pack = illustrativeBudgetPack("2026-01");
assert(parseBudgetDocument(null) === null, "missing budget does not invent a document");
assert(parseBudgetDocument(pack.doc)?.fyStart === "2026-01", "saved budget document round-trips");

const model = buildBudgetPdfModel(pack.doc, pack.actuals, ZA_MARKET);
const monthKey = pack.actuals[0].month;
const month = computeBudgetMonths(pack.doc, pack.doc.activeScenario).find((r) => r.month === monthKey);
assert(Boolean(month), "illustrative pack has a budget month");
const engine = computeMonthVariance(
  month!,
  normalizeTaxonomyTotals(pack.actuals[0].totals),
  monthKey,
);

for (const key of ["revenue", "cogs", "ebit"] as const) {
  const label = key === "ebit" ? "Profit" : key === "cogs" ? "COGS" : "Revenue";
  const row = model.summary.find((r) => r.label === label);
  const line = engine.lines.find((l) => l.key === key);
  assert(Boolean(row && line), `${label} present`);
  assert(row!.budget === line!.budget, `${label} budget matches the budget engine`);
  assert(row!.actual === line!.actual, `${label} actual matches uploaded month totals`);
  assert(row!.delta === line!.delta, `${label} variance matches computeMonthVariance`);
}

const opex = model.summary.find((r) => r.label === "Operating expenses");
const oh = engine.lines.find((l) => l.key === "overheads_total");
assert(opex?.delta === oh?.delta, "operating expenses variance matches overheads_total");
assert(model.hasActuals, "uploaded month counts as actuals");
assert(model.notes.length === 1, "partner notes come from the budget document");

const planOnly = buildBudgetPdfModel(pack.doc, [], ZA_MARKET);
assert(!planOnly.hasActuals, "no upload means no variance");
assert(
  planOnly.summary.every((r) => r.actual === null && r.delta === null),
  "budget-only PDF leaves actual and variance blank",
);
const fyRevenue = computeBudgetMonths(pack.doc, "base").reduce((s, r) => s + r.revenue, 0);
const rev = planOnly.summary.find((r) => r.label === "Revenue");
assert(rev?.budget === fyRevenue, "full-year revenue is the sum of computed budget months");

console.log("budget-pdf-test: ok");
