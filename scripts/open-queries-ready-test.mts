/**
 * Open queries clears from the notes list, not from book enrichment.
 * Run: pnpm test:open-queries-ready
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const board = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");

const effectStart = board.indexOf('const clientIdKey = clientRows.map((c) => c.id).join("\\n");');
const effectEnd = board.indexOf("const portfolioRows", effectStart);
assert(effectStart > 0 && effectEnd > effectStart, "the queries effect is still next to the client id list");
const effect = board.slice(effectStart, effectEnd);

assert(effect.includes("listOpenQueries(ids)"), "listOpenQueries runs with the slim client ids");
assert(
  effect.includes('if (view !== "queries" || loading) return'),
  "the notes list starts once the slim client list has loaded",
);
assert(!effect.includes("countsReady"), "the queries effect does not wait on countsReady");
assert(
  effect.includes(".then((rows) => {") && effect.includes("setQueryRowsReady(true)"),
  "the notes promise clears the loading flag",
);
assert(effect.includes("}, [view, loading, clientIdKey]);"), "enrichment finishing does not refetch notes");

const lineAt = board.indexOf('<p className="sub">Loading open queries…</p>');
assert(lineAt > 0, "the queries page still has its loading line");
const line = board.slice(lineAt - 220, lineAt);
assert(
  line.includes("bookLoading || !queryRowsReady"),
  "the line follows the notes flag",
);
assert(!line.includes("countsReady"), "the line can clear while countsReady is false");

/** Same condition as the queries view. countsReady is deliberately not an input. */
function openQueriesLineVisible(input: { bookLoading: boolean; queryRowsReady: boolean }): boolean {
  return input.bookLoading || !input.queryRowsReady;
}

assert(
  openQueriesLineVisible({ bookLoading: false, queryRowsReady: true }) === false,
  "the line clears while countsReady is false",
);
assert(
  openQueriesLineVisible({ bookLoading: true, queryRowsReady: true }) === true,
  "the line stays while the slim list itself is still loading",
);

assert(board.includes("setCountsReady(true)"), "enrichment still owns countsReady");
assert(board.includes("actionIsOverdue"), "the overdue predicate stays on the board");
assert(
  board.includes("!bookLoading && !countsLoading"),
  "needs-attention still waits for the enriched book",
);

console.log("open-queries-ready: ok");
