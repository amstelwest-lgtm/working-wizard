/**
 * Accountant client deep links.
 *
 * The studio rail is Bot (`tab=ask`), Overview (`tab=overview` plus `section`),
 * and Deliverables (`tab=deliverables` plus `section`). Old emails, Bot
 * answers, and PDFs still use `?tab=actions`, `?tab=health`, and the other
 * aliases below. Rewrite them here so a refresh lands on the same pane.
 * The rewrite is idempotent: a canonical URL comes back unchanged.
 *
 * `focus=pillars` stays on the pillars section so the Health pane can keep
 * its existing heading check. Other params (`coach`, `filter`, `onboard`,
 * `report`, `action`, …) are preserved by the route parser.
 */

export const OVERVIEW_SECTIONS = [
  "health",
  "pillars",
  "cash",
  "profit",
  "collections",
  "payables",
  "budget",
  "moves",
  "books",
] as const;

export const DELIVERABLE_SECTIONS = ["reports", "pack", "plan", "drafter"] as const;

export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number];
export type DeliverableSection = (typeof DELIVERABLE_SECTIONS)[number];
export type ClientRailTab = "ask" | "overview" | "deliverables";

export type CanonicalClientSearch = {
  tab: ClientRailTab;
  section?: OverviewSection | DeliverableSection;
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

const OVERVIEW_SECTION_SET = new Set<string>(OVERVIEW_SECTIONS);
const DELIVERABLE_SECTION_SET = new Set<string>(DELIVERABLE_SECTIONS);

const LEGACY_DESTINATIONS: Record<string, CanonicalClientSearch> = {
  ask: { tab: "ask" },
  bot: { tab: "ask" },
  "milon-bot": { tab: "ask" },
  overview: { tab: "overview" },
  ratios: { tab: "overview", section: "health", focus: "health" },
  health: { tab: "overview", section: "health", focus: "health" },
  today: { tab: "overview", section: "health", focus: "health" },
  "today-complex": { tab: "overview", section: "health", focus: "health" },
  pillars: { tab: "overview", section: "pillars", focus: "pillars" },
  profit: { tab: "overview", section: "profit" },
  waterfall: { tab: "overview", section: "profit" },
  profitability: { tab: "overview", section: "profit" },
  cash: { tab: "overview", section: "cash" },
  forecast: { tab: "overview", section: "cash" },
  "cash-forecast": { tab: "overview", section: "cash" },
  collections: { tab: "overview", section: "collections" },
  payables: { tab: "overview", section: "payables" },
  budget: { tab: "overview", section: "budget" },
  summary: { tab: "overview", section: "books" },
  data: { tab: "overview", section: "books" },
  brain: { tab: "overview", section: "books" },
  "client-brain": { tab: "overview", section: "books" },
  moves: { tab: "overview", section: "moves" },
  "strategic-moves": { tab: "overview", section: "moves" },
  reports: { tab: "deliverables", section: "reports" },
  report: { tab: "deliverables", section: "reports" },
  pack: { tab: "deliverables", section: "pack" },
  advisory: { tab: "deliverables", section: "pack" },
  plan: { tab: "deliverables", section: "plan" },
  actions: { tab: "deliverables", section: "plan" },
  action: { tab: "deliverables", section: "plan" },
  "action-plan": { tab: "deliverables", section: "plan" },
  tasks: { tab: "deliverables", section: "plan" },
};

function asFocus(value: string | null | undefined): "health" | "pillars" | undefined {
  return value === "health" || value === "pillars" ? value : undefined;
}

function overviewSection(
  section: string,
  focus: "health" | "pillars" | undefined,
): CanonicalClientSearch | null {
  if (!OVERVIEW_SECTION_SET.has(section)) return null;
  if (section === "pillars" || (section === "health" && focus === "pillars")) {
    return { tab: "overview", section: "pillars", focus: "pillars" };
  }
  if (section === "health") return { tab: "overview", section: "health", focus: "health" };
  return { tab: "overview", section: section as OverviewSection };
}

/** Old or new client search → rail tab + section. Safe to run twice. */
export function canonicalizeAccountantSearch(input: {
  tab?: string | null;
  section?: string | null;
  focus?: string | null;
}): CanonicalClientSearch {
  const tab = (input.tab ?? "").trim();
  const section = (input.section ?? "").trim();
  const focus = asFocus(input.focus);

  if (!tab && !section) return { tab: "overview" };

  // An explicit Bot tab wins over a section or hash default.
  if (tab === "ask" || tab === "bot" || tab === "milon-bot") return { tab: "ask" };

  // `pack` is a Deliverables section. `?section=pack` and the old
  // `?section=pack&tab=overview` redirect both mean the Advisory pack.
  // `tab=overview` there is the default, not a request to drop the section.
  if (
    DELIVERABLE_SECTION_SET.has(section) &&
    (tab === "" || tab === "overview" || tab === "deliverables")
  ) {
    return { tab: "deliverables", section: section as DeliverableSection };
  }

  if (tab === "overview" || tab === "deliverables" || (!tab && section)) {
    const rail: ClientRailTab = tab === "deliverables" ? "deliverables" : "overview";
    if (rail === "deliverables") {
      if (DELIVERABLE_SECTION_SET.has(section)) {
        return { tab: "deliverables", section: section as DeliverableSection };
      }
      const fromSection = LEGACY_DESTINATIONS[section];
      if (fromSection?.tab === "deliverables") return fromSection;
      return { tab: "deliverables" };
    }
    const overview = overviewSection(section, focus);
    if (overview) return overview;
    if (!tab) {
      const legacy = LEGACY_DESTINATIONS[section];
      if (legacy) return legacy;
    }
    if (focus === "pillars") return { tab: "overview", section: "pillars", focus: "pillars" };
    return { tab: "overview" };
  }

  if (
    (tab === "ratios" || tab === "health" || tab === "today" || tab === "today-complex") &&
    focus === "pillars"
  ) {
    return { tab: "overview", section: "pillars", focus: "pillars" };
  }

  return LEGACY_DESTINATIONS[tab] ?? { tab: "overview" };
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
  if (!search.tab) return null;
  const canonical = canonicalizeAccountantSearch(search);
  if (canonical.tab === "ask") return "ask";
  if (canonical.tab === "deliverables") {
    if (canonical.section === "pack") return "advisory";
    if (canonical.section === "plan") return "plan";
    if (canonical.section === "drafter") return "drafter";
    return "reports";
  }
  switch (canonical.section) {
    case "health":
    case "pillars":
      return "ratios";
    case "profit":
      return "profit";
    case "cash":
      return "cash";
    case "collections":
      return "collections";
    case "payables":
      return "payables";
    case "budget":
      return "budget";
    case "moves":
      return "moves";
    case "books":
      return "summary";
    default:
      return "overview";
  }
}

/**
 * Search to write when the accountant opens a rail item or a section.
 * `tab` may be a rail id (`overview`) or a legacy pane id (`cash`, `reports`).
 * Coach crumbs do not stick. An Action Plan filter sticks only on the plan
 * section. A Reports deep link (`report`, `action`) sticks only on reports.
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
  if (canonical.section !== "plan") delete next.filter;
  if (canonical.section !== "reports") {
    delete next.report;
    delete next.action;
  }
  return next as T;
}

/** Hashes that used to point at the drafter while it lived under the pack. */
const DRAFTER_HASHES = new Set(["drafter", "sent", "sent-history", "advisory-drafter"]);

/**
 * Hash to hand the router. `window.location.hash` already includes `#`.
 * Passing that string through again writes `##drafter`.
 *
 * `section=pack#drafter` and a sent-history hash land on the drafter section.
 * A hash that is already on that section stays put.
 */
export function routerHash(hash: string | null | undefined): string | undefined {
  const bare = (hash ?? "").replace(/^#+/, "").split("?")[0].trim();
  return bare || undefined;
}

export function drafterSectionForHash(
  section: string | null | undefined,
  hash: string | null | undefined,
): "drafter" | null {
  const id = (routerHash(hash) ?? "").toLowerCase();
  if (!DRAFTER_HASHES.has(id)) return null;
  if ((section ?? "").trim() === "drafter") return null;
  return "drafter";
}

const HASH_DESTINATIONS: Record<string, CanonicalClientSearch> = {
  cash: { tab: "overview", section: "cash" },
  budget: { tab: "overview", section: "budget" },
  advisory: { tab: "deliverables", section: "pack" },
  pack: { tab: "deliverables", section: "pack" },
};

/** `#cash`, `#budget`, `#advisory`, and the old drafter hashes. */
export function railSearchForHash(hash: string | null | undefined): CanonicalClientSearch | null {
  const id = (routerHash(hash) ?? "").toLowerCase();
  if (!id) return null;
  if (DRAFTER_HASHES.has(id)) return { tab: "deliverables", section: "drafter" };
  return HASH_DESTINATIONS[id] ?? null;
}

/**
 * Where a legacy hash should navigate, given the search already on the URL.
 * An explicit rail tab on a different rail wins (`?tab=ask#budget` stays on Bot).
 * A hash that names a section of the current rail is selected.
 * Drafter hashes still leave the pack for the drafter, unless Bot was explicit.
 */
export function legacyHashDestination(
  search: { tab?: string | null; section?: string | null },
  hash: string | null | undefined,
): CanonicalClientSearch | null {
  const id = (routerHash(hash) ?? "").toLowerCase();
  if (!id) return null;
  const tab = (search.tab ?? "").trim();
  const section = (search.section ?? "").trim();
  if (DRAFTER_HASHES.has(id)) {
    if (tab === "ask") return null;
    if (section === "drafter") return null;
    return { tab: "deliverables", section: "drafter" };
  }
  const mapped = HASH_DESTINATIONS[id];
  if (!mapped) return null;
  const explicit = tab === "ask" || tab === "overview" || tab === "deliverables";
  if (explicit && tab !== mapped.tab) return null;
  if (section && section !== mapped.section) return null;
  if (tab === mapped.tab && section === mapped.section) return null;
  return mapped;
}
