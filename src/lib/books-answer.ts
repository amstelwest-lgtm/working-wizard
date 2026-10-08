/**
 * Books answer-strip copy.
 * The sentence is the freshness line already on the page. This file does not
 * recompute a sync, a period, or a request.
 */
import { isStatementCompletenessGap, statementsLookCurrent } from "@/lib/data-requests";

const BOOKS_EMPTY_SENTENCE =
  "No sync yet. Connect Xero or QuickBooks, or upload statements.";

/** `dataFreshnessLine`, with a full stop when that line does not already end on one. */
export function booksAnswerSentence(freshness: string | null | undefined): string {
  const line = freshness?.trim() || BOOKS_EMPTY_SENTENCE;
  return /[.!?]$/.test(line) ? line : `${line}.`;
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
  const statementGap = input.openKinds.some(isStatementCompletenessGap);
  const current = statementsLookCurrent(input.freshness) && !statementGap;
  if (!current) return "upload";
  if (input.openQueries > 0) return "queries";
  return null;
}

/** Same words as the queries control already on Overview. */
export function booksQueriesLabel(count: number): string {
  const noun = count === 1 ? "query" : "queries";
  return `${count} open ${noun}`;
}
