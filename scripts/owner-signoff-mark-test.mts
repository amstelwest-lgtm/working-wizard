/**
 * Owner sign-off is one subtle line. A missing budget is not a variance.
 * Run: pnpm test:owner-signoff-mark
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BudgetVerdictStrip, budgetFigureMissing } from "../src/components/budget/budget-verdict";
import {
  OWNER_SIGNOFF_STALE_CHIP,
  OwnerSignoffMark,
  ownerSignoffDate,
  ownerSignoffLine,
} from "../src/components/owner-signoff-mark";
import { resolveMarket } from "../src/lib/market";
import type { ClientReviewSignoff } from "../src/lib/review-signoffs.functions";

function signoff(patch: Partial<ClientReviewSignoff> = {}): ClientReviewSignoff {
  return {
    id: "row",
    client_id: "client",
    scope: "financials",
    signed_off_by_id: "user",
    signed_off_by_name: "Theo",
    signed_off_by_initials: "TH",
    signed_off_by_title: null,
    firm_name: "My practice",
    note: null,
    signature_data: "data:image/svg+xml,sig",
    signed_off_at: "2026-09-01T14:26:00.000Z",
    ...patch,
  };
}

assert.equal(ownerSignoffDate("2026-09-01T14:26:00.000Z", "Africa/Johannesburg"), "1 Sep 2026");
assert.equal(ownerSignoffLine("Theo", "1 Sep 2026"), "Signed off by Theo · 1 Sep 2026");
assert.equal(budgetFigureMissing(0), true);
assert.equal(budgetFigureMissing(Number.NaN), true);
assert.equal(budgetFigureMissing(0.4), true);
assert.equal(budgetFigureMissing(490000), false);

const unsigned = renderToStaticMarkup(
  createElement(OwnerSignoffMark, { signoff: null, isStale: false }),
);
assert.equal(unsigned, "", "an unsigned tab renders nothing");

const sample = renderToStaticMarkup(
  createElement(OwnerSignoffMark, {
    signoff: signoff({ signed_off_by_name: "A. Sample", firm_name: "Sample Practice" }),
    isStale: true,
  }),
);
assert.equal(sample, "", "a sample-practice row is not a sign-off");

const signed = renderToStaticMarkup(
  createElement(OwnerSignoffMark, { signoff: signoff(), isStale: false }),
);
assert.match(signed, /Signed off by Theo · 1 Sep 2026/);
assert.match(signed, /<img /);
assert.equal(signed.includes(OWNER_SIGNOFF_STALE_CHIP), false);
assert.equal(signed.includes("figures have changed"), false);

const stale = renderToStaticMarkup(
  createElement(OwnerSignoffMark, { signoff: signoff(), isStale: true }),
);
assert.match(stale, /Signed off by Theo · figures changed since, re-review/);
assert.equal(stale.includes("1 Sep 2026"), false);
assert.equal(stale.includes(OWNER_SIGNOFF_STALE_CHIP), false);
assert.equal(stale.includes("figures have changed"), false);
assert.match(stale, /data-signoff-stale-chip/);

const za = resolveMarket({ country: "ZA", regionCode: null });
const missing = renderToStaticMarkup(
  createElement(BudgetVerdictStrip, {
    periodLabel: "Mar 2026–Feb 2027, prorated",
    revenueBudget: 0,
    revenueActual: 4200000,
    profitBudget: 0,
    profitActual: 120000,
    chip: "Estimated from statement pace",
    market: za,
    signoff: signoff({ scope: "budget" }),
    isStale: true,
    presentation: "owner",
  }),
);
assert.match(missing, /data-owner-budget-summary/);
assert.equal((missing.match(/Budget not built yet/g) ?? []).length, 2);
assert.equal((missing.match(/No budget yet/g) ?? []).length, 0);
assert.equal(missing.includes("+$") || missing.includes("+R"), false);
assert.equal(missing.includes("Signed off"), false, "an unbuilt budget hides the sign-off badge");
assert.equal(missing.includes(OWNER_SIGNOFF_STALE_CHIP), false);

const voided = renderToStaticMarkup(
  createElement(BudgetVerdictStrip, {
    periodLabel: "Mar 2026–Feb 2027, prorated",
    revenueBudget: 490000,
    revenueActual: 420000,
    profitBudget: 269500,
    profitActual: 120000,
    chip: "From this month's actuals",
    market: za,
    signoff: signoff({ scope: "budget" }),
    isStale: true,
    presentation: "owner",
  }),
);
assert.match(voided, /Void · figures changed since sign-off/);
assert.equal(voided.includes("Signed off"), false, "a stale built budget is void, not signed off");
assert.match(voided, /data-signoff-void/);

const voidedStrip = renderToStaticMarkup(
  createElement(BudgetVerdictStrip, {
    periodLabel: "Mar 2026–Feb 2027, prorated",
    revenueBudget: 490000,
    revenueActual: 420000,
    profitBudget: 269500,
    profitActual: 120000,
    chip: "From this month's actuals",
    market: za,
    signoff: signoff({ scope: "budget" }),
    isStale: true,
  }),
);
assert.match(voidedStrip, /Void · figures changed since sign-off/);
assert.equal(voidedStrip.includes("Signed off"), false);

const priced = renderToStaticMarkup(
  createElement(BudgetVerdictStrip, {
    periodLabel: "Mar 2026–Feb 2027, prorated",
    revenueBudget: 490000,
    revenueActual: 420000,
    profitBudget: 269500,
    profitActual: 120000,
    chip: "From this month's actuals",
    market: za,
    presentation: "owner",
  }),
);
assert.equal(priced.includes("No budget yet"), false);
assert.match(priced, /420/);
assert.match(priced, /490/);

const chart = readFileSync(resolve("src/components/budget/budget-chart-table.tsx"), "utf8");
assert.match(chart, /Your accountant is still setting the budget/);
assert.match(chart, /bg-\[#DBEAFE\]/);
assert.match(chart, /data-budget-chart="draft"/);
assert.match(chart, /<Info /);

const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert.match(app, /OwnerSignoffMark/);
assert.equal(app.includes("ReviewSignoffBadge"), false);
assert.equal(app.includes("OwnerTabSignoffRow"), false);

console.log("owner-signoff-mark-test: ok");
