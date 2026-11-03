/**
 * Profit page: one pane per menu item, opening on the chart.
 * Waterfall, the live P&L, and product lines are left-nav pages (`section`).
 * P&L is not a tab inside Profit. `?view=pnl` still names that page.
 * `?view=setup|audit` stay panes on the Profit page.
 */

export const PROFIT_PAGED_VIEWS = ["chart", "pnl", "waterfall", "lines", "setup", "audit"] as const;

export type ProfitPagedView = (typeof PROFIT_PAGED_VIEWS)[number];

export const PROFIT_PAGED_LABEL: Record<ProfitPagedView, string> = {
  chart: "Chart",
  pnl: "P&L",
  waterfall: "Waterfall",
  lines: "Product lines",
  setup: "Profit setup",
  audit: "Audit inputs",
};

export function isProfitPagedView(value: unknown): value is ProfitPagedView {
  return typeof value === "string" && (PROFIT_PAGED_VIEWS as readonly string[]).includes(value);
}

/** Section links and the `view` lens pick the pane. Chart is the landing page. */
export function profitPagedViewFromSearch(input: {
  section?: string | null;
  view?: string | null;
}): ProfitPagedView {
  const view = (input.view ?? "").trim();
  const section = (input.section ?? "").trim();
  if (section === "pnl" || section === "pl") return "pnl";
  if (view === "audit") return "audit";
  if (view === "setup" || view === "inputs") return "setup";
  if (view === "pnl" || (view === "table" && section !== "lines" && section !== "waterfall"))
    return "pnl";
  if (section === "lines") return "lines";
  if (section === "waterfall" || section === "profitability") return "waterfall";
  return "chart";
}

export function profitPagedSearch(
  prev: Record<string, unknown>,
  view: ProfitPagedView,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...prev, tab: "profit" };
  delete next.section;
  delete next.view;
  if (view === "waterfall") next.section = "waterfall";
  else if (view === "lines") next.section = "lines";
  else if (view === "pnl") next.section = "pnl";
  else if (view === "setup") next.view = "setup";
  else if (view === "audit") next.view = "audit";
  return next;
}

/** At most one sentence under the menu. */
export function profitPagedSentence(view: ProfitPagedView): string {
  switch (view) {
    case "chart":
      return "Profit across the year.";
    case "pnl":
      return "This period against the prior period, with the year to date.";
    case "waterfall":
      return "Where profit goes, from revenue down to the bottom line.";
    case "lines":
      return "Revenue and gross profit by product line.";
    case "setup":
      return "Set the period and the sources for this profit.";
    case "audit":
      return "Approve each input before you sign off profit.";
  }
}

/**
 * Chart, waterfall, lines, setup, audit. P&L is its own left-nav page,
 * so it is not a tab inside this menu.
 */
export function profitMenuViews(includeLines: boolean): ProfitPagedView[] {
  const views = includeLines
    ? [...PROFIT_PAGED_VIEWS]
    : PROFIT_PAGED_VIEWS.filter((view) => view !== "lines");
  return views.filter((view) => view !== "pnl");
}
