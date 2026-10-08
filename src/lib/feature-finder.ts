/**
 * Feature finder — jump list for the product shells.
 *
 * Accountant destinations reuse the reading-path tabs in `workflow-coach`
 * (`COACH_STEPS`): rail `tab` plus `section`. Owner destinations reuse
 * `OWNER_BOARD_TABS`,
 * the same pairs as `notes-tabs.ts` (today/ratios, waterfall/profit, tasks/plan).
 *
 * Upload uses the studio's existing `?onboard=1` deep link, which opens the
 * bring-in-figures dialog, on the Client Brain tab where the upload control
 * lives. Connect / sync lands on that same tab: Xero and QuickBooks cards
 * are rendered there. Billing has no standalone page — Manage billing is on
 * Settings, and only for the practice view.
 */
import { OWNER_BOARD_TABS } from "@/lib/next-step";
import { COACH_STEPS, type CoachStepId } from "@/lib/workflow-coach";

export type FeatureAudience = "accountant" | "owner";

export type FeatureFinderContext = {
  audience: FeatureAudience;
  /** Studio client. Omitted on the firm dashboard and anywhere a file isn't open. */
  clientId?: string | null;
};

type OwnerTab = (typeof OWNER_BOARD_TABS)[number];

export type FeatureDestination =
  | {
      kind: "client";
      clientId: string;
      search: {
        tab: "ask" | "overview" | "deliverables";
        section?: string;
        focus?: "health" | "pillars";
        onboard?: "1";
      };
    }
  | { kind: "owner"; tab: OwnerTab }
  | { kind: "dashboard" }
  | { kind: "settings" };

export type FeatureResult = {
  id: string;
  label: string;
  hint: string;
  group: string;
  destination: FeatureDestination;
  href: string;
};

export type FeatureSearch = {
  results: FeatureResult[];
  /**
   * The query matched a client studio page, but this view has no client open,
   * so nothing from that match is selectable.
   */
  needsClient: boolean;
};

type StudioTarget = {
  tab: "ask" | "overview" | "deliverables";
  section?: string;
  focus?: "health" | "pillars";
  onboard?: "1";
};

type FeatureDef = {
  id: string;
  label: string;
  hint: string;
  order: number;
  scope: "client" | "practice";
  synonyms: readonly string[];
  extraSynonyms?: Partial<Record<FeatureAudience, readonly string[]>>;
  audiences: readonly FeatureAudience[];
  requiresClient?: boolean;
  studio?: StudioTarget;
  ownerTab?: OwnerTab;
  practice?: "dashboard" | "settings";
};

function coachTarget(id: CoachStepId): StudioTarget {
  const step = COACH_STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`missing coach step ${id}`);
  const focus =
    "focus" in step && (step.focus === "health" || step.focus === "pillars")
      ? step.focus
      : undefined;
  const section = "section" in step ? step.section : undefined;
  return {
    tab: step.tab,
    ...(section ? { section } : {}),
    ...(focus ? { focus } : {}),
  };
}

const DATA = coachTarget("data");
const HEALTH = coachTarget("health");
const PILLARS = coachTarget("pillars");
const PROFIT = coachTarget("profit");
const CASH = coachTarget("cash");
const BUDGET = coachTarget("budget");
const ACTIONS = coachTarget("actions");

const FEATURES: readonly FeatureDef[] = [
  {
    id: "overview",
    label: "Overview",
    hint: "Briefing",
    order: 5,
    scope: "client",
    synonyms: ["overview", "briefing", "client home"],
    audiences: ["accountant"],
    requiresClient: true,
    studio: { tab: "overview" },
  },
  {
    id: "health",
    label: "Health",
    hint: "Health score",
    order: 10,
    scope: "client",
    synonyms: ["health score", "score", "ratios", "diagnosis", "business health"],
    extraSynonyms: { owner: ["pillars", "pillar", "where it hurts"] },
    audiences: ["accountant", "owner"],
    requiresClient: true,
    studio: HEALTH,
    ownerTab: "today",
  },
  {
    id: "pillars",
    label: "Pillars",
    hint: "Where it hurts",
    order: 20,
    scope: "client",
    synonyms: ["pillar", "where it hurts", "drag", "weakest pillar"],
    audiences: ["accountant"],
    requiresClient: true,
    studio: PILLARS,
  },
  {
    id: "profitability",
    label: "Profitability",
    hint: "Waterfall",
    order: 30,
    scope: "client",
    synonyms: ["profit", "margin", "waterfall", "gross margin"],
    audiences: ["accountant", "owner"],
    requiresClient: true,
    studio: PROFIT,
    ownerTab: "waterfall",
  },
  {
    id: "cash",
    label: "Cash",
    hint: "13-week forecast",
    order: 40,
    scope: "client",
    synonyms: ["forecast", "13-week", "13 week", "liquidity", "runway", "cash forecast"],
    audiences: ["accountant", "owner"],
    requiresClient: true,
    studio: CASH,
    ownerTab: "cash",
  },
  {
    id: "budget",
    label: "Budget",
    hint: "12-month budget",
    order: 50,
    scope: "client",
    synonyms: ["budget", "variance", "12-month", "12 month", "budget variance"],
    audiences: ["accountant", "owner"],
    requiresClient: true,
    studio: BUDGET,
    ownerTab: "budget",
  },
  {
    id: "collections",
    label: "Collections",
    hint: "Aged receivables · AR",
    order: 60,
    scope: "client",
    synonyms: ["ar", "aged receivables", "aged debtors", "debtors", "receivables", "chase list"],
    audiences: ["accountant"],
    requiresClient: true,
    studio: { tab: "overview", section: "collections" },
  },
  {
    id: "payables",
    label: "Payables",
    hint: "Aged payables · AP",
    order: 70,
    scope: "client",
    synonyms: ["ap", "aged payables", "aged creditors", "creditors", "bills", "suppliers"],
    audiences: ["accountant"],
    requiresClient: true,
    studio: { tab: "overview", section: "payables" },
  },
  {
    id: "moves",
    label: "Moves",
    hint: "Strategic moves",
    order: 75,
    scope: "client",
    synonyms: ["moves", "strategic moves", "ranked moves"],
    audiences: ["accountant"],
    requiresClient: true,
    studio: { tab: "overview", section: "moves" },
  },
  {
    id: "bot",
    label: "Bot",
    hint: "Drafts",
    order: 80,
    scope: "client",
    synonyms: ["drafts", "draft", "bot", "ask", "milon bot", "chat"],
    audiences: ["accountant"],
    requiresClient: true,
    studio: { tab: "ask" },
  },
  {
    id: "action-plan",
    label: "Action Plan",
    hint: "Sign-off",
    order: 90,
    scope: "client",
    synonyms: ["actions", "tasks", "work list", "assign", "sign-off", "signoff", "sign off"],
    audiences: ["accountant", "owner"],
    requiresClient: true,
    studio: ACTIONS,
    ownerTab: "tasks",
  },
  {
    id: "reports",
    label: "Reports",
    hint: "Reports studio",
    order: 92,
    scope: "client",
    synonyms: ["reports", "report", "board pack", "scorecard"],
    audiences: ["accountant"],
    requiresClient: true,
    studio: { tab: "deliverables", section: "reports" },
  },
  {
    id: "advisory-pack",
    label: "Advisory pack",
    hint: "Pack and recommendations",
    order: 94,
    scope: "client",
    synonyms: ["advisory pack", "pack", "recommendations", "advisory"],
    audiences: ["accountant"],
    requiresClient: true,
    studio: { tab: "deliverables", section: "pack" },
  },
  {
    id: "advisory-drafter",
    label: "Advisory drafter",
    hint: "Draft the note",
    order: 96,
    scope: "client",
    synonyms: ["advisory drafter", "drafter", "draft note", "sent history"],
    audiences: ["accountant"],
    requiresClient: true,
    studio: { tab: "deliverables", section: "drafter" },
  },
  {
    id: "data-sync",
    label: "Data & sync",
    hint: "Xero · QuickBooks",
    order: 100,
    scope: "client",
    synonyms: [
      "data",
      "sync",
      "books",
      "client brain",
      "brain",
      "xero",
      "qbo",
      "quickbooks",
      "quickbooks online",
      "connect",
      "connect xero",
      "connect quickbooks",
      "accounting",
    ],
    audiences: ["accountant"],
    requiresClient: true,
    studio: DATA,
  },
  {
    id: "upload",
    label: "Upload",
    hint: "Statements",
    order: 110,
    scope: "client",
    synonyms: ["upload statements", "statement", "statements", "pdf", "import"],
    audiences: ["accountant"],
    requiresClient: true,
    studio: { ...DATA, onboard: "1" },
  },
  {
    id: "clients",
    label: "Clients",
    hint: "Practice list",
    order: 200,
    scope: "practice",
    synonyms: ["practice", "portfolio", "firm dashboard", "dashboard", "client list"],
    audiences: ["accountant"],
    practice: "dashboard",
  },
  {
    id: "billing",
    label: "Billing",
    hint: "Manage in Settings",
    order: 210,
    scope: "practice",
    synonyms: ["subscription", "stripe", "invoice", "manage billing"],
    audiences: ["accountant"],
    practice: "settings",
  },
];

export function normalizeFeatureQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function synonymsFor(def: FeatureDef, audience: FeatureAudience): string[] {
  return [...def.synonyms, ...(def.extraSynonyms?.[audience] ?? [])];
}

function scoreText(query: string, text: string): number {
  if (!query || !text) return 0;
  if (text === query) return 100;
  const tokens = text.split(" ");
  if (tokens.includes(query)) return 95;
  if (query.length >= 2 && text.startsWith(query)) return 80;
  if (query.length >= 3 && text.includes(query)) return 60;
  if (query.length >= 3) {
    const qTokens = query.split(" ");
    if (
      qTokens.length > 0 &&
      qTokens.every((qt) => qt.length >= 2 && tokens.some((tt) => tt.startsWith(qt)))
    ) {
      return 50;
    }
  }
  if (query.length >= 4 && isSubsequence(query.replace(/ /g, ""), text.replace(/ /g, ""))) {
    return 25;
  }
  return 0;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
}

function scoreFeature(query: string, def: FeatureDef, audience: FeatureAudience): number {
  const fields = [def.label, ...synonymsFor(def, audience)];
  let best = 0;
  for (const field of fields) {
    const score = scoreText(query, normalizeFeatureQuery(field));
    if (score > best) best = score;
  }
  return best;
}

function destinationFor(def: FeatureDef, ctx: FeatureFinderContext): FeatureDestination | null {
  if (def.practice === "dashboard") return { kind: "dashboard" };
  if (def.practice === "settings") return { kind: "settings" };
  if (ctx.audience === "owner" && def.ownerTab) return { kind: "owner", tab: def.ownerTab };
  if (ctx.audience === "accountant" && def.studio) {
    const clientId = ctx.clientId?.trim();
    if (!clientId) return null;
    return { kind: "client", clientId, search: def.studio };
  }
  return null;
}

export function featureHref(dest: FeatureDestination): string {
  if (dest.kind === "dashboard") return "/dashboard";
  if (dest.kind === "settings") return "/settings";
  if (dest.kind === "owner") return `/app?tab=${encodeURIComponent(dest.tab)}`;
  const params = new URLSearchParams();
  params.set("tab", dest.search.tab);
  if (dest.search.section) params.set("section", dest.search.section);
  if (dest.search.focus) params.set("focus", dest.search.focus);
  if (dest.search.onboard) params.set("onboard", dest.search.onboard);
  return `/clients/${encodeURIComponent(dest.clientId)}?${params.toString()}`;
}

function groupLabel(def: FeatureDef, audience: FeatureAudience): string {
  if (def.scope === "practice") return "Practice";
  return audience === "owner" ? "Board" : "This client";
}

export function searchFeatures(query: string, ctx: FeatureFinderContext): FeatureSearch {
  const q = normalizeFeatureQuery(query);
  const visible = FEATURES.filter((def) => def.audiences.includes(ctx.audience));
  const scored = visible.map((def) => ({
    def,
    score: q ? scoreFeature(q, def, ctx.audience) : 1,
  }));
  const matched = scored.filter((row) => row.score > 0);
  const clientId = ctx.clientId?.trim() ?? "";
  const omitted = matched.filter((row) => row.def.requiresClient && !clientId);
  const shown = matched
    .filter((row) => !(row.def.requiresClient && !clientId))
    .sort((a, b) => b.score - a.score || a.def.order - b.def.order);

  const results: FeatureResult[] = [];
  for (const row of shown) {
    const destination = destinationFor(row.def, ctx);
    if (!destination) continue;
    results.push({
      id: row.def.id,
      label: row.def.label,
      hint: row.def.hint,
      group: groupLabel(row.def, ctx.audience),
      destination,
      href: featureHref(destination),
    });
  }

  return {
    results,
    needsClient: omitted.length > 0 && results.length === 0,
  };
}

export type FirmSectionTarget = {
  id: string;
  label: string;
  hint: string;
  score: number;
  order: number;
  search: Extract<FeatureDestination, { kind: "client" }>["search"];
};

/**
 * Studio sections named by a firm-dashboard query, where no client file is open.
 * `clientQuery` is leftover text that narrows the book (`yankees` in `budget yankees`).
 * Empty means every client has the section.
 */
export function firmSectionTargets(query: string): {
  targets: FirmSectionTarget[];
  clientQuery: string;
} {
  const q = normalizeFeatureQuery(query);
  if (!q) return { targets: [], clientQuery: "" };

  const defs = FEATURES.filter(
    (def) => def.requiresClient && def.audiences.includes("accountant") && def.studio,
  );
  const rank = (span: string) =>
    defs
      .map((def) => ({ def, score: scoreFeature(span, def, "accountant" as const) }))
      .filter((row) => row.score >= 50)
      .sort((a, b) => b.score - a.score || a.def.order - b.def.order);

  const tokens = q.split(" ").filter(Boolean);
  let best: { start: number; end: number; rows: ReturnType<typeof rank> } | null = null;
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j <= tokens.length; j++) {
      const span = tokens.slice(i, j).join(" ");
      const rows = rank(span);
      if (!rows.length) continue;
      const top = rows[0]!.score;
      const longer = best ? j - i > best.end - best.start : false;
      if (!best || top > best.rows[0]!.score || (top === best.rows[0]!.score && longer)) {
        best = { start: i, end: j, rows };
      }
    }
  }
  if (!best) return { targets: [], clientQuery: "" };

  const restTokens = [...tokens.slice(0, best.start), ...tokens.slice(best.end)];
  const rest = restTokens.join(" ");
  const restRows = rest ? rank(rest) : [];
  if (rest && restRows.length) {
    const byId = new Map<string, (typeof restRows)[number]>();
    for (const row of [...best.rows, ...restRows]) {
      const prev = byId.get(row.def.id);
      if (!prev || row.score > prev.score) byId.set(row.def.id, row);
    }
    const merged = [...byId.values()].sort(
      (a, b) => b.score - a.score || a.def.order - b.def.order,
    );
    return { targets: merged.map(toFirmSectionTarget), clientQuery: "" };
  }

  const topScore = best.rows[0]!.score;
  return {
    targets: best.rows.filter((row) => row.score === topScore).map(toFirmSectionTarget),
    clientQuery: clientQueryFrom(rest),
  };
}

/** "Budget for Yankees" uses the same "for" as the jump label. It is not part of the name. */
function clientQueryFrom(rest: string): string {
  return rest
    .split(" ")
    .filter((token) => token && token !== "for")
    .join(" ");
}

function toFirmSectionTarget(row: { def: FeatureDef; score: number }): FirmSectionTarget {
  const studio = row.def.studio;
  if (!studio) throw new Error(`section ${row.def.id} has no studio tab`);
  return {
    id: row.def.id,
    label: row.def.label,
    hint: row.def.hint,
    score: row.score,
    order: row.def.order,
    search: studio,
  };
}

/** Labels and synonyms actually indexed for an audience. Used by the PR note and tests. */
export function featureIndex(
  audience: FeatureAudience,
): { id: string; label: string; synonyms: string[] }[] {
  return FEATURES.filter((def) => def.audiences.includes(audience)).map((def) => ({
    id: def.id,
    label: def.label,
    synonyms: synonymsFor(def, audience),
  }));
}

export function isMacPlatform(platform: string, userAgent = ""): boolean {
  return /Mac|iPod|iPhone|iPad/i.test(platform) || /Mac OS X/i.test(userAgent);
}

export function featureFinderShortcutLabel(mac: boolean): "⌘K" | "Ctrl+K" {
  return mac ? "⌘K" : "Ctrl+K";
}

export function isFeatureFinderShortcut(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
  platform: string,
  userAgent = "",
): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== "k") return false;
  const mac = isMacPlatform(platform, userAgent);
  if (mac) return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && !event.metaKey;
}
