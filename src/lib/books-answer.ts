/**
 * Books answer-strip copy.
 * The sentence says whether the books are current. The freshness line
 * (sync time, source, period) stays a hint. Nothing here recomputes a sync,
 * a period, or a request.
 */
import { isStatementCompletenessGap, statementsLookCurrent } from "@/lib/data-requests";

const BOOKS_EMPTY_SENTENCE =
  "No books on file yet. Connect Xero or QuickBooks, or upload statements.";

const BOOKS_CATCH_UP = "Upload the latest statements to bring them up to date.";

type FreshnessParts =
  | { kind: "empty" }
  | { kind: "snapshot"; period: string }
  | { kind: "sync"; source: string; period: string | null };

/** Read the three shapes `dataFreshnessLine` already writes. Segments are split on " · ". */
function freshnessParts(freshness: string | null | undefined): FreshnessParts {
  const line = freshness?.trim() ?? "";
  if (!line || /^\s*no sync yet\b/i.test(line)) return { kind: "empty" };
  if (line.startsWith("Snapshot on file · ")) {
    const period = line.slice("Snapshot on file · ".length).trim();
    return period ? { kind: "snapshot", period } : { kind: "empty" };
  }
  if (line.startsWith("Last sync ")) {
    const parts = line.split(" · ");
    const source = parts[1]?.trim() ?? "";
    const period = parts.length > 2 ? parts.slice(2).join(" · ").trim() : "";
    if (!source) return { kind: "empty" };
    return { kind: "sync", source, period: period || null };
  }
  return { kind: "empty" };
}

/** Period the books cover. Same freshness line the Books sentence reads. */
export function booksCoverPeriod(freshness: string | null | undefined): string | null {
  const parts = freshnessParts(freshness);
  if (parts.kind === "empty") return null;
  return parts.period;
}

/** Sync clock for a muted sub-line. Drops the time of day. */
export function booksSyncSubline(stamp: string | null | undefined): string | null {
  const text = stamp?.trim() ?? "";
  if (!text || text === "—") return null;
  const parts = text.split(",");
  const date = parts.length >= 2 ? `${parts[0]},${parts[1]}`.trim() : text;
  return `Synced ${date}`;
}

/** Same flag as the gold button: statements look current and no statement gap is open. */
export function booksAreCurrent(input: {
  freshness: string;
  openKinds: readonly string[];
}): boolean {
  return statementsLookCurrent(input.freshness) && !input.openKinds.some(isStatementCompletenessGap);
}

export function booksAnswerSentence(input: {
  freshness: string | null | undefined;
  openKinds?: readonly string[];
}): string {
  const freshness = input.freshness?.trim() ?? "";
  const parts = freshnessParts(freshness);
  if (parts.kind === "empty") return BOOKS_EMPTY_SENTENCE;
  const current = booksAreCurrent({ freshness, openKinds: input.openKinds ?? [] });
  if (current && parts.kind === "sync") {
    return parts.period
      ? `Books are synced from ${parts.source} up to ${parts.period}.`
      : `Books are synced from ${parts.source}.`;
  }
  if (current && parts.kind === "snapshot") {
    return `Books are up to date to ${parts.period}.`;
  }
  if (parts.period) {
    return `Books stop at ${parts.period}. ${BOOKS_CATCH_UP}`;
  }
  return `Books are not up to date. ${BOOKS_CATCH_UP}`;
}

/**
 * Drawer hint: the freshness line already on the page.
 * A sync stamp in that line comes from `formatSyncStamp`. An empty file has
 * no time, source, or period, so the hint names the drawer instead.
 */
export function booksDrawerHint(freshness: string | null | undefined): string {
  const line = freshness?.trim() ?? "";
  if (!line || /^\s*no sync yet\b/i.test(line)) return "Connections, profile";
  return line;
}

/**
 * The one gold action already on this section.
 * Upload while statements are not current. The existing queries action once
 * they are and a query is still open. Otherwise no gold button.
 */
export function booksPrimaryKind(input: {
  freshness: string;
  openKinds: readonly string[];
  openQueries: number;
}): "upload" | "queries" | null {
  if (!booksAreCurrent(input)) return "upload";
  if (input.openQueries > 0) return "queries";
  return null;
}

/** Same words as the queries control already on Overview. */
export function booksQueriesLabel(count: number): string {
  const noun = count === 1 ? "query" : "queries";
  return `${count} open ${noun}`;
}
