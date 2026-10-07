/**
 * Overview ledger status must name the real figure source.
 * Yankees: Xero is connected with last_synced_at null while the board is a
 * saved Xero statement; QuickBooks synced on 21 Sep 2026 but did not write
 * those figures. A same-period snapshot must not read as a flat month.
 *
 * Run: pnpm test:ledger-link-copy
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFinancialSnapshot } from "../src/lib/client-briefing";
import {
  boardFiguresFrom,
  describeLedgerLink,
  figureSourcePhrase,
  ledgerAttribution,
  readCachedQboSync,
} from "../src/lib/ledger-link-copy";
import { buildVarianceChips, resolvePriorSnapshot } from "../src/lib/prior-period";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const fmt = (iso: string) => iso.slice(0, 10);
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const yankeesFinancials = {
  statementSource: "xero",
  periodLabel: "1 Sep 2026 – 21 Sep 2026",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-21",
  revenue: "8633.6",
  ytdRevenue: "29539.18",
  ytdPeriodLabel: "1 Jan 2026 – 21 Sep 2026",
  ytdPeriodStart: "2026-01-01",
  ytdPeriodEnd: "2026-09-21",
  ytdBasis: "financial",
  cash: "7430.22",
  netIncome: "2501.12",
};

const yankeesBoard = boardFiguresFrom({
  financials: yankeesFinancials,
  snapshotSource: "xero",
  snapshotCreatedAt: "2026-09-18T19:44:12.740Z",
  financialsUpdatedAt: "2026-09-21T21:27:35.406Z",
});
assert(yankeesBoard?.source === "xero", "board source stays the saved Xero statement");
assert(yankeesBoard?.revenue === 8633.6, "board revenue is the overview total");
assert(
  yankeesBoard?.savedAt?.startsWith("2026-09-21"),
  "last ingest is the later financials write",
);

const xeroNeverSynced = describeLedgerLink(
  {
    provider: "xero",
    lastSyncedAt: null,
    syncStatus: "idle",
    figuresFromThisSync: false,
    own: null,
    board: yankeesBoard,
  },
  fmt,
);
const xeroText = `${xeroNeverSynced.statusLine} ${xeroNeverSynced.figuresLine ?? ""}`;
assert(xeroNeverSynced.statusLine === "Connected. No Xero sync yet.", xeroNeverSynced.statusLine);
assert(!/never/i.test(xeroText), "a missing Xero sync is not Last sync never");
assert(!/no period dates/i.test(xeroText), "dated overview figures are not called undated");
assert(!/not this month/i.test(xeroText), "a dated statement is not dismissed as not this month");
assert(xeroNeverSynced.figuresLine?.includes("a saved Xero statement") === true, xeroText);
assert(xeroNeverSynced.figuresLine?.includes("1 Sep 2026 – 21 Sep 2026") === true, xeroText);
assert(xeroNeverSynced.figuresLine?.includes("Revenue 8,633.60") === true, xeroText);
assert(
  xeroNeverSynced.figuresLine?.includes("Financial year to date 1 Jan 2026 – 21 Sep 2026") === true,
  xeroText,
);
assert(xeroNeverSynced.figuresLine?.includes("Revenue 29,539.18") === true, xeroText);
assert(xeroNeverSynced.figuresLine?.includes("Cash 7,430.22") === true, xeroText);
assert(xeroNeverSynced.figuresLine?.includes("saved 2026-09-21") === true, xeroText);
assert(
  xeroNeverSynced.showOwnStats === false,
  "unsynced Xero does not present the board as its sync grid",
);

const uploaded = boardFiguresFrom({
  financials: { revenue: 1200, cash: 80 },
  snapshotSource: "upload",
  snapshotCreatedAt: "2026-08-02T12:00:00.000Z",
});
const uploadCopy = describeLedgerLink(
  {
    provider: "xero",
    lastSyncedAt: null,
    syncStatus: "idle",
    figuresFromThisSync: false,
    own: null,
    board: uploaded,
  },
  fmt,
);
assert(
  uploadCopy.figuresLine?.includes("an uploaded statement") === true,
  uploadCopy.figuresLine ?? "",
);
assert(
  !/never|no period dates/i.test(`${uploadCopy.statusLine} ${uploadCopy.figuresLine}`),
  "upload is not an orphaned Xero sync",
);
assert(
  figureSourcePhrase("financial_statement") === "an imported statement",
  "trial-balance confirm is an import",
);
assert(figureSourcePhrase("trial_balance") === "a trial balance import", "trial balance source");
assert(figureSourcePhrase("pdf_upload") === "an uploaded statement", "pdf upload source");

const qboCache = readCachedQboSync(
  {
    to: "2026-09-21",
    from: "2026-09-01",
    revenue: 0,
    netIncome: 0,
    periodLabel: "1 Sep 2026 – 21 Sep 2026",
    year: {
      to: "2026-09-21",
      from: "2026-01-01",
      basis: "financial",
      revenue: 0,
      periodLabel: "1 Jan 2026 – 21 Sep 2026",
    },
  },
  { cash: 0 },
);
assert(qboCache?.periodLabel === "1 Sep 2026 – 21 Sep 2026", "QuickBooks cache keeps its period");
assert(qboCache?.revenue === 0, "QuickBooks cache revenue stays the synced zero");

const qbo = describeLedgerLink(
  {
    provider: "qbo",
    lastSyncedAt: "2026-09-21T21:07:20.534Z",
    syncStatus: "idle",
    figuresFromThisSync: false,
    own: qboCache,
    board: yankeesBoard,
  },
  fmt,
);
const qboText = `${qbo.statusLine} ${qbo.figuresLine ?? ""}`;
assert(qbo.statusLine.includes("Last sync 2026-09-21"), qbo.statusLine);
assert(
  qbo.statusLine.includes("QuickBooks month to date 1 Sep 2026 – 21 Sep 2026"),
  qbo.statusLine,
);
assert(
  !qbo.statusLine.includes("0.00"),
  "a zero that did not become the board is not the headline total",
);
assert(
  !/no period dates/i.test(qboText),
  "QuickBooks must not call the dated overview total undated",
);
assert(
  !/not this month/i.test(qboText),
  "QuickBooks must not say the dated overview is not this month",
);
assert(qbo.figuresLine?.includes("a saved Xero statement") === true, qboText);
assert(qbo.figuresLine?.includes("Revenue 8,633.60") === true, qboText);
assert(qbo.figuresLine?.includes("Not this QuickBooks sync.") === true, qboText);
assert(qbo.showOwnStats === false, "another source's figures are not the QuickBooks stat grid");

const qboAttribution = ledgerAttribution({
  provider: "qbo",
  lastSyncedAt: "2026-09-21T21:07:20.534Z",
  financials: yankeesFinancials,
  financialsUpdatedAt: "2026-09-21T21:27:35.406Z",
  snapshots: [{ source: "xero", created_at: "2026-09-18T19:44:12.740Z" }],
  ownFromBlob: {
    periodLabel: null,
    revenue: null,
    ytdPeriodLabel: null,
    ytdRevenue: null,
    ytdBasis: null,
    cash: null,
  },
  ownFromCache: qboCache,
});
assert(
  qboAttribution.figuresFromThisSync === false,
  "Xero-tagged figures are not this QuickBooks sync",
);
assert(
  qboAttribution.syncFigures?.periodLabel === "1 Sep 2026 – 21 Sep 2026",
  "cache period is the QuickBooks sync",
);
assert(qboAttribution.boardFigures?.source === "xero", "board stays the Xero statement");

const xeroAttribution = ledgerAttribution({
  provider: "xero",
  lastSyncedAt: null,
  financials: yankeesFinancials,
  financialsUpdatedAt: "2026-09-21T21:27:35.406Z",
  snapshots: [{ source: "xero", created_at: "2026-09-18T19:44:12.740Z" }],
  ownFromBlob: {
    periodLabel: "1 Sep 2026 – 21 Sep 2026",
    revenue: 8633.6,
    ytdPeriodLabel: "1 Jan 2026 – 21 Sep 2026",
    ytdRevenue: 29539.18,
    ytdBasis: "financial",
    cash: 7430.22,
  },
});
assert(
  xeroAttribution.figuresFromThisSync === false,
  "no last_synced_at means this link did not write the board",
);
assert(xeroAttribution.syncFigures === null, "unsynced Xero has no sync totals");
assert(xeroAttribution.boardFigures?.cash === 7430.22, "cash stays on the board attribution");

const owned = describeLedgerLink(
  {
    provider: "xero",
    lastSyncedAt: "2026-09-21T21:40:00.000Z",
    syncStatus: "idle",
    figuresFromThisSync: true,
    own: xeroAttribution.boardFigures,
    board: xeroAttribution.boardFigures,
  },
  fmt,
);
assert(owned.showOwnStats === true, "a dated sync that wrote the board shows its own grid");
assert(owned.figuresLine === null, "no second source line when this sync owns the figures");
assert(owned.statusLine.includes("Revenue 8,633.60"), owned.statusLine);
assert(owned.statusLine.includes("Last sync 2026-09-21"), owned.statusLine);

const undated = describeLedgerLink(
  {
    provider: "qbo",
    lastSyncedAt: "2026-09-21T21:07:20.534Z",
    syncStatus: "idle",
    figuresFromThisSync: true,
    own: {
      periodLabel: null,
      revenue: 100,
      ytdPeriodLabel: null,
      ytdRevenue: null,
      ytdBasis: null,
      cash: null,
    },
    board: {
      source: "qbo",
      savedAt: null,
      periodLabel: null,
      revenue: 100,
      ytdPeriodLabel: null,
      ytdRevenue: null,
      ytdBasis: null,
      cash: null,
    },
  },
  fmt,
);
assert(/no period dates/.test(undated.statusLine), undated.statusLine);
assert(/not this month/.test(undated.statusLine), "an undated total is explicitly not this month");
assert(undated.showOwnStats === false, "undated sync does not render a month grid");

const samePeriod = {
  period_label: "1 Sep 2026 – 21 Sep 2026",
  period_date: "2026-09-21",
  financials: { revenue: 8633.6, netIncome: 2501.12 },
};
assert(
  resolvePriorSnapshot([samePeriod], new Date("2026-10-07T12:00:00Z"), {
    periodEnd: "2026-09-21",
    financials: { revenue: 8633.6, netIncome: 2501.12 },
  }) === null,
  "the current statement snapshot is not a prior month",
);

const flatChips = buildVarianceChips({
  currentFinancials: { revenue: 8633.6, cogs: 0, ebit: 2500 },
  currentRatios: { "Gross Margin": 0.91, "Operating Margin": 0.29 },
  prior: samePeriod,
});
const undatedSnap = buildFinancialSnapshot({
  chips: flatChips,
  datedPeriod: false,
});
assert(
  undatedSnap.every((row) => !row.delta),
  "missing period dates do not render flat, up, or down",
);
assert(
  undatedSnap.find((row) => row.key === "revenue")?.hint === "Period not dated",
  "revenue says the period is not dated",
);

const datedSnap = buildFinancialSnapshot({
  chips: buildVarianceChips({
    currentFinancials: { revenue: 8633.6, cogs: 0, ebit: 2500 },
    currentRatios: { "Gross Margin": 0.91, "Operating Margin": 0.29 },
    prior: null,
  }),
  datedPeriod: true,
  periodLabel: "1 Sep 2026 – 21 Sep 2026",
});
const datedRevenue = datedSnap.find((row) => row.key === "revenue");
assert(!datedRevenue?.delta, "no distinct prior means no month-on-month mark");
assert(datedRevenue?.hint === "1 Sep 2026 – 21 Sep 2026", datedRevenue?.hint ?? "");

const route = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(
  /resolvePriorSnapshot\(\s*snapshots,\s*new Date\(\),\s*\{[\s\S]*periodEnd:\s*statementMeta\.periodEnd/.test(
    route,
  ),
  "overview prior period excludes the current statement",
);
assert(
  route.includes("datedPeriod: statementDated"),
  "snapshot movement follows the statement dates",
);
assert(
  route.includes("figuresPeriodLabel={statementDated ? statementMeta.periodLabel : null}"),
  "workflow kicker follows the statement dates",
);
assert(
  route.includes("boardFigures: xeroLink.boardFigures"),
  "Xero proof receives the board source",
);
assert(
  route.includes("boardFigures: qboLink.boardFigures"),
  "QuickBooks proof receives the board source",
);

const briefing = read("src/components/client-briefing.tsx");
const xeroCard = read("src/components/xero-connect.tsx");
const qboCard = read("src/components/qbo-connect.tsx");
for (const [name, src] of [
  ["briefing", briefing],
  ["xero card", xeroCard],
  ["quickbooks card", qboCard],
] as const) {
  assert(src.includes("describeLedgerLink"), `${name} uses the shared status copy`);
  assert(!src.includes('return "never"'), `${name} does not render Last sync never`);
  assert(
    !src.includes("Last sync ${fmtDate(status.lastSyncedAt)}"),
    `${name} does not assume a sync timestamp`,
  );
}
assert(
  briefing.includes('figuresPeriodLabel ? "This month\'s Milōn workflow" : "Milōn workflow"'),
  "undated figures drop this month",
);
assert(
  xeroCard.includes('id="xero-link-proof"') === false || briefing.includes('id="xero-link-proof"'),
  "overview keeps the Xero proof",
);
assert(briefing.includes('id="xero-link-proof"'), "overview keeps the Xero proof");
assert(briefing.includes('id="qbo-link-proof"'), "overview keeps the QuickBooks proof");

console.log("ledger-link-copy: all assertions passed");
