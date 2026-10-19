/**
 * Needs attention keeps its heading up, and "Nothing needs attention."
 * waits for a real enrichment. A shell timer is not that.
 * Run: pnpm test:needs-attention-ready
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { needsAttentionView } from "../src/lib/portfolio-dashboard";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  needsAttentionView({
    bookLoading: false,
    enriched: false,
    portfolioLoaded: true,
    items: [{}],
  }) === "list",
  "slim rows with portfolio items list before countsReady",
);
assert(
  needsAttentionView({
    bookLoading: false,
    enriched: false,
    portfolioLoaded: true,
    items: [],
  }) === "loading",
  "a timed-out load that never enriched stays on checking",
);
assert(
  needsAttentionView({
    bookLoading: false,
    enriched: true,
    portfolioLoaded: true,
    items: [],
  }) === "clear",
  "clear waits for enrichment and a settled portfolio",
);
assert(
  needsAttentionView({
    bookLoading: true,
    enriched: true,
    portfolioLoaded: true,
    items: [],
  }) === "loading",
  "a book that is still loading is not clear",
);
assert(
  needsAttentionView({
    bookLoading: false,
    enriched: true,
    portfolioLoaded: false,
    items: [],
  }) === "loading",
  "clear waits for the portfolio fetch to settle",
);
assert(
  needsAttentionView({
    bookLoading: true,
    enriched: false,
    portfolioLoaded: false,
    items: [{ id: "sign-off" }],
  }) === "list",
  "a queue item shows the list before either fetch finishes",
);

const board = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");

const pageAt = board.indexOf('{view === "needs-attention" ? (');
assert(pageAt > 0, "the needs-attention page has its own block");
const page = board.slice(pageAt, pageAt + 900);
const headingAt = page.indexOf("<h2>Needs attention today</h2>");
const splitAt = page.indexOf('attentionView === "list"');
assert(headingAt > 0 && splitAt > headingAt, "the heading is present before the loading, list, and clear split");
assert(page.includes("Checking the book…"), "loading copy sits with the heading");
assert(page.includes("Nothing needs attention."), "clear copy sits with the heading");
assert(!page.includes("countsLoading"), "the heading block does not wait on countsLoading");
assert(!page.includes("countsReady"), "the heading block does not wait on countsReady");

const practiceGate = board.indexOf('view === "practice" && !bookLoading && !countsLoading');
assert(practiceGate > 0 && practiceGate < pageAt, "the practice home strip still waits for the enriched book");

const loadCall = board.indexOf("void load(firmId, user?.id, greetingSource).finally");
assert(loadCall > 0, "load still receives the greeting name");
const deps = board.slice(loadCall, board.indexOf("]);", loadCall));
const depLine = deps.split("\n").find((line) => line.includes("firmId, brandLoading"));
assert(depLine != null && !depLine.includes("greetingSource"), "a greetingSource change does not restart the load");
assert(board.includes("practiceGreeting(greetingSource)"), "the greeting still renders from greetingSource");

const timerAt = board.indexOf("[practice-board] client book timed out");
assert(timerAt > 0, "the book timeout is still there");
const timer = board.slice(timerAt, board.indexOf("}, SHELL_GATE_TIMEOUT_MS);", timerAt));
assert(timer.includes("setCountsReady(true)"), "the timer still releases counts");
assert(!timer.includes("setBookEnriched"), "the timer does not mark the book enriched");

const paintAt = board.lastIndexOf("toClientRow(");
assert(paintAt > 0, "enriched rows still paint through toClientRow");
const paint = board.slice(paintAt, paintAt + 500);
assert(paint.includes("setBookEnriched(true)"), "enrichment is what marks the book enriched");
assert(paint.includes("gen === loadGen.current"), "enrichment marks the book only for the current load");
assert(board.includes("setBookEnriched(false)"), "a new load clears the enriched flag");

const warmAt = board.indexOf("const warm = readPaintedBook");
assert(warmAt > 0, "load paints a warm book when one is stored");
const warmBlock = board.slice(warmAt, board.indexOf("try {", warmAt));
assert(warmBlock.includes("setClientRows(warm)"), "the warm book shows immediately");
assert(!warmBlock.includes("setBookEnriched(true)"), "a warm paint never flips bookEnriched true");

const lightAt = board.indexOf("const lightRows = rawClients.map");
assert(lightAt > 0, "the slim list paints before enrichment");
const lightBlock = board.slice(lightAt, board.indexOf("const historyPromise", lightAt));
assert(!lightBlock.includes("setBookEnriched(true)"), "the slim paint never flips bookEnriched true");
assert(board.includes("actionIsOverdue"), "the overdue predicate stays on the board");

console.log("needs-attention-ready: ok");
