/**
 * Accountant cash forecast page: one pane per menu item, opening on the graph.
 * `?view=` carries the pane. Graph drops the param so old links stay canonical.
 */
import { hashIsCashDetailAnchor } from "./cash-forecast-view.ts";

export const CASH_PAGED_VIEWS = ["graph", "13week", "setup", "audit", "scenario"] as const;

export type CashPagedView = (typeof CASH_PAGED_VIEWS)[number];

export const CASH_PAGED_LABEL: Record<CashPagedView, string> = {
  graph: "Forecast",
  "13week": "13-week",
  setup: "Forecast setup",
  audit: "Audit inputs",
  scenario: "Scenario planning",
};

export function isCashPagedView(value: unknown): value is CashPagedView {
  return typeof value === "string" && (CASH_PAGED_VIEWS as readonly string[]).includes(value);
}

/** Old Chart/Table values and unknown strings fall back to the graph. */
export function cashPagedViewFromSearch(view: unknown): CashPagedView {
  if (view === "table") return "13week";
  return isCashPagedView(view) ? view : "graph";
}

/** Old in-page anchors that now open a pane. Null when the hash is not one of them. */
export function cashPagedViewFromHash(hash: string | null | undefined): CashPagedView | null {
  const id = (hash ?? "").replace(/^#/, "").split("?")[0].trim().toLowerCase();
  if (!id) return null;
  if (hashIsCashDetailAnchor(id)) return "13week";
  if (id === "wizard-cash-setup") return "setup";
  if (id === "wizard-cash-scenario") return "scenario";
  if (id === "wizard-cash-audit") return "audit";
  return null;
}

export function cashPagedSearch(
  prev: Record<string, unknown>,
  view: CashPagedView,
): Record<string, unknown> {
  const next = { ...prev };
  if (view === "graph") delete next.view;
  else next.view = view;
  return next;
}

/** At most one sentence under the menu. Null hides the line. */
export function cashPagedSentence(
  view: CashPagedView,
  opts: { floorText?: string | null; empty?: boolean; readOnly?: boolean } = {},
): string | null {
  switch (view) {
    case "graph":
      if (opts.empty) return null;
      return opts.floorText
        ? `Closing bank balance for each of the next 13 weeks against the ${opts.floorText} floor.`
        : "Closing bank balance for each of the next 13 weeks.";
    case "13week":
      return opts.readOnly
        ? "Red weeks are below the floor."
        : "Double-click a figure to edit it; red weeks are below the floor.";
    case "setup":
      return "Set the start date, opening balance and every line that moves cash.";
    case "audit":
      return "Approve each input before you sign off the forecast.";
    case "scenario":
      return "Test changes without touching the base forecast.";
  }
}

/** Only the graph and the weekly table have something worth enlarging. */
export function cashPagedEnlargeTarget(view: CashPagedView): "chart" | "table" | null {
  if (view === "graph") return "chart";
  if (view === "13week") return "table";
  return null;
}
