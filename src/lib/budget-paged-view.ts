/**
 * Accountant budget page: one pane per menu item.
 * `section=year` is Overview, `section=months` and `?view=table` stay Month by month.
 * `?view=setup` is the drivers pane and does not replace those section links.
 */

export const BUDGET_PAGED_VIEWS = ["overview", "months", "setup"] as const;

export type BudgetPagedView = (typeof BUDGET_PAGED_VIEWS)[number];

export const BUDGET_PAGED_LABEL: Record<BudgetPagedView, string> = {
  overview: "Overview",
  months: "Month by month",
  setup: "Setup",
};

export function isBudgetPagedView(value: unknown): value is BudgetPagedView {
  return typeof value === "string" && (BUDGET_PAGED_VIEWS as readonly string[]).includes(value);
}

/** Section and the legacy `view=table` / `view=chart` links pick the pane. */
export function budgetPagedViewFromSearch(input: {
  section?: string | null;
  view?: string | null;
}): BudgetPagedView {
  const view = (input.view ?? "").trim();
  if (view === "setup" || view === "engine" || view === "inputs") return "setup";
  if (input.section === "months" || view === "table") return "months";
  return "overview";
}

const SETUP_HASHES = new Set([
  "wizard-budget-month-engine",
  "wizard-budget-cash-timing",
  "wizard-budget-assumptions",
  "wizard-budget-advanced",
]);

/** Old in-page anchors that now open a pane. Null when the hash is not one of them. */
export function budgetPagedViewFromHash(hash: string | null | undefined): BudgetPagedView | null {
  const id = (hash ?? "").replace(/^#/, "").split("?")[0].trim().toLowerCase();
  if (!id) return null;
  if (SETUP_HASHES.has(id)) return "setup";
  if (id === "wizard-budget-variance" || id === "wizard-budget-tab-head") return "overview";
  if (id === "months" || id === "month-by-month") return "months";
  if (id === "year") return "overview";
  return null;
}

export function budgetPagedSearch(
  prev: Record<string, unknown>,
  view: BudgetPagedView,
): Record<string, unknown> {
  const next = { ...prev };
  if (view === "months") {
    next.section = "months";
    delete next.view;
    return next;
  }
  if (view === "setup") {
    if (next.section !== "year" && next.section !== "months") next.section = "year";
    next.view = "setup";
    return next;
  }
  next.section = "year";
  delete next.view;
  return next;
}

/** At most one sentence under the menu. */
export function budgetPagedSentence(view: BudgetPagedView): string {
  switch (view) {
    case "overview":
      return "This year against the plan.";
    case "months":
      return "Every month in the budget, next to actuals.";
    case "setup":
      return "Set the drivers, working capital and sources for this budget.";
  }
}
