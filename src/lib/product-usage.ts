/**
 * Product-usage measuring system for Milōn Lighthouse.
 *
 * Personas:
 *   firm     — accounting practice (firm_admin / accountant)
 *   founder  — business owner (client_owner)
 *   customer — invited client member (and other signed-in product users)
 *
 * Events are mapped onto a fixed feature catalog so Lighthouse can rank
 * what people use most *and* what they never touch (zero-count features).
 */

export const USAGE_PERSONAS = ["firm", "founder", "customer"] as const;
export type UsagePersona = (typeof USAGE_PERSONAS)[number];

export const USAGE_SURFACES = ["owner_app", "accountant_portal", "reports", "other"] as const;
export type UsageSurface = (typeof USAGE_SURFACES)[number];

export const PERSONA_LABELS: Record<UsagePersona, string> = {
  firm: "Firms",
  founder: "Founders",
  customer: "Customers",
};

export type FeatureGroup = "owner" | "firm" | "shared";

export type FeatureDef = {
  key: string;
  label: string;
  group: FeatureGroup;
};

/** Screens and actions we want a most/least ranking for. */
export const FEATURE_CATALOG: FeatureDef[] = [
  { key: "owner.app", label: "Owner workspace", group: "owner" },
  { key: "owner.health", label: "Business Health", group: "owner" },
  { key: "owner.profit", label: "Profit", group: "owner" },
  { key: "owner.cash", label: "Cash forecast", group: "owner" },
  { key: "owner.budget", label: "Budget", group: "owner" },
  { key: "owner.next_moves", label: "Next moves", group: "owner" },
  { key: "owner.action_plan", label: "Action plan", group: "owner" },
  { key: "owner.view_mode", label: "Simple / complex toggle", group: "owner" },
  { key: "owner.upload_financials", label: "Upload / enter figures", group: "owner" },
  { key: "owner.notes", label: "Owner notes", group: "owner" },
  { key: "owner.profile", label: "Operating profile", group: "owner" },

  { key: "firm.dashboard", label: "Firm dashboard", group: "firm" },
  { key: "firm.client_workspace", label: "Client workspace", group: "firm" },
  { key: "firm.client_ask_ai", label: "Client Ask AI", group: "firm" },
  { key: "firm.client_health", label: "Client health & ratios", group: "firm" },
  { key: "firm.client_profit", label: "Client profitability", group: "firm" },
  { key: "firm.client_cash", label: "Client 13-week cash", group: "firm" },
  { key: "firm.client_budget", label: "Client budget", group: "firm" },
  { key: "firm.client_reports", label: "Client reports tab", group: "firm" },
  { key: "firm.client_action_plan", label: "Client action plan", group: "firm" },
  { key: "firm.advisory", label: "Advisory drafter", group: "firm" },
  { key: "firm.playbook", label: "Playbook", group: "firm" },
  { key: "firm.brand", label: "Firm brand", group: "firm" },
  { key: "firm.reports_studio", label: "Reports studio", group: "firm" },
  { key: "firm.report_preview", label: "Report preview", group: "firm" },
  { key: "firm.report_download", label: "Report download", group: "firm" },
  { key: "firm.notes", label: "Practice notes", group: "firm" },
  { key: "firm.view_mode", label: "Client simple / complex", group: "firm" },

  { key: "settings.account", label: "Account settings", group: "shared" },
];

export const FEATURE_BY_KEY: Record<string, FeatureDef> = Object.fromEntries(
  FEATURE_CATALOG.map((f) => [f.key, f]),
);

const OWNER_TAB_FEATURES: Record<string, string> = {
  today: "owner.health",
  waterfall: "owner.profit",
  cash: "owner.cash",
  budget: "owner.budget",
  next: "owner.next_moves",
  tasks: "owner.action_plan",
};

const FIRM_TAB_FEATURES: Record<string, string> = {
  ask: "firm.client_ask_ai",
  ratios: "firm.client_health",
  profit: "firm.client_profit",
  cash: "firm.client_cash",
  budget: "firm.client_budget",
  reports: "firm.client_reports",
  plan: "firm.client_action_plan",
  advisory: "firm.advisory",
};

const SKIP_PATH_PREFIXES = [
  "/ops",
  "/auth",
  "/unsubscribe",
  "/lh",
  "/email",
  "/api",
  "/lovable",
  "/reset-password",
  "/ack",
  "/t/",
  "/faq",
  "/for-owners",
  "/for-accountants",
  "/reports/demo",
];

export function shouldSkipPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  if (path === "/") return true;
  return SKIP_PATH_PREFIXES.some((p) =>
    p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`),
  );
}

export function surfaceFromPath(pathname: string): UsageSurface {
  const path = pathname.split("?")[0] || "/";
  if (path === "/app" || path.startsWith("/app/")) return "owner_app";
  if (path === "/dashboard" || path.startsWith("/clients")) return "accountant_portal";
  if (path.startsWith("/reports")) return "reports";
  return "other";
}

export function featureFromPath(pathname: string): string | null {
  const path = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  if (path === "/app") return "owner.app";
  if (path === "/dashboard") return "firm.dashboard";
  if (path.startsWith("/clients/")) return "firm.client_workspace";
  if (path === "/reports") return "firm.reports_studio";
  if (path === "/settings/brand") return "firm.brand";
  if (path === "/settings") return "settings.account";
  return null;
}

export type FeatureResolveInput = {
  event: string;
  featureKey?: string | null;
  tab?: string | null;
  path?: string | null;
  surface?: UsageSurface | null;
  reportKey?: string | null;
};

export function resolveFeatureKey(input: FeatureResolveInput): string {
  const explicit = (input.featureKey ?? "").trim();
  if (explicit && FEATURE_BY_KEY[explicit]) return explicit;
  if (explicit) return explicit.slice(0, 80);

  const event = input.event;
  const tab = (input.tab ?? "").trim();
  const surface = input.surface ?? (input.path ? surfaceFromPath(input.path) : null);

  if (event === "tab_viewed" && tab) {
    if (surface === "accountant_portal" || FIRM_TAB_FEATURES[tab]) {
      return FIRM_TAB_FEATURES[tab] ?? `firm.tab.${tab}`;
    }
    return OWNER_TAB_FEATURES[tab] ?? `owner.tab.${tab}`;
  }

  if (event === "view_mode_toggled") {
    return surface === "accountant_portal" ? "firm.view_mode" : "owner.view_mode";
  }
  if (event === "note_created") {
    if (surface === "accountant_portal" || (tab && FIRM_TAB_FEATURES[tab])) return "firm.notes";
    return "owner.notes";
  }
  if (event === "report_downloaded") return "firm.report_download";
  if (event === "report_previewed") return "firm.report_preview";
  if (event === "playbook_opened") return "firm.playbook";
  if (event === "financials_uploaded" || event === "financials_entered") {
    return "owner.upload_financials";
  }
  if (event === "profile_updated") return "owner.profile";

  if (event === "page_viewed" && input.path) {
    return featureFromPath(input.path) ?? "settings.account";
  }

  return event.replace(/[^\w.-]+/g, "_").slice(0, 80) || "unknown";
}

export type RoleLike = "accountant" | "firm_admin" | "client_owner" | "client_member" | string;

export function resolveUsagePersona(opts: {
  roles: RoleLike[];
  surface?: UsageSurface | null;
  actingAsClient?: boolean;
}): UsagePersona {
  const roles = opts.roles;
  const hasPractice = roles.some((r) => r === "firm_admin" || r === "accountant");
  const hasOwner = roles.includes("client_owner");
  const hasMember = roles.includes("client_member");

  if (opts.actingAsClient && hasPractice) return "firm";
  if (opts.surface === "accountant_portal" && hasPractice) return "firm";
  if (opts.surface === "reports" && hasPractice) return "firm";
  if (opts.surface === "owner_app") {
    if (hasOwner) return "founder";
    if (hasMember) return "customer";
    if (hasPractice) return "firm";
  }
  if (hasPractice) return "firm";
  if (hasOwner) return "founder";
  if (hasMember) return "customer";
  return "customer";
}

export type UsageEventRow = {
  occurredAt: string;
  userId: string;
  persona: UsagePersona;
  surface: UsageSurface;
  eventName: string;
  featureKey: string;
  firmId: string | null;
  clientId: string | null;
};

export type PersonaCounts = { events: number; uniqueUsers: number };

export type FeatureStat = {
  key: string;
  label: string;
  group: FeatureGroup | "other";
  inCatalog: boolean;
  events: number;
  uniqueUsers: number;
  byPersona: Record<UsagePersona, PersonaCounts>;
};

export type DailyPoint = { date: string; events: number; users: number };

export type EntityStat = {
  id: string;
  kind: "firm" | "client" | "user";
  persona: UsagePersona;
  label: string;
  events: number;
  uniqueUsers: number;
};

export type UsageRollup = {
  totals: {
    events: number;
    uniqueUsers: number;
    byPersona: Record<UsagePersona, PersonaCounts>;
  };
  features: FeatureStat[];
  mostUsed: FeatureStat[];
  leastUsed: FeatureStat[];
  unused: FeatureStat[];
  daily: DailyPoint[];
  entities: EntityStat[];
};

function emptyPersonaCounts(): Record<UsagePersona, PersonaCounts> {
  return {
    firm: { events: 0, uniqueUsers: 0 },
    founder: { events: 0, uniqueUsers: 0 },
    customer: { events: 0, uniqueUsers: 0 },
  };
}

function ymd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function rollupUsage(
  rows: UsageEventRow[],
  opts: {
    fromIso: string;
    toIso: string;
    entityLabels?: Record<string, string>;
  },
): UsageRollup {
  const featureUsers = new Map<string, Set<string>>();
  const featurePersonaUsers = new Map<string, Record<UsagePersona, Set<string>>>();
  const featureEvents = new Map<string, number>();
  const featurePersonaEvents = new Map<string, Record<UsagePersona, number>>();

  const personaUsers: Record<UsagePersona, Set<string>> = {
    firm: new Set(),
    founder: new Set(),
    customer: new Set(),
  };
  const personaEvents: Record<UsagePersona, number> = {
    firm: 0,
    founder: 0,
    customer: 0,
  };
  const allUsers = new Set<string>();

  const dayUsers = new Map<string, Set<string>>();
  const dayEvents = new Map<string, number>();

  const entityEvents = new Map<string, number>();
  const entityUsers = new Map<string, Set<string>>();
  const entityMeta = new Map<
    string,
    { kind: EntityStat["kind"]; persona: UsagePersona; label: string }
  >();

  const labels = opts.entityLabels ?? {};

  for (const row of rows) {
    const key = row.featureKey || "unknown";
    featureEvents.set(key, (featureEvents.get(key) ?? 0) + 1);
    const users = featureUsers.get(key) ?? new Set();
    users.add(row.userId);
    featureUsers.set(key, users);

    const pUsers =
      featurePersonaUsers.get(key) ??
      ({
        firm: new Set<string>(),
        founder: new Set<string>(),
        customer: new Set<string>(),
      } satisfies Record<UsagePersona, Set<string>>);
    pUsers[row.persona].add(row.userId);
    featurePersonaUsers.set(key, pUsers);

    const pEvents = featurePersonaEvents.get(key) ?? { firm: 0, founder: 0, customer: 0 };
    pEvents[row.persona] += 1;
    featurePersonaEvents.set(key, pEvents);

    personaUsers[row.persona].add(row.userId);
    personaEvents[row.persona] += 1;
    allUsers.add(row.userId);

    const day = ymd(row.occurredAt);
    dayEvents.set(day, (dayEvents.get(day) ?? 0) + 1);
    const du = dayUsers.get(day) ?? new Set();
    du.add(row.userId);
    dayUsers.set(day, du);

    let entityId: string | null = null;
    let kind: EntityStat["kind"] = "user";
    if (row.persona === "firm" && row.firmId) {
      entityId = `firm:${row.firmId}`;
      kind = "firm";
    } else if (row.clientId) {
      entityId = `client:${row.clientId}`;
      kind = "client";
    } else {
      entityId = `user:${row.userId}`;
      kind = "user";
    }
    entityEvents.set(entityId, (entityEvents.get(entityId) ?? 0) + 1);
    const eu = entityUsers.get(entityId) ?? new Set();
    eu.add(row.userId);
    entityUsers.set(entityId, eu);
    if (!entityMeta.has(entityId)) {
      const rawId = entityId.split(":")[1] ?? entityId;
      entityMeta.set(entityId, {
        kind,
        persona: row.persona,
        label: labels[entityId] || labels[rawId] || (kind === "firm" ? "Firm" : kind === "client" ? "Client" : "User"),
      });
    }
  }

  const seen = new Set<string>();
  const features: FeatureStat[] = [];

  const pushFeature = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const def = FEATURE_BY_KEY[key];
    const pEvents = featurePersonaEvents.get(key) ?? { firm: 0, founder: 0, customer: 0 };
    const pUsers = featurePersonaUsers.get(key);
    features.push({
      key,
      label: def?.label ?? key.replace(/[._]/g, " "),
      group: def?.group ?? "other",
      inCatalog: Boolean(def),
      events: featureEvents.get(key) ?? 0,
      uniqueUsers: featureUsers.get(key)?.size ?? 0,
      byPersona: {
        firm: { events: pEvents.firm, uniqueUsers: pUsers?.firm.size ?? 0 },
        founder: { events: pEvents.founder, uniqueUsers: pUsers?.founder.size ?? 0 },
        customer: { events: pEvents.customer, uniqueUsers: pUsers?.customer.size ?? 0 },
      },
    });
  };

  for (const def of FEATURE_CATALOG) pushFeature(def.key);
  for (const key of featureEvents.keys()) pushFeature(key);

  const ranked = [...features].sort((a, b) => {
    if (b.events !== a.events) return b.events - a.events;
    if (b.uniqueUsers !== a.uniqueUsers) return b.uniqueUsers - a.uniqueUsers;
    return a.label.localeCompare(b.label);
  });

  const catalog = ranked.filter((f) => f.inCatalog);
  const unused = catalog.filter((f) => f.events === 0);
  const leastUsed = [...catalog].sort((a, b) => {
    if (a.events !== b.events) return a.events - b.events;
    return a.label.localeCompare(b.label);
  });

  const daily: DailyPoint[] = [];
  const from = new Date(opts.fromIso);
  const to = new Date(opts.toIso);
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    daily.push({
      date,
      events: dayEvents.get(date) ?? 0,
      users: dayUsers.get(date)?.size ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const entities: EntityStat[] = [...entityEvents.entries()]
    .map(([id, events]) => {
      const meta = entityMeta.get(id)!;
      return {
        id,
        kind: meta.kind,
        persona: meta.persona,
        label: meta.label,
        events,
        uniqueUsers: entityUsers.get(id)?.size ?? 0,
      };
    })
    .sort((a, b) => b.events - a.events)
    .slice(0, 12);

  return {
    totals: {
      events: rows.length,
      uniqueUsers: allUsers.size,
      byPersona: {
        firm: { events: personaEvents.firm, uniqueUsers: personaUsers.firm.size },
        founder: { events: personaEvents.founder, uniqueUsers: personaUsers.founder.size },
        customer: { events: personaEvents.customer, uniqueUsers: personaUsers.customer.size },
      },
    },
    features: ranked,
    mostUsed: ranked.filter((f) => f.events > 0).slice(0, 10),
    leastUsed: leastUsed.slice(0, 10),
    unused,
    daily,
    entities,
  };
}
