/**
 * Books answer strip. No review scope, so the strip omits status.
 * The Moves populated sentence is the count plus the first title.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import {
  booksAnswerSentence,
  booksDrawerHint,
  booksPrimaryKind,
  booksQueriesLabel,
} from "../src/lib/books-answer";
import { factSourceLabel } from "../src/lib/client-brain";
import { figureSourceChipLabel } from "../src/lib/ledger-link-copy";
import { movesAnswerSentence } from "../src/lib/overview-moves-copy";
import { STRATEGIC_MOVE_CATALOG, rankStrategicMoves } from "../src/lib/strategic-moves";
import { dataFreshnessLine } from "../src/lib/workflow-coach";

const snapshotLine = "Snapshot on file · September 2026";
const syncLine = dataFreshnessLine({
  xero: {
    lastSyncedAt: "2026-09-01T14:00:00.000Z",
    syncStatus: "ok",
    periodLabel: "September 2026",
  },
});
assert.equal(syncLine, "Last sync Sep 1, 2026, 2:00 PM · Xero · September 2026");

assert.equal(
  booksAnswerSentence({ freshness: snapshotLine, openKinds: [] }),
  "Books are up to date to September 2026.",
);
assert.equal(
  booksAnswerSentence({ freshness: syncLine, openKinds: [] }),
  "Books are synced from Xero up to September 2026.",
);
assert.equal(
  booksAnswerSentence({ freshness: snapshotLine, openKinds: ["bank_statement"] }),
  "Books stop at September 2026. Upload the latest statements to bring them up to date.",
);
assert.equal(
  booksAnswerSentence({ freshness: syncLine, openKinds: ["management_accounts"] }),
  "Books stop at September 2026. Upload the latest statements to bring them up to date.",
);
assert.equal(
  booksAnswerSentence({
    freshness: "No sync yet. Connect Xero or QuickBooks, or upload statements.",
    openKinds: [],
  }),
  "No books on file yet. Connect Xero or QuickBooks, or upload statements.",
);
assert.equal(
  booksAnswerSentence({ freshness: "", openKinds: [] }),
  "No books on file yet. Connect Xero or QuickBooks, or upload statements.",
);
assert.equal(booksDrawerHint(snapshotLine), snapshotLine);
assert.equal(booksDrawerHint(syncLine), syncLine);
assert.equal(
  booksDrawerHint("No sync yet. Connect Xero or QuickBooks, or upload statements."),
  "Connections, profile",
);

assert.equal(
  booksPrimaryKind({
    freshness: "No sync yet. Connect Xero or QuickBooks, or upload statements.",
    openKinds: [],
    openQueries: 2,
  }),
  "upload",
);
assert.equal(
  booksPrimaryKind({
    freshness: "Snapshot on file · September 2026",
    openKinds: ["bank_statement"],
    openQueries: 0,
  }),
  "upload",
);
assert.equal(
  booksPrimaryKind({
    freshness: "Snapshot on file · September 2026",
    openKinds: ["aged_debtors"],
    openQueries: 1,
  }),
  "queries",
);
assert.equal(
  booksPrimaryKind({
    freshness: "Last sync Sep 1, 2026, 2:00 PM · Xero · September 2026",
    openKinds: [],
    openQueries: 0,
  }),
  null,
);
assert.equal(booksQueriesLabel(1), "1 open query");
assert.equal(booksQueriesLabel(3), "3 open queries");

assert.equal(figureSourceChipLabel("upload"), "Uploaded statement");
assert.equal(figureSourceChipLabel(null), null);
assert.equal(figureSourceChipLabel("   "), null);
assert.equal(factSourceLabel("extract"), "From the file");

const ranked = rankStrategicMoves({
  healthByKey: { debtorDays: 40, creditorDays: 70, grossMargin: 55 },
  limit: 3,
});
assert.equal(ranked.length, 3);
assert.equal(
  movesAnswerSentence(ranked),
  "3 moves ready. Start with: raise prices on your best-selling products.",
);
assert.equal(
  movesAnswerSentence([ranked[0]!]),
  "1 move ready. Start with: raise prices on your best-selling products.",
);
assert.equal(
  movesAnswerSentence([{ title: "AI review of pricing" }]),
  "1 move ready. Start with: AI review of pricing.",
);
for (const entry of STRATEGIC_MOVE_CATALOG) {
  assert.match(entry.title, /^[A-Z][a-z]/, entry.title);
  const sentence = movesAnswerSentence([entry]);
  assert.equal(
    sentence,
    `1 move ready. Start with: ${entry.title.charAt(0).toLowerCase()}${entry.title.slice(1)}.`,
    entry.title,
  );
}

function sliceBetween(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  assert.ok(from !== -1 && to > from, `${start} precedes ${end}`);
  return src.slice(from, to);
}

const route = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const data = readFileSync(resolve("src/components/data-up-to-date.tsx"), "utf8");
const scopes = readFileSync(resolve("src/lib/review-signoffs.functions.ts"), "utf8");
const booksPane = sliceBetween(route, 'id="pane-summary"', 'id="pane-moves"');

assert.ok(booksPane.includes("<DataUpToDate"), "books still mounts the data section");
assert.ok(booksPane.includes("<ArapAnswerStrip") || data.includes("<ArapAnswerStrip"), "books uses the no-scope strip");
assert.ok(data.includes("<ArapAnswerStrip"), "the data section renders the no-scope strip");
assert.ok(!data.includes("data-signoff-status"), "books omits the status pill");
assert.ok(!data.includes("SignoffStatusChip"), "books does not invent a sign-off scope");
assert.ok(!data.includes("<DeliverableAnswerStrip"), "books does not use the scoped strip");
assert.ok(!booksPane.includes('figureSourceChipLabel("statement")'), "books does not invent a Statement chip");
assert.ok(
  booksPane.includes("figureSourceChipLabel(statementMeta.statementSource)"),
  "books chips the statement source already on the file",
);
assert.ok(data.includes("booksAnswerSentence({ freshness, openKinds })"), "the sentence uses the same current flag as the button");
assert.ok(data.includes("booksDrawerHint(freshness)"), "the freshness line is the drawer hint");
assert.ok(data.includes("<ReviewInputsDrawer"), "connections and questions sit in the drawer");
assert.ok(!data.includes("Then continue to Health."), "the lede no longer points at Health");
assert.ok(data.includes("dataSectionStatus({ freshness, openKinds })"), "the tucked title still uses the shared status");
assert.ok(data.includes('<h2 className="data-fresh__title">{status.title}</h2>'), "the tucked title keeps its heading");
assert.ok(data.includes("aria-label={status.title}"), "the section title stays the accessible name");
assert.ok(!scopes.includes('"books"'), "books does not add a review scope");
assert.ok(booksPane.includes('deliverableId="summary"'), "configure inputs stays on Books");
assert.ok(booksPane.includes("{inputs}"), "profile questions move into the drawer");

console.log("answer-strip books ok");
