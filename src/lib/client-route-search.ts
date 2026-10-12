/**
 * Accountant client deep links.
 *
 * The studio rail is grouped: Home, Health, Cash flow, Profit, Budget,
 * Next moves, Reports, Deliverables, and Client portal. Old emails, Bot
 * answers, and PDFs still use `?tab=actions`, `?tab=overview&section=cash`,
 * and the other aliases below. Rewrite them here so a refresh lands on the
 * new item. The rewrite is idempotent: a canonical URL comes back unchanged.
 *
 * `focus=pillars` stays on Health so that pane can keep its heading check.
 * Collections and payables stay a section of Cash flow. Action plan is its own
 * rail item. Pack, the drafter, and a bare Deliverables link scroll to Drafts
 * on Reports. Sent stays the third region of that same page. The horizontal
 * sub-tab row is gone. Other params (`coach`, `filter`, `onboard`, `report`,
 * `action`, …) are preserved by the route parser. An Action Plan `filter`
 * sticks only while the tab is `plan`.
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
] as const;

export type ClientRailTab = (typeof CLIENT_RAIL_TABS)[number];

/**
 * Sub-views under a rail item. `lines`, `months`, `sent`, and `connections`
 * mark a collapsible sub-item. They do not open a different pane.
 */
export const RAIL_SUBSECTIONS = [
  "pillars",
  "collections",
  "payables",
  "pack",
  "drafts",
  "drafter",
  "lines",
  "months",
  "sent",
  "connections",
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
  profit: { tab: "profit" },
  waterfall: { tab: "profit" },
  profitability: { tab: "profit" },
  cash: { tab: "cash" },
  forecast: { tab: "cash" },
  "cash-forecast": { tab: "cash" },
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
  actions: { tab: "plan" },
  action: { tab: "plan" },
  "action-plan": { tab: "plan" },
  tasks: { tab: "plan" },
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
    return { tab: "plan" };
  }
  if (section === "pillars" || (section === "health" && focus === "pillars")) {
    return { tab: "health", section: "pillars", focus: "pillars" };
  }
  if (section === "health" || section === "ratios" || section === "today" || section === "today-complex") {
    return { tab: "health", focus: "health" };
  }
  if (section === "collections") return { tab: "cash", section: "collections" };
  if (section === "payables") return { tab: "cash", section: "payables" };
  if (section === "cash" || section === "forecast" || section === "cash-forecast") return { tab: "cash" };
  if (section === "profit" || section === "waterfall" || section === "profitability") return { tab: "profit" };
  if (section === "budget") return { tab: "budget" };
  if (section === "months") return { tab: "budget", section: "months" };
  if (section === "lines") return { tab: "profit", section: "lines" };
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
    return { tab: "health", focus: "health" };
  }
  if (tab === "cash") {
    if (section === "collections") return { tab: "cash", section: "collections" };
    if (section === "payables") return { tab: "cash", section: "payables" };
    return { tab: "cash" };
  }
  if (tab === "plan") return { tab: "plan" };
  if (tab === "profit") {
    if (section === "lines") return { tab: "profit", section: "lines" };
    return { tab: "profit" };
  }
  if (tab === "budget") {
    if (section === "months") return { tab: "budget", section: "months" };
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
      section === "plan" ||
      section === "actions" ||
      section === "action" ||
      section === "action-plan" ||
      section === "tasks"
    ) {
      return { tab: "plan" };
    }
    return { tab: "reports" };
  }
  if (tab === "portal") {
    if (section === "connections") return { tab: "portal", section: "connections" };
    return { tab: "portal" };
  }
  return { tab };
}

/** Old or new client search → rail item. Safe to run twice. */
export function canonicalizeAccountantSearch(input: {
  tab?: string | null;
  section?: string | null;
  focus?: string | null;
}): CanonicalClientSearch {
  const tab = (input.tab ?? "").trim();
  const section = (input.section ?? "").trim();
  const focus = asFocus(input.focus);

  if (!tab && !section) return { tab: "home" };

  // Home is the three cards. Ask, Bot, and the old desk land there too.
  // A named agent stays on the search and opens that thread. `?tab=overview&section=cash`
  // still names the section, so a bare overview is the only one that collapses here.
  if (tab === "home" || (tab === "overview" && !section)) return { tab: "home" };
  if (tab === "desk" || tab === "ask" || tab === "bot" || tab === "milon-bot") return { tab: "home" };
  if (tab === "books") {
    return section === "connections"
      ? { tab: "portal", section: "connections" }
      : { tab: "portal" };
  }

  if (RAIL_SET.has(tab)) {
    return explicitRail(tab as ClientRailTab, section, focus);
  }

  // `?tab=overview&section=cash` and a bare `?section=pack` name the new item.
  // `tab=overview` there is the old group, not a request to drop the section.
  if (section && (tab === "" || tab === "overview" || tab === "deliverables")) {
    const fromSection = destinationForSection(section, focus);
    if (fromSection) return fromSection;
  }

  if (
    (tab === "ratios" || tab === "health" || tab === "today" || tab === "today-complex") &&
    focus === "pillars"
  ) {
    return { tab: "health", section: "pillars", focus: "pillars" };
  }

  if (!tab && section) {
    return destinationForSection(section, focus) ?? LEGACY_DESTINATIONS[section] ?? { tab: "home" };
  }

  return LEGACY_DESTINATIONS[tab] ?? { tab: "home" };
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
      if (canonical.section === "collections") return "collections";
      if (canonical.section === "payables") return "payables";
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
  const hasAddress = typeof search.tab === "string" || typeof search.section === "string";
  if (!hasAddress) {
    if (typeof search.report === "string" && search.report.length <= 64) out.report = search.report;
    if (search.action === "preview" || search.action === "download") out.action = search.action;
    return out;
  }
  const canonical = canonicalizeAccountantSearch({
    tab: typeof search.tab === "string" ? search.tab : undefined,
    section: typeof search.section === "string" ? search.section : undefined,
    focus: typeof search.focus === "string" ? search.focus : undefined,
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
  if (canonical.tab !== "plan") delete next.filter;
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
      return {
        headingId: "health",
        subId: section === "pillars" || canonical.focus === "pillars" ? "pillars" : "score",
      };
    case "cash":
      if (section === "collections") return { headingId: "cash", subId: "collections" };
      if (section === "payables") return { headingId: "cash", subId: "payables" };
      return { headingId: "cash", subId: "forecast" };
    case "profit":
      return { headingId: "profit", subId: section === "lines" ? "lines" : "waterfall" };
    case "budget":
      return { headingId: "budget", subId: section === "months" ? "months" : "year" };
    case "moves":
      return { headingId: "moves", subId: null };
    case "plan":
      return { headingId: "plan", subId: input.filter === "overdue" ? "overdue" : "open" };
    case "reports":
      if (section === "sent") return { headingId: "reports", subId: "sent" };
      if (section === "drafts") return { headingId: "reports", subId: "drafts" };
      if (report === "scorecard" || report === "forecast" || report === "waterfall") {
        return { headingId: "reports", subId: report };
      }
      return { headingId: "reports", subId: "all" };
    case "portal":
      return { headingId: "books", subId: section === "connections" ? "connections" : "documents" };
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
    return accountantClientTabSearch(prev, "health", sub === "pillars" ? { section: "pillars" } : undefined);
  }
  if (headingId === "cash") {
    if (sub === "collections" || sub === "payables") {
      return accountantClientTabSearch(prev, "cash", { section: sub });
    }
    return accountantClientTabSearch(prev, "cash");
  }
  if (headingId === "profit") {
    return accountantClientTabSearch(prev, "profit", sub === "lines" ? { section: "lines" } : undefined);
  }
  if (headingId === "budget") {
    return accountantClientTabSearch(prev, "budget", sub === "months" ? { section: "months" } : undefined);
  }
  if (headingId === "moves") return accountantClientTabSearch(prev, "moves");
  if (headingId === "plan") {
    const next = accountantClientTabSearch(prev, "plan") as Record<string, unknown>;
    if (sub === "overdue") next.filter = "overdue";
    else delete next.filter;
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
    if (sub === "scorecard" || sub === "forecast" || sub === "waterfall") {
      const next = accountantClientTabSearch(prev, "reports") as Record<string, unknown>;
      next.report = sub;
      return next as T;
    }
    const next = accountantClientTabSearch(prev, "reports") as Record<string, unknown>;
    delete next.report;
    delete next.action;
    return next as T;
  }
  if (headingId === "books") {
    return accountantClientTabSearch(
      prev,
      "portal",
      sub === "connections" ? { section: "connections" } : undefined,
    );
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
  cash: { tab: "cash" },
  budget: { tab: "budget" },
  advisory: { tab: "reports", section: "drafts" },
  pack: { tab: "reports", section: "drafts" },
};

/** `#cash`, `#budget`, `#advisory`, and the old drafter hashes. */
export function railSearchForHash(hash: string | null | undefined): CanonicalClientSearch | null {
  const id = (routerHash(hash) ?? "").toLowerCase();
  if (!id) return null;
  if (SENT_HASHES.has(id)) return { tab: "reports", section: "sent" };
  if (DRAFTER_HASHES.has(id)) return { tab: "reports", section: "drafts" };
  return HASH_DESTINATIONS[id] ?? null;
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
  if (DRAFTER_HASHES.has(id) || SENT_HASHES.has(id)) {
    if (tab === "ask" || tab === "home" || tab === "bot" || tab === "milon-bot") return null;
    if (DRAFTER_HASHES.has(id)) {
      if (section === "drafts" || section === "drafter") return null;
      return { tab: "reports", section: "drafts" };
    }
    if (section === "sent") return null;
    return { tab: "reports", section: "sent" };
  }
  const mapped = HASH_DESTINATIONS[id];
  if (!mapped) return null;
  if (!tab && !section) return mapped;
  const current = canonicalizeAccountantSearch(search);
  if (current.tab !== mapped.tab) return null;
  if (current.section && current.section !== mapped.section) return null;
  if (current.tab === mapped.tab && (current.section ?? undefined) === mapped.section) return null;
  return mapped;
}
