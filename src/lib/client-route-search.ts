/**
 * Accountant client deep links.
 *
 * The studio rail is grouped: Home, Health, Cash flow, Profit, Budget,
 * Next moves, Reports, Deliverables, and Client portal. Old emails, Bot
 * answers, and PDFs still use `?tab=actions`, `?tab=overview&section=cash`,
 * and the other aliases below. Rewrite them here so a refresh lands on the
 * new item. The rewrite is idempotent: a canonical URL comes back unchanged.
 *
 * Each side-menu sub-heading is its own page. `section` is that page
 * (`?tab=profit&section=lines`). A parent with nothing left but those
 * pages has no section: that URL is a short overview. Health's parent is
 * the Score and Where it hurts lines. The figures stay on that parent.
 * Score / Where it hurts are sections. Old anchors (`#pane-collections`, `#coach-pillars`) and old
 * `?tab=` aliases (`waterfall`, `collections`, `advisory`) rewrite to the
 * section page. `?view=lines` is the same rewrite; `view=table` opens
 * Budget month by month. `view=13week` stays on the cash forecast page.
 * The horizontal sub-tab row is gone. Other params (`coach`, `filter`,
 * `onboard`, `report`, `action`, …) are preserved by the route parser.
 * An Action Plan `filter` sticks only while the tab is `plan`.
 */

export const CLIENT_RAIL_TABS = [
  "home",
  "health",
  "cash",
  "profit",
  "budget",
  "moves",
  "plan",
  "reports",
  "portal",
  "settings",
] as const;

export type ClientRailTab = (typeof CLIENT_RAIL_TABS)[number];

/**
 * One page per side-menu sub-heading. `pack` and `drafter` still rewrite
 * to Drafts. `forecast` and `waterfall` mean the cash / profit pages unless
 * the tab is already Reports, where they are the PDF pages.
 */
export const RAIL_SUBSECTIONS = [
  "score",
  "pillars",
  "forecast",
  "collections",
  "payables",
  "waterfall",
  "lines",
  "year",
  "months",
  "open",
  "overdue",
  "scorecard",
  "budget-pdf",
  "benchmark",
  "drafts",
  "drafter",
  "pack",
  "sent",
  "all",
  "documents",
  "connections",
  "send-agent",
] as const;

export type RailSubsection = (typeof RAIL_SUBSECTIONS)[number];

export type CanonicalClientSearch = {
  tab: ClientRailTab;
  section?: RailSubsection;
  focus?: "health" | "pillars";
};

export type LegacyPaneId =
  | "overview"
  | "ask"
  | "ratios"
  | "profit"
  | "cash"
  | "collections"
  | "payables"
  | "budget"
  | "reports"
  | "plan"
  | "advisory"
  | "drafter"
  | "summary"
  | "moves";

const RAIL_SET = new Set<string>(CLIENT_RAIL_TABS);

const LEGACY_DESTINATIONS: Record<string, CanonicalClientSearch> = {
  ask: { tab: "home" },
  bot: { tab: "home" },
  "milon-bot": { tab: "home" },
  desk: { tab: "home" },
  home: { tab: "home" },
  overview: { tab: "home" },
  ratios: { tab: "health", focus: "health" },
  health: { tab: "health", focus: "health" },
  today: { tab: "health", focus: "health" },
  "today-complex": { tab: "health", focus: "health" },
  pillars: { tab: "health", section: "pillars", focus: "pillars" },
  score: { tab: "health", section: "score", focus: "health" },
  profit: { tab: "profit" },
  waterfall: { tab: "profit", section: "waterfall" },
  profitability: { tab: "profit", section: "waterfall" },
  cash: { tab: "cash" },
  forecast: { tab: "cash", section: "forecast" },
  "cash-forecast": { tab: "cash", section: "forecast" },
  collections: { tab: "cash", section: "collections" },
  payables: { tab: "cash", section: "payables" },
  budget: { tab: "budget" },
  summary: { tab: "portal" },
  data: { tab: "portal" },
  brain: { tab: "portal" },
  "client-brain": { tab: "portal" },
  books: { tab: "portal" },
  moves: { tab: "moves" },
  "strategic-moves": { tab: "moves" },
  reports: { tab: "reports" },
  report: { tab: "reports" },
  pack: { tab: "reports", section: "drafts" },
  advisory: { tab: "reports", section: "drafts" },
  plan: { tab: "plan" },
  actions: { tab: "plan", section: "open" },
  action: { tab: "plan", section: "open" },
  "action-plan": { tab: "plan", section: "open" },
  tasks: { tab: "plan", section: "open" },
  drafter: { tab: "reports", section: "drafts" },
  deliverables: { tab: "reports", section: "drafts" },
  portal: { tab: "portal" },
};

function asFocus(value: string | null | undefined): "health" | "pillars" | undefined {
  return value === "health" || value === "pillars" ? value : undefined;
}

/** A `section` value that names a rail item or a sub-view of one. */
function destinationForSection(
  section: string,
  focus: "health" | "pillars" | undefined,
): CanonicalClientSearch | null {
  if (section === "reports" || section === "report") return { tab: "reports" };
  if (section === "pack" || section === "advisory" || section === "drafts" || section === "drafter") {
    return { tab: "reports", section: "drafts" };
  }
  if (
    section === "plan" ||
    section === "actions" ||
    section === "action" ||
    section === "action-plan" ||
    section === "tasks"
  ) {
    return { tab: "plan", section: "open" };
  }
  if (section === "pillars" || (section === "health" && focus === "pillars")) {
    return { tab: "health", section: "pillars", focus: "pillars" };
  }
  if (section === "health" || section === "ratios" || section === "today" || section === "today-complex") {
    return { tab: "health", focus: "health" };
  }
  if (section === "collections") return { tab: "cash", section: "collections" };
  if (section === "payables") return { tab: "cash", section: "payables" };
  if (section === "cash" || section === "forecast" || section === "cash-forecast") {
    return { tab: "cash", section: "forecast" };
  }
  if (section === "waterfall" || section === "profitability") {
    return { tab: "profit", section: "waterfall" };
  }
  if (section === "profit") return { tab: "profit" };
  if (section === "budget") return { tab: "budget" };
  if (section === "year") return { tab: "budget", section: "year" };
  if (section === "months") return { tab: "budget", section: "months" };
  if (section === "lines") return { tab: "profit", section: "lines" };
  if (section === "score") return { tab: "health", section: "score", focus: "health" };
  if (section === "open") return { tab: "plan", section: "open" };
  if (section === "overdue") return { tab: "plan", section: "overdue" };
  if (section === "scorecard") return { tab: "reports", section: "scorecard" };
  if (section === "all") return { tab: "reports", section: "all" };
  if (section === "documents") return { tab: "portal", section: "documents" };
  if (section === "send-agent") return { tab: "portal", section: "send-agent" };
  if (section === "sent") return { tab: "reports", section: "sent" };
  if (section === "connections") return { tab: "portal", section: "connections" };
  if (section === "moves" || section === "strategic-moves") return { tab: "moves" };
  if (
    section === "books" ||
    section === "summary" ||
    section === "data" ||
    section === "brain" ||
    section === "client-brain"
  ) {
    return { tab: "portal" };
  }
  return null;
}

function explicitRail(
  tab: ClientRailTab,
  section: string,
  focus: "health" | "pillars" | undefined,
): CanonicalClientSearch {
  if (tab === "health") {
    if (section === "pillars" || focus === "pillars") {
      return { tab: "health", section: "pillars", focus: "pillars" };
    }
    if (section === "score") return { tab: "health", section: "score", focus: "health" };
    return { tab: "health", focus: "health" };
  }
  if (tab === "cash") {
    if (section === "collections") return { tab: "cash", section: "collections" };
    if (section === "payables") return { tab: "cash", section: "payables" };
    if (section === "forecast" || section === "cash" || section === "cash-forecast") {
      return { tab: "cash", section: "forecast" };
    }
    return { tab: "cash" };
  }
  if (tab === "plan") {
    if (section === "overdue") return { tab: "plan", section: "overdue" };
    if (section === "open") return { tab: "plan", section: "open" };
    return { tab: "plan" };
  }
  if (tab === "profit") {
    if (section === "lines") return { tab: "profit", section: "lines" };
    if (section === "waterfall" || section === "profitability") {
      return { tab: "profit", section: "waterfall" };
    }
    return { tab: "profit" };
  }
  if (tab === "budget") {
    if (section === "months") return { tab: "budget", section: "months" };
    if (section === "year") return { tab: "budget", section: "year" };
    return { tab: "budget" };
  }
  if (tab === "reports") {
    if (section === "sent") return { tab: "reports", section: "sent" };
    if (
      section === "drafts" ||
      section === "pack" ||
      section === "advisory" ||
      section === "drafter"
    ) {
      return { tab: "reports", section: "drafts" };
    }
    if (
      section === "scorecard" ||
      section === "forecast" ||
      section === "waterfall" ||
      section === "budget-pdf" ||
      section === "benchmark" ||
      section === "all"
    ) {
      return { tab: "reports", section };
    }
    if (
      section === "plan" ||
      section === "actions" ||
      section === "action" ||
      section === "action-plan" ||
      section === "tasks"
    ) {
      return { tab: "plan", section: "open" };
    }
    return { tab: "reports" };
  }
  if (tab === "portal") {
    if (section === "connections") return { tab: "portal", section: "connections" };
    if (section === "documents") return { tab: "portal", section: "documents" };
    if (section === "send-agent") return { tab: "portal", section: "send-agent" };
    return { tab: "portal" };
  }
  return { tab };
}

const VIEW_SECTION_ALIAS: Record<string, RailSubsection> = {
  table: "months",
  chart: "year",
  lines: "lines",
  score: "score",
  pillars: "pillars",
  forecast: "forecast",
  collections: "collections",
  payables: "payables",
  waterfall: "waterfall",
  year: "year",
  months: "months",
  open: "open",
  overdue: "overdue",
  scorecard: "scorecard",
  drafts: "drafts",
  sent: "sent",
  all: "all",
  documents: "documents",
  connections: "connections",
  "send-agent": "send-agent",
};

/** `?view=` values that name a sub-page. `13week` is the cash forecast lens. */
function sectionFromView(view: string | null | undefined): string {
  const value = (view ?? "").trim();
  if (!value || value === "13week") return "";
  return VIEW_SECTION_ALIAS[value] ?? "";
}

/** Report key → its own page. `budget` must not reuse the Budget tab's section. */
export function reportPdfSection(report: string): RailSubsection | null {
  if (report === "scorecard" || report === "forecast" || report === "waterfall" || report === "benchmark") {
    return report;
  }
  if (report === "budget") return "budget-pdf";
  return null;
}

/**
 * A report or plan filter names a sub-page when the address did not already.
 * An explicit section wins (`section=drafts&report=scorecard` stays on Drafts).
 * An overdue plan filter always opens the overdue page.
 */
function withNamedPage(
  result: CanonicalClientSearch,
  input: { report?: string | null; filter?: string | null },
): CanonicalClientSearch {
  if (result.tab === "plan" && (input.filter ?? "").trim() === "overdue") {
    return { ...result, section: "overdue" };
  }
  if (result.section) return result;
  if (result.tab === "plan") {
    const filter = (input.filter ?? "").trim();
    if (filter === "at_risk" || filter === "blocked" || filter === "done" || filter === "all") {
      return { ...result, section: "open" };
    }
  }
  if (result.tab === "reports") {
    const report = (input.report ?? "").trim();
    const page = reportPdfSection(report);
    if (page) return { ...result, section: page };
    if (report) return { ...result, section: "all" };
  }
  return result;
}

/** Old or new client search → rail item. Safe to run twice. */
export function canonicalizeAccountantSearch(input: {
  tab?: string | null;
  section?: string | null;
  focus?: string | null;
  report?: string | null;
  filter?: string | null;
  view?: string | null;
}): CanonicalClientSearch {
  const tab = (input.tab ?? "").trim();
  const fromView = sectionFromView(input.view);
  const section = (input.section ?? "").trim() || fromView;
  const focus = asFocus(input.focus);
  const finish = (result: CanonicalClientSearch) => withNamedPage(result, input);

  if (!tab && !section) return finish({ tab: "home" });

  // Home is the three cards. Ask, Bot, and the old desk land there too.
  // A named agent stays on the search and opens that thread. `?tab=overview&section=cash`
  // still names the section, so a bare overview is the only one that collapses here.
  if (tab === "home" || (tab === "overview" && !section)) return finish({ tab: "home" });
  if (tab === "desk" || tab === "ask" || tab === "bot" || tab === "milon-bot") return finish({ tab: "home" });
  if (tab === "books") {
    if (section === "connections") return finish({ tab: "portal", section: "connections" });
    if (section === "documents") return finish({ tab: "portal", section: "documents" });
    if (section === "send-agent") return finish({ tab: "portal", section: "send-agent" });
    return finish({ tab: "portal" });
  }

  if (RAIL_SET.has(tab)) {
    return finish(explicitRail(tab as ClientRailTab, section, focus));
  }

  // `?tab=overview&section=cash` and a bare `?section=pack` name the new item.
  // `tab=overview` there is the old group, not a request to drop the section.
  if (section && (tab === "" || tab === "overview" || tab === "deliverables")) {
    const fromSection = destinationForSection(section, focus);
    if (fromSection) return finish(fromSection);
  }

  if (
    (tab === "ratios" || tab === "health" || tab === "today" || tab === "today-complex") &&
    focus === "pillars"
  ) {
    return finish({ tab: "health", section: "pillars", focus: "pillars" });
  }

  if (!tab && section) {
    return finish(destinationForSection(section, focus) ?? LEGACY_DESTINATIONS[section] ?? { tab: "home" });
  }

  return finish(LEGACY_DESTINATIONS[tab] ?? { tab: "home" });
}

/** Canonical rail tab for a raw `?tab=` value. Section lives on the full search. */
export function normalizeAccountantClientTab(tab: string): string {
  return canonicalizeAccountantSearch({ tab }).tab;
}

/** Pane the shell still mounts for a canonical (or legacy) search. */
export function legacyPaneForSearch(search: {
  tab?: string | null;
  section?: string | null;
  focus?: string | null;
}): LegacyPaneId | null {
  if (!search.tab && !search.section) return null;
  const canonical = canonicalizeAccountantSearch(search);
  switch (canonical.tab) {
    case "home":
      return "overview";
    case "health":
      return "ratios";
    case "cash":
      return "cash";
    case "profit":
      return "profit";
    case "budget":
      return "budget";
    case "moves":
      return "moves";
    case "plan":
      return "plan";
    case "reports":
      return "reports";
    case "portal":
      return "summary";
    case "settings":
      return null;
    default:
      return null;
  }
}

const PLAN_FILTERS = new Set(["overdue", "at_risk", "blocked", "done", "all"]);

/**
 * Tab, section, and the params that stick to one rail item, for `validateSearch`.
 *
 * The router merges this object over the raw query. A key left off the object
 * keeps its old value, so `?tab=reports&section=plan` would still say
 * `section=plan` after the tab becomes `plan`. `undefined` is what drops it.
 * An Action Plan filter sticks only on `plan`. `report` and `action` stick
 * only on Reports.
 */
export function accountantValidatedSearch(search: {
  tab?: unknown;
  section?: unknown;
  focus?: unknown;
  filter?: unknown;
  report?: unknown;
  action?: unknown;
  view?: unknown;
}): {
  tab?: string;
  section?: string;
  focus?: string;
  filter?: string;
  report?: string;
  action?: "preview" | "download";
} {
  const out: {
    tab?: string;
    section?: string;
    focus?: string;
    filter?: string;
    report?: string;
    action?: "preview" | "download";
  } = {};
  const viewNamesPage = sectionFromView(typeof search.view === "string" ? search.view : undefined);
  const hasAddress =
    typeof search.tab === "string" ||
    typeof search.section === "string" ||
    viewNamesPage.length > 0;
  if (!hasAddress) {
    if (typeof search.report === "string" && search.report.length > 0 && search.report.length <= 64) {
      const page = reportPdfSection(search.report) ?? "all";
      out.tab = "reports";
      out.section = page;
      out.report = search.report;
      if (search.action === "preview" || search.action === "download") out.action = search.action;
      return out;
    }
    if (search.action === "preview" || search.action === "download") out.action = search.action;
    return out;
  }
  const canonical = canonicalizeAccountantSearch({
    tab: typeof search.tab === "string" ? search.tab : undefined,
    section: typeof search.section === "string" ? search.section : undefined,
    focus: typeof search.focus === "string" ? search.focus : undefined,
    filter: typeof search.filter === "string" ? search.filter : undefined,
    report: typeof search.report === "string" ? search.report : undefined,
    view: typeof search.view === "string" ? search.view : undefined,
  });
  out.tab = canonical.tab;
  out.section = canonical.section;
  out.focus = canonical.focus;
  if (canonical.tab === "reports") {
    if (typeof search.report === "string" && search.report.length <= 64) out.report = search.report;
    if (search.action === "preview" || search.action === "download") out.action = search.action;
  } else {
    out.report = undefined;
    out.action = undefined;
  }
  out.filter =
    canonical.tab === "plan" && typeof search.filter === "string" && PLAN_FILTERS.has(search.filter)
      ? search.filter
      : undefined;
  return out;
}

/**
 * Search to write when the accountant opens a rail item or a legacy pane.
 * `tab` may be a rail id (`cash`) or a legacy pane id (`ask`, `plan`).
 * Coach crumbs do not stick. An Action Plan filter sticks only on the plan
 * tab. A Reports deep link (`report`, `action`) sticks only on Reports.
 */
export function accountantClientTabSearch<T extends object>(
  prev: T,
  tab: string,
  extras?: { section?: string },
): T {
  const canonical = canonicalizeAccountantSearch({
    tab,
    section: extras?.section,
  });
  const next: Record<string, unknown> = { ...prev, tab: canonical.tab };
  if (canonical.section) next.section = canonical.section;
  else delete next.section;
  delete next.coach;
  delete next.why;
  if (canonical.focus) next.focus = canonical.focus;
  else delete next.focus;
  // A plan filter sticks only on a plan sub-page. A bare `plan` is the
  // overview: keeping `filter=overdue` there would canonicalize straight
  // back to the Overdue page and turn its back control into a no-op.
  if (canonical.tab !== "plan" || !canonical.section) delete next.filter;
  if (canonical.tab !== "reports") {
    delete next.report;
    delete next.action;
  }
  delete next.agent;
  return next as T;
}

const NAV_AGENTS = new Set(["financial_manager", "analyst", "advisor"]);

export type ClientNavSelection = {
  headingId: string;
  subId: string | null;
};

/** Which collapsible heading and sub-item the current client address marks. */
export function clientRailSelection(input: {
  tab?: string | null;
  section?: string | null;
  focus?: string | null;
  report?: string | null;
  filter?: string | null;
  agent?: string | null;
}): ClientNavSelection {
  const canonical = canonicalizeAccountantSearch(input);
  const section = canonical.section ?? "";
  const report = (input.report ?? "").trim();
  const agent = (input.agent ?? "").trim();
  switch (canonical.tab) {
    case "home":
      return {
        headingId: "home",
        subId: NAV_AGENTS.has(agent) ? agent : null,
      };
    case "health":
      if (section === "pillars" || canonical.focus === "pillars") {
        return { headingId: "health", subId: "pillars" };
      }
      if (section === "score") return { headingId: "health", subId: "score" };
      return { headingId: "health", subId: null };
    case "cash":
      if (section === "collections") return { headingId: "cash", subId: "collections" };
      if (section === "payables") return { headingId: "cash", subId: "payables" };
      if (section === "forecast") return { headingId: "cash", subId: "forecast" };
      return { headingId: "cash", subId: null };
    case "profit":
      if (section === "lines") return { headingId: "profit", subId: "lines" };
      if (section === "waterfall") return { headingId: "profit", subId: "waterfall" };
      return { headingId: "profit", subId: null };
    case "budget":
      if (section === "months") return { headingId: "budget", subId: "months" };
      if (section === "year") return { headingId: "budget", subId: "year" };
      return { headingId: "budget", subId: null };
    case "moves":
      return { headingId: "moves", subId: null };
    case "plan":
      if (section === "overdue" || input.filter === "overdue") {
        return { headingId: "plan", subId: "overdue" };
      }
      if (section === "open") return { headingId: "plan", subId: "open" };
      return { headingId: "plan", subId: null };
    case "reports":
      if (section === "sent") return { headingId: "reports", subId: "sent" };
      if (section === "drafts") return { headingId: "reports", subId: "drafts" };
      if (
        section === "scorecard" ||
        section === "forecast" ||
        section === "waterfall" ||
        section === "budget-pdf" ||
        section === "benchmark" ||
        section === "all"
      ) {
        return { headingId: "reports", subId: section };
      }
      if (reportPdfSection(report)) {
        return { headingId: "reports", subId: reportPdfSection(report) };
      }
      if (report) return { headingId: "reports", subId: "all" };
      return { headingId: "reports", subId: null };
    case "portal":
      if (section === "connections") return { headingId: "books", subId: "connections" };
      if (section === "documents") return { headingId: "books", subId: "documents" };
      if (section === "send-agent") return { headingId: "books", subId: "send-agent" };
      return { headingId: "books", subId: null };
    case "settings":
      return { headingId: "settings", subId: null };
    default:
      return { headingId: "home", subId: null };
  }
}

/** Search to write when a heading or sub-item is chosen. The pane underneath stays the one it already is. */
export function clientNavSearch<T extends object>(
  prev: T,
  headingId: string,
  subId?: string | null,
): T {
  const sub = subId ?? null;
  if (headingId === "home") {
    const next = accountantClientTabSearch(prev, "home") as Record<string, unknown>;
    if (sub && NAV_AGENTS.has(sub)) next.agent = sub;
    return next as T;
  }
  if (headingId === "health") {
    if (sub === "pillars") return accountantClientTabSearch(prev, "health", { section: "pillars" });
    if (sub === "score") return accountantClientTabSearch(prev, "health", { section: "score" });
    return accountantClientTabSearch(prev, "health");
  }
  if (headingId === "cash") {
    if (sub === "collections" || sub === "payables" || sub === "forecast") {
      return accountantClientTabSearch(prev, "cash", { section: sub });
    }
    return accountantClientTabSearch(prev, "cash");
  }
  if (headingId === "profit") {
    if (sub === "lines" || sub === "waterfall") {
      return accountantClientTabSearch(prev, "profit", { section: sub });
    }
    return accountantClientTabSearch(prev, "profit");
  }
  if (headingId === "budget") {
    if (sub === "months" || sub === "year") {
      return accountantClientTabSearch(prev, "budget", { section: sub });
    }
    return accountantClientTabSearch(prev, "budget");
  }
  if (headingId === "moves") return accountantClientTabSearch(prev, "moves");
  if (headingId === "plan") {
    if (sub === "overdue") {
      const next = accountantClientTabSearch(prev, "plan", { section: "overdue" }) as Record<string, unknown>;
      next.filter = "overdue";
      return next as T;
    }
    if (sub === "open") {
      const next = accountantClientTabSearch(prev, "plan", { section: "open" }) as Record<string, unknown>;
      delete next.filter;
      return next as T;
    }
    const next = accountantClientTabSearch(prev, "plan") as Record<string, unknown>;
    delete next.filter;
    return next as T;
  }
  if (headingId === "reports") {
    if (sub === "drafts") return accountantClientTabSearch(prev, "reports", { section: "drafts" });
    if (sub === "sent") {
      const next = accountantClientTabSearch(prev, "reports", { section: "sent" }) as Record<string, unknown>;
      delete next.report;
      delete next.action;
      return next as T;
    }
    if (
      sub === "scorecard" ||
      sub === "forecast" ||
      sub === "waterfall" ||
      sub === "benchmark" ||
      sub === "budget-pdf"
    ) {
      const next = accountantClientTabSearch(prev, "reports", { section: sub }) as Record<string, unknown>;
      next.report = sub === "budget-pdf" ? "budget" : sub;
      return next as T;
    }
    if (sub === "all") {
      const next = accountantClientTabSearch(prev, "reports", { section: "all" }) as Record<string, unknown>;
      delete next.report;
      delete next.action;
      return next as T;
    }
    const next = accountantClientTabSearch(prev, "reports") as Record<string, unknown>;
    delete next.report;
    delete next.action;
    return next as T;
  }
  if (headingId === "books") {
    if (sub === "connections" || sub === "documents" || sub === "send-agent") {
      return accountantClientTabSearch(prev, "portal", { section: sub });
    }
    return accountantClientTabSearch(prev, "portal");
  }
  if (headingId === "settings") {
    const next = accountantClientTabSearch(prev, "settings") as Record<string, unknown>;
    delete next.invite;
    return next as T;
  }
  return accountantClientTabSearch(prev, "home");
}

/** Hashes that used to point at the drafter while it lived under the pack. */
const DRAFTER_HASHES = new Set(["drafter", "advisory-drafter"]);
const SENT_HASHES = new Set(["sent", "sent-history"]);

/**
 * Hash to hand the router. `window.location.hash` already includes `#`.
 * Passing that string through again writes `##drafter`.
 */
export function routerHash(hash: string | null | undefined): string | undefined {
  const bare = (hash ?? "").replace(/^#+/, "").split("?")[0].trim();
  return bare || undefined;
}

export function drafterSectionForHash(
  section: string | null | undefined,
  hash: string | null | undefined,
): "drafts" | "sent" | null {
  const id = (routerHash(hash) ?? "").toLowerCase();
  if (SENT_HASHES.has(id)) {
    if ((section ?? "").trim() === "sent") return null;
    return "sent";
  }
  if (!DRAFTER_HASHES.has(id)) return null;
  const current = (section ?? "").trim();
  if (current === "drafts" || current === "drafter") return null;
  return "drafts";
}

const HASH_DESTINATIONS: Record<string, CanonicalClientSearch> = {
  cash: { tab: "cash", section: "forecast" },
  budget: { tab: "budget", section: "year" },
  advisory: { tab: "reports", section: "drafts" },
  pack: { tab: "reports", section: "drafts" },
};

/** Anchors that used to scroll inside a tab. They open that sub-page. */
const SECTION_HASHES: Record<string, CanonicalClientSearch> = {
  "coach-pillars": { tab: "health", section: "pillars", focus: "pillars" },
  pillars: { tab: "health", section: "pillars", focus: "pillars" },
  score: { tab: "health", section: "score", focus: "health" },
  "pane-collections": { tab: "cash", section: "collections" },
  collections: { tab: "cash", section: "collections" },
  "pane-payables": { tab: "cash", section: "payables" },
  payables: { tab: "cash", section: "payables" },
  "product-lines": { tab: "profit", section: "lines" },
  lines: { tab: "profit", section: "lines" },
  "pane-waterfall": { tab: "profit", section: "waterfall" },
  months: { tab: "budget", section: "months" },
  "month-by-month": { tab: "budget", section: "months" },
  year: { tab: "budget", section: "year" },
  "reports-drafts": { tab: "reports", section: "drafts" },
  "reports-sent": { tab: "reports", section: "sent" },
  scorecard: { tab: "reports", section: "scorecard" },
  connections: { tab: "portal", section: "connections" },
  "accounting-connect": { tab: "portal", section: "connections" },
  documents: { tab: "portal", section: "documents" },
};

/** `#cash`, `#budget`, `#advisory`, section anchors, and the old drafter hashes. */
export function railSearchForHash(hash: string | null | undefined): CanonicalClientSearch | null {
  const id = (routerHash(hash) ?? "").toLowerCase();
  if (!id) return null;
  if (SENT_HASHES.has(id)) return { tab: "reports", section: "sent" };
  if (DRAFTER_HASHES.has(id)) return { tab: "reports", section: "drafts" };
  if (id === "waterfall") return { tab: "profit", section: "waterfall" };
  return HASH_DESTINATIONS[id] ?? SECTION_HASHES[id] ?? null;
}

/**
 * Where a legacy hash should navigate, given the search already on the URL.
 * An explicit rail item on a different item wins (`?tab=home#budget` stays on Home).
 * Drafter hashes still leave the pack for the drafter, unless Home was explicit.
 */
export function legacyHashDestination(
  search: { tab?: string | null; section?: string | null },
  hash: string | null | undefined,
): CanonicalClientSearch | null {
  const id = (routerHash(hash) ?? "").toLowerCase();
  if (!id) return null;
  const tab = (search.tab ?? "").trim();
  const section = (search.section ?? "").trim();
  const homeExplicit = tab === "ask" || tab === "home" || tab === "bot" || tab === "milon-bot";
  if (DRAFTER_HASHES.has(id) || SENT_HASHES.has(id)) {
    if (homeExplicit) return null;
    if (DRAFTER_HASHES.has(id)) {
      if (section === "drafts" || section === "drafter") return null;
      return { tab: "reports", section: "drafts" };
    }
    if (section === "sent") return null;
    return { tab: "reports", section: "sent" };
  }
  const current = canonicalizeAccountantSearch(search);
  const sectionHash =
    id === "waterfall"
      ? current.tab === "reports"
        ? ({ tab: "reports", section: "waterfall" } as const)
        : ({ tab: "profit", section: "waterfall" } as const)
      : SECTION_HASHES[id];
  if (sectionHash) {
    if (homeExplicit) return null;
    if (current.tab === sectionHash.tab && (current.section ?? undefined) === sectionHash.section) return null;
    return sectionHash;
  }
  const mapped = HASH_DESTINATIONS[id];
  if (!mapped) return null;
  if (!tab && !section) return mapped;
  if (current.tab !== mapped.tab) return null;
  if (current.section && current.section !== mapped.section) return null;
  if (current.tab === mapped.tab && (current.section ?? undefined) === mapped.section) return null;
  return mapped;
}

/**
 * Search the client route keeps. Same merge rules as `validateSearch`:
 * a key set to `undefined` is dropped, a key left off is kept.
 * Canonical tab/section come from `accountantValidatedSearch`.
 */
export function accountantClientRouteSearch(search: Record<string, unknown>): {
  qbo?: string;
  xero?: string;
  reason?: string;
  onboard?: string;
  note?: string;
  tab?: string;
  section?: string;
  filter?: string;
  queries?: string;
  coach?: string;
  why?: string;
  focus?: string;
  report?: string;
  action?: "preview" | "download";
  agent?: string;
  profile?: number;
  view?: "chart" | "table" | "13week" | "setup" | "audit" | "scenario";
  invite?: "owner";
  draft?: string;
} {
  const out: {
    qbo?: string;
    xero?: string;
    reason?: string;
    onboard?: string;
    note?: string;
    tab?: string;
    section?: string;
    filter?: string;
    queries?: string;
    coach?: string;
    why?: string;
    focus?: string;
    report?: string;
    action?: "preview" | "download";
    agent?: string;
    profile?: number;
    view?: "chart" | "table" | "13week" | "setup" | "audit" | "scenario";
    invite?: "owner";
    draft?: string;
  } = {};
  if (typeof search.qbo === "string") out.qbo = search.qbo;
  if (typeof search.xero === "string") out.xero = search.xero;
  if (typeof search.reason === "string") out.reason = search.reason;
  if (typeof search.onboard === "string") out.onboard = search.onboard;
  if (typeof search.note === "string") out.note = search.note;
  Object.assign(out, accountantValidatedSearch(search));
  if (typeof search.queries === "string") out.queries = search.queries;
  if (typeof search.coach === "string" && search.coach.length <= 32) out.coach = search.coach;
  if (typeof search.why === "string" && search.why.trim()) out.why = search.why.slice(0, 180);
  if (
    search.agent === "financial_manager" ||
    search.agent === "analyst" ||
    search.agent === "advisor"
  ) {
    out.agent = search.agent;
  }
  if (search.profile === 1 || search.profile === "1") out.profile = 1;
  if (typeof search.draft === "string" && /^[0-9a-f-]{36}$/i.test(search.draft)) out.draft = search.draft;
  if (out.tab === "cash" || out.section === "forecast") {
    const view = search.view === "table" ? "13week" : search.view;
    if (view === "13week" || view === "setup" || view === "audit" || view === "scenario") {
      out.view = view;
    }
  }
  if (search.invite === "owner" && out.tab === "settings") out.invite = "owner";
  return out;
}
