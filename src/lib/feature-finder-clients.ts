/**
 * Client rows inside the feature finder.
 *
 * Matching is client-side against the list the dashboard already loads
 * (name and client code). An empty query leaves the feature list as it is;
 * a typed query adds a Clients group beside any feature hits.
 *
 * On the firm dashboard a section word such as cash or budget has no open
 * file. Those queries also become "Cash for {client}" jumps into that
 * client's studio tab, using the same loaded book.
 */
import {
  featureHref,
  firmSectionTargets,
  normalizeFeatureQuery,
  type FeatureAudience,
  type FeatureResult,
} from "@/lib/feature-finder";
import { formatCalendarDay } from "@/lib/market/format";
import { marketForClient } from "@/lib/market/scope";

export const CLIENTS_GROUP = "Clients";

/** Recent clients shown before a query is typed. Not a search of the whole book. */
export const RECENT_CLIENT_LIMIT = 8;

/** Same route the firm dashboard uses when a client row is clicked. */
export function clientFileHref(clientId: string): string {
  return `/clients/${encodeURIComponent(clientId)}`;
}

export type FinderClient = {
  id: string;
  name: string;
  clientCode?: string | null;
  /** Company or business name. Shown only when it is not the person's name. */
  businessName?: string | null;
  /** Owner email. Used when no distinct business name is available. */
  ownerEmail?: string | null;
  /** ISO timestamp the client row was created. */
  createdAt?: string | null;
  /** Client market selection. The added-date follows this, not a fixed day-first order. */
  market?: unknown;
};

export type ClientSearchResult = {
  id: string;
  label: string;
  hint: string;
  group: typeof CLIENTS_GROUP;
  clientId: string;
  href: string;
};

/**
 * Firm accountants get the Clients group. Owner accounts have a single
 * business and no firm book — hide the group so the palette does not query
 * or error.
 */
export function includeClientGroup(audience: FeatureAudience): boolean {
  return audience === "accountant";
}

function scoreField(query: string, text: string): number {
  if (!query || !text) return 0;
  if (text === query) return 100;
  const tokens = text.split(" ").filter(Boolean);
  if (tokens.includes(query)) return 95;
  if (
    query.length >= 2 &&
    (text.startsWith(query) || tokens.some((token) => token.startsWith(query)))
  ) {
    return 80;
  }
  if (query.length >= 3 && text.includes(query)) return 60;
  const qTokens = query.split(" ").filter(Boolean);
  if (
    qTokens.length > 1 &&
    qTokens.every((qt) => qt.length >= 2 && tokens.some((token) => token.startsWith(qt)))
  ) {
    return 50;
  }
  return 0;
}

function compactCode(value: string): string {
  return value.replace(/ /g, "");
}

/** First 8 hex characters of a client id, enough to tell same-name rows apart. */
export function shortClientId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

/** One row per client id. The loaded book is newest-first, so the first copy wins. */
export function dedupeFinderClients(clients: readonly FinderClient[]): FinderClient[] {
  const seen = new Set<string>();
  const out: FinderClient[] = [];
  for (const client of clients) {
    const id = client.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(client);
  }
  return out;
}

function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

/**
 * `added 3 Mar 2026` in ZA, `added Mar 3, 2026` in the US.
 * The calendar day is the UTC date on the timestamp. The order follows the client market.
 */
export function finderAddedLabel(
  createdAt: string | null | undefined,
  market?: { locale?: string | null; timezone?: string | null } | { market?: unknown } | null,
): string | null {
  if (!createdAt?.trim()) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  const resolved =
    market && "locale" in market
      ? { locale: market.locale ?? null, timezone: market.timezone ?? "UTC" }
      : marketForClient(
          market && "market" in market ? { market: market.market } : { market: null },
        );
  const y = String(date.getUTCFullYear());
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const ymd = `${y}-${m}-${d}`;
  const day = formatCalendarDay(ymd, resolved);
  if (!day || day === "—") return null;
  return `added ${day}`;
}

/**
 * First company or business name that is not the person's display name.
 * Statement keys and ledger names are passed in preference order.
 */
export function finderBusinessName(
  personName: string,
  candidates: readonly (string | null | undefined)[],
): string | null {
  const person = personName.trim();
  for (const raw of candidates) {
    const name = (raw ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    if (person && sameName(name, person)) continue;
    return name;
  }
  return null;
}

function cleanDetail(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/** One field of a same-name label. Null means this row has nothing to add. */
function finderDetailPart(
  client: FinderClient,
  step: "business" | "email" | "added" | "code",
): string | null {
  if (step === "business") {
    const business = cleanDetail(client.businessName);
    const person = client.name.trim();
    if (!business || (person && sameName(business, person))) return null;
    return business;
  }
  if (step === "email") return cleanDetail(client.ownerEmail) || null;
  if (step === "added") {
    return finderAddedLabel(
      client.createdAt,
      client.market == null ? undefined : { market: client.market },
    );
  }
  return cleanDetail(client.clientCode) || shortClientId(client.id);
}

function labelsCollide(labels: ReadonlyMap<string, string>): boolean {
  const seen = new Set<string>();
  for (const label of labels.values()) {
    if (!label || seen.has(label)) return true;
    seen.add(label);
  }
  return false;
}

/** Rows still blank, or still sharing a label with another row in the group. */
function unresolvedIds(
  group: readonly FinderClient[],
  labels: ReadonlyMap<string, string>,
): string[] {
  const counts = new Map<string, number>();
  for (const client of group) {
    const label = labels.get(client.id) ?? "";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return group
    .filter((client) => {
      const label = labels.get(client.id) ?? "";
      return !label || (counts.get(label) ?? 0) > 1;
    })
    .map((client) => client.id);
}

/**
 * Labels for one same-name group. Each step fills only the rows that are
 * still blank or still identical, and stops once every label is unique.
 * A last short id breaks whatever is still shared.
 */
function labelsForSameName(group: readonly FinderClient[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const client of group) labels.set(client.id, "");
  const steps = ["business", "email", "added", "code"] as const;
  for (const step of steps) {
    if (!labelsCollide(labels)) break;
    for (const id of unresolvedIds(group, labels)) {
      const client = group.find((row) => row.id === id);
      const part = client ? finderDetailPart(client, step) : null;
      if (!part) continue;
      const prev = labels.get(id) ?? "";
      if (prev === part || prev.endsWith(` · ${part}`)) continue;
      labels.set(id, prev ? `${prev} · ${part}` : part);
    }
  }
  if (labelsCollide(labels)) {
    for (const id of unresolvedIds(group, labels)) {
      const part = shortClientId(id);
      const prev = labels.get(id) ?? "";
      const next = !prev ? part : prev.endsWith(part) ? `${prev} · ${id}` : `${prev} · ${part}`;
      labels.set(id, next);
    }
  }
  return labels;
}

/**
 * Extra label for a display name that belongs to more than one client.
 * Fields are added only while labels still collide: business name, owner
 * email, added date, then client code or a short id.
 */
export function finderNameDisambiguators(
  clients: readonly FinderClient[],
): ReadonlyMap<string, string> {
  const groups = new Map<string, FinderClient[]>();
  for (const client of clients) {
    const key = client.name.trim().toLowerCase();
    if (!key || !client.id.trim()) continue;
    const list = groups.get(key);
    if (list) list.push(client);
    else groups.set(key, [client]);
  }
  const out = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const [id, label] of labelsForSameName(group)) {
      if (label) out.set(id, label);
    }
  }
  return out;
}

function clientHint(
  client: FinderClient,
  disambiguator: string | undefined,
  fallback: string,
): string {
  const code = client.clientCode?.trim() || "";
  if (disambiguator && code) return `${code} · ${disambiguator}`;
  if (disambiguator) return disambiguator;
  return code || fallback;
}

/**
 * The first clients in the loaded book, which the firm list orders by most
 * recently created. Duplicate ids collapse. Shared display names pick up a
 * business name, owner email, or added date so the rows are readable.
 */
export function recentFinderClients(
  clients: readonly FinderClient[],
  limit = RECENT_CLIENT_LIMIT,
): ClientSearchResult[] {
  const book = dedupeFinderClients(clients);
  const extras = finderNameDisambiguators(book);
  const out: ClientSearchResult[] = [];
  for (const client of book) {
    if (out.length >= limit) break;
    const name = client.name.trim();
    if (!name) continue;
    out.push({
      id: client.id,
      label: name,
      hint: clientHint(client, extras.get(client.id), "Recent client"),
      group: CLIENTS_GROUP,
      clientId: client.id,
      href: clientFileHref(client.id),
    });
  }
  return out;
}

/** Empty palette: a short recent list. A typed query uses search, which stays empty when blank. */
export function paletteClients(
  query: string,
  clients: readonly FinderClient[],
): ClientSearchResult[] {
  if (!normalizeFeatureQuery(query)) return recentFinderClients(clients);
  return searchClients(query, clients);
}

/** Highest name/code score for one client. Zero means it stays out of the list. */
export function clientMatchScore(query: string, client: FinderClient): number {
  const q = normalizeFeatureQuery(query);
  if (!q || !client.name.trim()) return 0;
  const name = normalizeFeatureQuery(client.name);
  let best = scoreField(q, name);
  const code = normalizeFeatureQuery(client.clientCode ?? "");
  if (code) {
    best = Math.max(best, scoreField(q, code));
    const qCompact = compactCode(q);
    const codeCompact = compactCode(code);
    if (qCompact.length >= 3 && codeCompact.includes(qCompact)) {
      best = Math.max(best, qCompact === codeCompact ? 100 : 70);
    }
  }
  return best;
}

const MAX_CLIENT_RESULTS = 40;
const MAX_SECTION_JUMPS = 40;

export function searchClients(
  query: string,
  clients: readonly FinderClient[],
): ClientSearchResult[] {
  if (!normalizeFeatureQuery(query)) return [];
  const book = dedupeFinderClients(clients);
  const extras = finderNameDisambiguators(book);
  return book
    .map((client) => ({ client, score: clientMatchScore(query, client) }))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.client.name.localeCompare(b.client.name, undefined, { sensitivity: "base" }),
    )
    .slice(0, MAX_CLIENT_RESULTS)
    .map(({ client }) => {
      return {
        id: `client:${client.id}`,
        label: client.name.trim(),
        hint: clientHint(client, extras.get(client.id), "Client"),
        group: CLIENTS_GROUP,
        clientId: client.id,
        href: clientFileHref(client.id),
      };
    });
}

const OPEN_CLIENT_COPY =
  "Open a client to jump to Health, Cash, Budget, Collections, and the rest.";

/**
 * Firm-dashboard jumps for a section keyword. Each row opens that studio
 * tab for one client. A trailing client name (`budget yankees`) narrows the book.
 */
export function searchClientSectionJumps(
  query: string,
  clients: readonly FinderClient[],
): FeatureResult[] {
  const { targets, clientQuery } = firmSectionTargets(query);
  if (!targets.length || clients.length === 0) return [];

  let pool: FinderClient[];
  if (clientQuery) {
    pool = clients
      .map((client) => ({ client, score: clientMatchScore(clientQuery, client) }))
      .filter((row) => row.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.client.name.localeCompare(b.client.name, undefined, { sensitivity: "base" }),
      )
      .map((row) => row.client);
  } else {
    pool = [...clients];
  }
  if (!pool.length) return [];

  const book = dedupeFinderClients(pool);
  const extras = finderNameDisambiguators(dedupeFinderClients(clients));
  const perFeature = Math.max(8, Math.floor(MAX_SECTION_JUMPS / targets.length));
  const jumps: FeatureResult[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    let shown = 0;
    for (const client of book) {
      if (shown >= perFeature || jumps.length >= MAX_SECTION_JUMPS) break;
      const name = client.name.trim();
      if (!name) continue;
      const key = `${target.id}:${client.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const extra = extras.get(client.id);
      const destination = {
        kind: "client" as const,
        clientId: client.id,
        search: target.search,
      };
      const code = client.clientCode?.trim() || "";
      jumps.push({
        id: key,
        label: extra ? `${target.label} for ${name} · ${extra}` : `${target.label} for ${name}`,
        hint: code || target.hint,
        group: target.label,
        destination,
        href: featureHref(destination),
      });
      shown += 1;
    }
  }
  return jumps;
}

/**
 * Copy for the palette empty state. Shown only when cmdk has no items.
 * Client hits must not fall through to a features-only message.
 */
export function paletteEmptyCopy(input: {
  needsClient: boolean;
  featureCount: number;
  clientCount: number;
  clientsLoading: boolean;
}): string {
  if (input.featureCount > 0 || input.clientCount > 0) return "";
  if (input.clientsLoading) return "Searching clients…";
  if (input.needsClient) return OPEN_CLIENT_COPY;
  return "No matches.";
}
