/**
 * Client rows inside the feature finder.
 *
 * Matching is client-side against the list the dashboard already loads
 * (name and client code). An empty query leaves the feature list as it is;
 * a typed query adds a Clients group beside any feature hits.
 */
import { normalizeFeatureQuery, type FeatureAudience } from "@/lib/feature-finder";

export const CLIENTS_GROUP = "Clients";

/** Same route the firm dashboard uses when a client row is clicked. */
export function clientFileHref(clientId: string): string {
  return `/clients/${encodeURIComponent(clientId)}`;
}

export type FinderClient = {
  id: string;
  name: string;
  clientCode?: string | null;
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

export function searchClients(
  query: string,
  clients: readonly FinderClient[],
): ClientSearchResult[] {
  if (!normalizeFeatureQuery(query)) return [];
  return clients
    .map((client) => ({ client, score: clientMatchScore(query, client) }))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.client.name.localeCompare(b.client.name, undefined, { sensitivity: "base" }),
    )
    .slice(0, MAX_CLIENT_RESULTS)
    .map(({ client }) => {
      const code = client.clientCode?.trim() || "";
      return {
        id: `client:${client.id}`,
        label: client.name.trim(),
        hint: code || "Client",
        group: CLIENTS_GROUP,
        clientId: client.id,
        href: clientFileHref(client.id),
      };
    });
}

const OPEN_CLIENT_COPY = "Open a client to jump to Health, Cash, Collections, and the rest.";

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
  if (input.needsClient) return OPEN_CLIENT_COPY;
  if (input.clientsLoading) return "Searching clients…";
  return "No matches.";
}
