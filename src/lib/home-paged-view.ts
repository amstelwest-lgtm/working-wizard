/**
 * Accountant client Home: the team cards, then one pane per menu item.
 * `?view=` carries the pane. Needs attention drops the param so old links stay canonical.
 * None of these values are in the `?view=` aliases that rewrite to another page.
 */

export const HOME_PAGED_VIEWS = ["attention", "progress", "books"] as const;

export type HomePagedView = (typeof HOME_PAGED_VIEWS)[number];

export const HOME_PAGED_LABEL: Record<HomePagedView, string> = {
  attention: "Needs attention",
  progress: "Team progress",
  books: "Books connection",
};

export function isHomePagedView(value: unknown): value is HomePagedView {
  return typeof value === "string" && (HOME_PAGED_VIEWS as readonly string[]).includes(value);
}

/** Unknown values, including another page's `view`, open Needs attention. */
export function homePagedViewFromSearch(view: unknown): HomePagedView {
  return isHomePagedView(view) ? view : "attention";
}

export function homePagedSearch(
  prev: Record<string, unknown>,
  view: HomePagedView,
): Record<string, unknown> {
  const next = { ...prev };
  if (view === "attention") delete next.view;
  else next.view = view;
  return next;
}
