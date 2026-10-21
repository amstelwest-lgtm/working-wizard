/**
 * Clients list: the shell is not a finished book, numeric strings count,
 * zero queries print 0, and a 1020B-like row shows 63 and 28.6% · $52.0k.
 * Run: pnpm test:clients-list-figures
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ClientsListProfit,
  ClientsListQueries,
  ClientsListRunway,
  ClientsListScore,
} from "../src/components/practice-list-metrics.tsx";
import { practiceClientsPhase } from "../src/lib/bounded-load.ts";
import { clientListRunwayCell } from "../src/lib/cash-forecast-parity.ts";
import {
  clientListOpProfit,
  clientListQueriesCell,
  clientListRunwayText,
  latestStoredScore,
  lightClientRow,
  toClientRow,
  type PracticeClient,
  type PracticeClientRow,
} from "../src/lib/practice-client-row.ts";
import { revenueOf } from "../src/lib/portfolio-dashboard.ts";
import { storedFiniteNumber } from "../src/lib/stored-number.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const shellPhase = practiceClientsPhase({
  loading: false,
  timedOut: false,
  rowCount: 4,
  figures: "pending",
});
assert(shellPhase === "partial", `shell is not ready (${shellPhase})`);
assert(shellPhase !== "ready", "a shell with rows is not a finished table");

const mergedPhase = practiceClientsPhase({
  loading: false,
  timedOut: false,
  rowCount: 4,
  figures: "merged",
});
assert(mergedPhase === "ready", "ready only after the financials merge");

const timedShell = practiceClientsPhase({
  loading: false,
  timedOut: true,
  rowCount: 4,
  figures: "pending",
});
assert(timedShell === "error", `a timed-out shell is an error (${timedShell})`);
assert(timedShell !== "ready", "a timeout with rows is not ready before the merge");

const failedPhase = practiceClientsPhase({
  loading: false,
  timedOut: false,
  rowCount: 4,
  figures: "failed",
});
assert(failedPhase === "error", "a failed books merge is an error, not a dash table");

assert(
  practiceClientsPhase({ loading: true, timedOut: true, rowCount: 0 }) === "error",
  "a hung client read with no rows is still an error",
);

assert(storedFiniteNumber("63") === 63, "a numeric string coerces");
assert(storedFiniteNumber("") === null, "an empty string is not zero");
assert(storedFiniteNumber("nope") === null, "a word is not a number");
assert(
  latestStoredScore([{ score: "63", is_estimated: false }]) === 63,
  'history score "63" is kept',
);
assert(latestStoredScore([{ score: "nope" }]) === null, "a non-numeric score is dropped");
assert(revenueOf({ revenue: "182000" }) === 182000, "revenue string 182000");
assert(storedFiniteNumber("52000") === 52000, "ebit string 52000");

const runwayString = clientListRunwayCell({ weeks: "13", reason: null });
assert(runwayString.value === "13 weeks", `stored weeks string (${runwayString.value})`);
const runwayMissing = clientListRunwayCell({ weeks: null, reason: "—" });
assert(runwayMissing.value === "—", "no forecast and no stored weeks stays a dash");

assert(clientListQueriesCell(0) === "0", "zero queries render 0");
assert(clientListQueriesCell(null) === "—", "an unread query count stays a dash");
const queriesHtml = renderToStaticMarkup(
  createElement(ClientsListQueries, { pending: false, count: 0 }),
);
assert(queriesHtml.includes(">0<"), `queries markup (${queriesHtml})`);
assert(!queriesHtml.includes("—"), "a finished zero is not a dash");

const books: Record<string, string> = {
  revenue: "182000",
  cogs: "163800",
  netIncome: "38200",
  ebit: "52000",
  ebitda: "59500",
  ebt: "48400",
  grossProfit: "18200",
  laborCost: "",
  cash: "46300",
  receivables: "38900",
  inventory: "63365",
  payables: "53235",
  totalAssets: "179200",
  equity: "100700",
  currentAssets: "117700",
  currentLiabilities: "42500",
  totalLiabilities: "78500",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
  periodMonths: "9",
};

function row(overrides: Partial<PracticeClient> = {}): PracticeClient {
  return {
    id: "7b111d2a-2339-4722-9596-13225801ec8f",
    name: "AQA Gate Throwaway 1020B",
    business_type: null,
    cash_runway_weeks: null,
    last_forecast_at: null,
    last_login_at: null,
    firm_id: "e8f7a440-a541-422c-8e4f-82ba33dd0604",
    financials: books,
    cashflow: { openingBalance: "46300", revenue: [], expenses: [] },
    market: { country: "US", regionCode: "NY" },
    ...overrides,
  };
}

const shell = lightClientRow(row());
assert(shell.score == null, "a shell has no score");
assert(shell.openQueries == null, "a shell has not counted queries");
const shellHtml = renderToStaticMarkup(
  createElement(
    "div",
    null,
    createElement(ClientsListScore, { pending: true, score: shell.score }),
    createElement(ClientsListRunway, { pending: true, value: "—" }),
    createElement(ClientsListQueries, { pending: true, count: 0 }),
    createElement(ClientsListProfit, { pending: true, text: "—" }),
  ),
);
assert(shellHtml.includes("milon-skeleton"), "the shell paints skeletons");
assert(!shellHtml.includes("ring-score"), "the shell does not paint a score");
assert(!shellHtml.includes("—"), "the shell does not paint dashes for the figures");

const storedOnly = toClientRow(
  row({ financials: null, cashflow: null }),
  [{ score: "63", is_estimated: false, period_date: "2026-09-30" }],
  0,
  0,
  0,
);
assert(storedOnly.score === 63, `string history fills a null live score (${storedOnly.score})`);

const merged = toClientRow(
  row(),
  [{ score: "63", is_estimated: false, period_date: "2026-09-30" }],
  0,
  0,
  0,
);
assert(merged.score === 63, `1020B health (${merged.score})`);
const profit = clientListOpProfit(merged.financials, merged.market);
assert(profit.includes("28.6%"), profit);
assert(profit.includes("$52.0k"), profit);
assert(
  clientListRunwayText(merged.runwayWeeks, merged.runwayLabel) === "—",
  "1020B has no forecast weeks",
);

const withStoredWeeks = toClientRow(row({ cash_runway_weeks: "13" }), [], 0, 0, 0);
assert(
  clientListRunwayText(withStoredWeeks.runwayWeeks, withStoredWeeks.runwayLabel) === "13 weeks",
  "a stored numeric string shows when the forecast has no week count",
);

function painted(clientRow: PracticeClientRow) {
  return renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement(ClientsListScore, { pending: false, score: clientRow.score }),
      createElement(ClientsListQueries, { pending: false, count: clientRow.openQueries }),
      createElement(ClientsListProfit, {
        pending: false,
        text: clientListOpProfit(clientRow.financials, clientRow.market),
      }),
    ),
  );
}

const html = painted(merged);
assert(html.includes(">63<"), html);
assert(html.includes(">0<"), html);
assert(html.includes("28.6%"), html);
assert(html.includes("$52.0k"), html);

const board = readFileSync("src/components/practice-board.tsx", "utf8");
const lightAt = board.indexOf("const lightRows = rawClients.map");
const historyAt = board.indexOf("const historyPromise", lightAt);
assert(lightAt > 0 && historyAt > lightAt, "the slim list still paints before history");
const lightBlock = board.slice(lightAt, historyAt);
assert(!lightBlock.includes("rememberPaintedBook"), "the shell is not stored as the painted book");
assert(!lightBlock.includes("setBookEnriched(true)"), "the shell does not mark the book enriched");
assert(lightBlock.includes('setFiguresLoad("pending")'), "the shell keeps figures pending");
const paintAt = board.lastIndexOf("toClientRow(");
const paint = board.slice(paintAt, paintAt + 700);
assert(paint.includes("rememberPaintedBook"), "the merged rows are what get remembered");
assert(paint.includes('setFiguresLoad("merged")'), "the merge is what marks figures ready");
assert(board.includes("FIGURES_LOAD_ERROR"), "a failed books read has its own error");
assert(board.includes('data-clients-load="figures"'), "the figures error is explicit");
assert(board.includes('data-clients-load="error"'), "a failed client read keeps its own error");

console.log("clients-list-figures: ok");
