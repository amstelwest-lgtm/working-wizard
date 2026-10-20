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
assert(
  effectStart > 0 && effectEnd > effectStart,
  "the queries effect is still next to the client id list",
);
const effect = board.slice(effectStart, effectEnd);

assert(effect.includes("listOpenQueries(ids)"), "listOpenQueries runs with the slim client ids");
assert(
  !effect.includes('if (view !== "queries" || loading) return'),
  "the notes deadline is armed while the client list is still loading",
);
const timerAt = effect.indexOf("window.setTimeout");
const loadingReturn = effect.indexOf("if (loading)");
assert(timerAt > 0 && loadingReturn > timerAt, "the timer starts before the loading return");
assert(!effect.includes("countsReady"), "the queries effect does not wait on countsReady");
assert(
  effect.includes(".then((result) => {") && effect.includes("setQueryRowsReady(true)"),
  "the notes promise clears the loading flag",
);
assert(
  effect.includes("}, [view, loading, clientIdKey]);"),
  "enrichment finishing does not refetch notes",
);

const lineAt = board.indexOf('<p className="sub">Loading open queries…</p>');
assert(lineAt > 0, "the queries page still has its loading line");
const line = board.slice(lineAt - 280, lineAt);
assert(line.includes('queriesPhase === "loading"'), "the line follows the phase helper");
assert(board.includes("OPEN_QUERIES_LOAD_ERROR"), "a timed-out notes list shows an error");
assert(!line.includes("countsReady"), "the line can clear while countsReady is false");

const { openQueriesPhase } = await import("../src/lib/bounded-load.ts");

assert(
  openQueriesPhase({ bookLoading: false, rowsReady: true, timedOut: false, rowCount: 0 }) ===
    "empty",
  "the line clears while countsReady is false",
);
assert(
  openQueriesPhase({ bookLoading: true, rowsReady: false, timedOut: false, rowCount: 0 }) ===
    "loading",
  "the line stays while the deadline has not fired",
);
assert(
  openQueriesPhase({ bookLoading: true, rowsReady: true, timedOut: true, rowCount: 0 }) === "error",
  "the deadline replaces the spinner while the book flag is still true",
);

assert(board.includes("setCountsReady(true)"), "enrichment still owns countsReady");
assert(board.includes("actionIsOverdue"), "the overdue predicate stays on the board");
assert(
  board.includes("!bookLoading && !countsLoading"),
  "needs-attention still waits for the enriched book",
);

console.log("open-queries-ready: ok");
