/**
 * Cash and Budget answer strips: one source chip, one status line.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { budgetActualsBadge, showBudgetSourceChip } from "../src/lib/budget.bridges";
import { plainBudgetWindowHeading } from "../src/lib/budget.months";
import { signoffStatusKind, signoffStatusLine } from "../src/lib/signoff-status";

assert(budgetActualsBadge(2, false) === "From this month's actuals", "uploaded month uses plain words");
assert(budgetActualsBadge(0, true) === "Estimated from statement pace", "statement pace uses plain words");
assert(budgetActualsBadge(0, false) === "None", "no source stays None");
assert(showBudgetSourceChip("From this month's actuals"), "an uploaded month is a chip");
assert(showBudgetSourceChip("Estimated from statement pace"), "statement pace is a chip");
assert(!showBudgetSourceChip("None"), "None is not a chip");
assert(!showBudgetSourceChip(null), "a missing chip stays blank");
assert(
  plainBudgetWindowHeading("Billable hours / T&M", { fyStart: "2026-03" }) ===
    "Billable-hours budget · Mar 2026 – Feb 2027",
  "the budget window is plain words",
);

assert(signoffStatusKind({ hasSignoff: false, isStale: false, readyForReview: false }) === "draft");
assert(signoffStatusKind({ hasSignoff: false, isStale: false, readyForReview: true }) === "ready");
assert(signoffStatusKind({ hasSignoff: true, isStale: false, readyForReview: false }) === "signed");
assert(signoffStatusKind({ hasSignoff: true, isStale: true, readyForReview: true }) === "stale");
assert(signoffStatusLine({ kind: "draft" }) === "Draft");
assert(signoffStatusLine({ kind: "ready" }) === "Ready for review");

function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

const cash = readFileSync(resolve("src/components/cash-forecast.tsx"), "utf8");
const budgetVerdict = readFileSync(resolve("src/components/budget/budget-verdict.tsx"), "utf8");
const budgetPanel = readFileSync(resolve("src/components/budget/budget-panel.tsx"), "utf8");
const budgetWorkspace = readFileSync(resolve("src/components/budget/budget-workspace.tsx"), "utf8");
const clientRoute = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const owner = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const drawer = readFileSync(resolve("src/components/review-inputs-drawer.tsx"), "utf8");
const portalCss = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");
const harness = readFileSync(resolve("scripts/rail-studio-harness/main.tsx"), "utf8");

assert(count(cash, "<SignoffStatusChip") === 1, "cash defines one status chip");
assert(count(budgetVerdict, "<SignoffStatusChip") === 1, "budget defines one status chip");
assert(count(cash, "data-source-chip") === 1, "cash defines one source chip");
assert(count(budgetVerdict, "data-source-chip") === 1, "budget defines one source chip");
assert(!cash.includes("sourceChip="), "cash lines do not repeat the source chip");
assert(cash.includes("hideStatus"), "cash sign-off does not repeat the status line");
assert(budgetVerdict.includes("hideStatus"), "budget sign-off does not repeat the status line");
assert(cash.includes("data-review-inputs") === false && cash.includes("<ReviewInputsDrawer"), "cash drawer is the shared one");
assert(budgetPanel.includes("<ReviewInputsDrawer"), "budget drawer is the shared one");
assert(cash.includes('title="Try a what-if"'), "what-if replaces Scenario Studio");
assert(!cash.includes("Scenario Studio"), "Scenario Studio is gone");
assert(!cash.includes("13-week maths"), "maths wording is gone");
assert(!cash.includes("Signature view"), "signature eyebrow is gone from the panel");
assert(!clientRoute.includes("Signature view"), "signature eyebrow is gone from the route");
assert(!cash.includes("Not signed off"), "cash has no local unsigned phrase");
assert(!budgetVerdict.includes("Not signed off"), "budget strip has no local unsigned phrase");
assert(!budgetVerdict.includes("Sign-off stale"), "budget strip has no stale phrase");
assert(!budgetPanel.includes("Sign-off stale"), "budget panel has no stale phrase");
assert(!budgetPanel.includes("Low driver overlap"), "overlap title is plain");
assert(!budgetPanel.includes("annualised"), "scale-break copy does not say annualised");
assert(!budgetWorkspace.includes("full FY grid"), "the grid note is plain");
assert(!budgetWorkspace.includes("no matching key"), "unmapped copy does not say key");
assert(budgetPanel.includes("Summary"), "summary label");
assert(budgetPanel.includes("Full year by month"), "full-year label");
assert(!clientRoute.includes("data-view-mode-toggle"), "the budget toggle is not on the page");
assert(budgetPanel.includes("data-view-mode-toggle"), "the budget toggle lives in the drawer");
for (const label of ["Business Health", "Profit", "Cash Forecast", "Budget", "Next moves", "Action Plan"]) {
  assert(owner.includes(`label: "${label}"`), `owner tab ${label} stays`);
}

assert(count(cash, "13-week cash forecast") === 1, "cash keeps one strip heading");
assert(!cash.includes("13-Week Cash Forecast"), "the inner cash title is gone");
assert(cash.includes('hint="Inputs, what-ifs"'), "cash drawer names its contents");
assert(cash.includes("answer-strip__secondary"), "upload sits on the strip as a secondary");
assert(cash.includes('aria-label="Export PDF"'), "cash export is an icon on the strip");
assert(cash.includes("answer-strip__actions"), "the primary sits on the strip row");
assert(budgetVerdict.includes("answer-strip__actions"), "budget primary sits on the strip row");
assert(budgetVerdict.includes("extraActions"), "budget export joins the strip row");
assert(drawer.includes("review-inputs__chevron"), "the drawer summary has a chevron");
assert(drawer.includes("review-inputs__hint"), "the drawer summary can show a count");
assert(portalCss.includes("grid-row:3"), "at phone width the primary drops under the chips");
assert(portalCss.includes(".review-inputs__body{display:none}"), "a closed drawer does not paint its inputs");
assert(portalCss.includes(".review-inputs[open] > .review-inputs__body"), "the drawer body shows only when open");
assert(portalCss.includes('content:"▸"'), "the closed drawer shows a chevron");
const assumptionsAt = budgetWorkspace.indexOf('id="wizard-budget-assumptions"');
const driversAt = budgetWorkspace.indexOf("{/* Revenue drivers */}");
const nestAt = budgetWorkspace.lastIndexOf("nestInDrawer(", assumptionsAt);
assert(nestAt !== -1 && nestAt < assumptionsAt && assumptionsAt < driversAt, "assumptions sit in the drawer, above the drivers");
assert(budgetWorkspace.includes("{variance}"), "budget vs actuals is passed into the drawer");
assert(!budgetWorkspace.slice(driversAt).includes('id="wizard-budget-assumptions"'), "drivers are not wrapped around the assumptions");
assert(harness.includes('includes("harness-local")'), "the harness hides its own stub toasts");
assert(!readFileSync(resolve("src/components/ui/sonner.tsx"), "utf8").includes("harness-local"), "app toast code is unchanged");

console.log("answer-strip cash + budget ok");
