/**
 * After a QBO or Xero sync, the upload auto-populate path runs, QuickBooks
 * seeds the 13-week cash forecast the way Xero bank activity does, and the
 * sync owns the live figures so an older statement cannot stay in front.
 *
 * Run: pnpm test:sync-auto-populate
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAutoPopulateWrites, ledgerSeededCashflow } from "../src/lib/auto-populate";
import {
  applyLedgerSyncFinancials,
  autosaveKeepsLedgerSync,
  emptyLedgerSyncError,
  ledgerSyncWouldWipe,
} from "../src/lib/ledger-sync-financials";
import { resolveThirteenWeekForecast } from "../src/lib/client-metrics";
import { describeLedgerLink, ledgerAttribution } from "../src/lib/ledger-link-copy";
import { ZA_MARKET } from "../src/lib/market";
import { qboBankActivityFromParts, sumQboQueryAmounts } from "../src/lib/qbo";
import {
  applyQboOpeningCash,
  applyXeroOpeningCash,
  isQboBalanceSheetHoldNote,
  QBO_BANK_LINES_SOURCE,
  QBO_BANK_RECEIVED_LINE_ID,
  QBO_BANK_SPENT_LINE_ID,
  seedQboBankForecastLines,
  seedXeroBankForecastLines,
  XERO_BANK_LINES_SOURCE,
  XERO_BANK_RECEIVED_LINE_ID,
} from "../src/lib/xero-opening";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const yankeesXero = {
  statementSource: "xero",
  periodLabel: "1 Sep 2026 – 21 Sep 2026",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-21",
  revenue: "8633.6",
  ytdRevenue: "29539.18",
  ytdPeriodLabel: "1 Jan 2026 – 21 Sep 2026",
  ytdBasis: "financial",
  cash: "7430.22",
  currentAssets: "9000",
  netIncome: "2501.12",
  weeklyInputs: { weeks: { "1": { revenue: "1" } } },
};

const qboFields: Record<string, string | number> = {
  statementSource: "qbo",
  periodLabel: "1 Oct 2026 – 7 Oct 2026",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-07",
  periodMonths: "1",
  revenue: 1200,
  netIncome: 400,
  cash: 500,
  fixedCosts: 300,
};

const owned = applyLedgerSyncFinancials(yankeesXero, qboFields, "qbo");
assert(owned.statementSource === "qbo", "a QuickBooks sync replaces the saved Xero statement");
assert(owned.revenue === 1200, "sync revenue replaces the statement");
assert(
  owned.periodLabel === "1 Oct 2026 – 7 Oct 2026",
  "sync period replaces the statement period",
);
assert(owned.ytdRevenue == null, "the Xero year-to-date companion does not survive");
assert(owned.currentAssets == null, "a Xero-only figure does not survive a QuickBooks sync");
assert(owned.cash === 500, "sync cash replaces the statement cash");

const zeroQbo: Record<string, string | number> = {
  statementSource: "qbo",
  periodLabel: "1 Oct 2026 – 7 Oct 2026",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-07",
  periodMonths: "1",
  revenue: 0,
  cogs: 0,
  netIncome: 0,
  fixedCosts: 0,
  cash: "0.00",
  totalAssets: 0,
  equity: 0,
  ytdRevenue: 0,
  ytdNetIncome: 0,
};
assert(
  ledgerSyncWouldWipe(yankeesXero, zeroQbo),
  "an all-zero QuickBooks report would wipe live figures",
);
const keptYankees = applyLedgerSyncFinancials(yankeesXero, zeroQbo, "qbo");
assert(
  keptYankees.statementSource === "xero",
  "an empty QuickBooks sync does not take the Xero statement",
);
assert(keptYankees.revenue === yankeesXero.revenue, "empty QuickBooks sync keeps revenue");
assert(keptYankees.cash === yankeesXero.cash, "empty QuickBooks sync keeps cash");
assert(
  keptYankees.periodLabel === yankeesXero.periodLabel,
  "empty QuickBooks sync does not retitle the period as QuickBooks",
);
assert(
  emptyLedgerSyncError("qbo").includes("left unchanged"),
  "the empty-sync error says the figures were left unchanged",
);
const blankFile = applyLedgerSyncFinancials({}, zeroQbo, "qbo");
assert(
  blankFile.statementSource === "qbo",
  "a blank file can still accept an empty QuickBooks sync",
);
assert(
  JSON.stringify(owned.weeklyInputs) === JSON.stringify(yankeesXero.weeklyInputs),
  "weekly inputs the sync does not own stay on the file",
);

const staleAutosave = autosaveKeepsLedgerSync(owned, yankeesXero);
assert(staleAutosave.statementSource === "qbo", "autosave does not put the old statement back");
assert(staleAutosave.revenue === 1200, "autosave keeps the sync revenue");
assert(
  JSON.stringify(staleAutosave.weeklyInputs) === JSON.stringify(yankeesXero.weeklyInputs),
  "autosave still keeps weekly inputs from the open form",
);

const sameSource = autosaveKeepsLedgerSync(owned, { ...owned, revenue: 1300 });
assert(sameSource.revenue === 1300, "an edit after the sync owns the file still saves");

const qboBoard = {
  source: "qbo",
  savedAt: "2026-10-07T12:00:00.000Z",
  periodLabel: "1 Oct 2026 – 7 Oct 2026",
  revenue: 1200,
  ytdPeriodLabel: null,
  ytdRevenue: null,
  ytdBasis: null,
  cash: 500,
};
const copy = describeLedgerLink(
  {
    provider: "qbo",
    lastSyncedAt: "2026-10-07T12:00:00.000Z",
    syncStatus: "idle",
    figuresFromThisSync: true,
    own: {
      periodLabel: qboBoard.periodLabel,
      revenue: 1200,
      ytdPeriodLabel: null,
      ytdRevenue: null,
      ytdBasis: null,
      cash: 500,
    },
    board: qboBoard,
  },
  (iso) => iso.slice(0, 10),
);
assert(copy.figuresLine === null, "no second source line when the sync owns the file");
assert(copy.showOwnStats === true, "the sync shows its own figures");
assert(
  !/Not this QuickBooks sync/.test(`${copy.statusLine} ${copy.figuresLine ?? ""}`),
  "no dual source",
);

const attribution = ledgerAttribution({
  provider: "qbo",
  lastSyncedAt: "2026-10-07T12:00:00.000Z",
  financials: owned,
  financialsUpdatedAt: "2026-10-07T12:00:00.000Z",
  snapshots: [{ source: "xero", created_at: "2026-09-18T19:44:12.740Z" }],
  ownFromBlob: {
    periodLabel: "1 Oct 2026 – 7 Oct 2026",
    revenue: 1200,
    ytdPeriodLabel: null,
    ytdRevenue: null,
    ytdBasis: null,
    cash: 500,
  },
});
assert(attribution.figuresFromThisSync === true, "the live file is this QuickBooks sync");
assert(attribution.boardFigures?.source === "qbo", "the board is not the older Xero statement");

const activity = qboBankActivityFromParts({
  accounts: [
    { id: "1", name: "Checking", type: "Bank", subType: "Checking", balance: 800, active: true },
    { id: "2", name: "Savings", type: "Bank", subType: "Savings", balance: 200, active: true },
    { id: "3", name: "Income", type: "Income", subType: "Sales", balance: 9999, active: true },
  ],
  balanceSheetCash: 50,
  received: 1300,
  spent: 650,
  from: "2026-07-08",
  to: "2026-10-07",
});
assert(activity.accountCount === 2, "only bank accounts count");
assert(
  activity.totalClosing === 1000,
  "opening cash is the bank-account total, not the income account",
);
assert(activity.source === "bank_accounts", "bank accounts beat the balance-sheet cash line");
assert(activity.cashReceived === 1300 && activity.cashSpent === 650, "cash in and cash out stay");
assert(
  sumQboQueryAmounts({
    QueryResponse: { Deposit: [{ TotalAmt: 10 }, { TotalAmt: -2.5 }], Payment: [{ TotalAmt: 1 }] },
  }) === 13.5,
  "query totals are absolute amounts",
);

const opening = applyQboOpeningCash(null, activity.totalClosing ?? 0, "2026-10-07");
assert(
  opening.changed && opening.cashflow.openingBalanceSource === "qbo",
  "QuickBooks owns a blank opening",
);
const seeded = seedQboBankForecastLines(opening.cashflow, {
  accountCount: activity.accountCount,
  cashReceived: activity.cashReceived,
  cashSpent: activity.cashSpent,
  from: activity.from,
  to: activity.to,
});
assert(seeded.status === "seeded" && seeded.changed, "QuickBooks seeds weekly lines");
const revenue = seeded.cashflow.revenue as Array<{ id: string; frequency: string; amount: string }>;
const expenses = seeded.cashflow.expenses as Array<{ id: string }>;
assert(revenue[0]?.id === QBO_BANK_RECEIVED_LINE_ID, "cash received is the QuickBooks line");
assert(revenue[0]?.frequency === "recurring-weekly", "cash received is a weekly run-rate");
assert(
  revenue[0]?.amount === String(Math.round((1300 / 13) * 100) / 100),
  "weekly received is the window total divided by 13",
);
assert(expenses[0]?.id === QBO_BANK_SPENT_LINE_ID, "cash spent is the QuickBooks line");
assert(
  seeded.cashflow.forecastLinesSource === QBO_BANK_LINES_SOURCE,
  "lines are marked QuickBooks",
);
assert(ledgerSeededCashflow(seeded.cashflow as never), "auto-populate can see the ledger seed");

const taken = seedXeroBankForecastLines(seeded.cashflow, {
  accountCount: 1,
  cashReceived: 2600,
  cashSpent: 900,
  from: "2026-07-08",
  to: "2026-10-07",
});
assert(
  taken.status === "refreshed" && taken.changed,
  "a later Xero sync replaces QuickBooks lines",
);
assert(
  (taken.cashflow.revenue as Array<{ id: string }>)[0]?.id === XERO_BANK_RECEIVED_LINE_ID,
  "the Xero line replaces the QuickBooks line",
);
assert(
  taken.cashflow.forecastLinesSource === XERO_BANK_LINES_SOURCE,
  "Xero owns the lines after its sync",
);

const back = seedQboBankForecastLines(taken.cashflow, {
  accountCount: 2,
  cashReceived: 1300,
  cashSpent: 650,
  from: "2026-07-08",
  to: "2026-10-07",
});
assert(
  back.changed && back.cashflow.forecastLinesSource === QBO_BANK_LINES_SOURCE,
  "QuickBooks can take the file back",
);

const typed = seedQboBankForecastLines(
  {
    openingBalance: "10",
    revenue: [
      {
        id: "sales",
        name: "Sales",
        amount: "500",
        frequency: "recurring-weekly",
        startWeek: 1,
        splitCount: 1,
      },
    ],
  },
  { accountCount: 1, cashReceived: 100, cashSpent: 40, from: "2026-07-08", to: "2026-10-07" },
);
assert(typed.status === "skipped", "typed forecast amounts block the QuickBooks seed");

const xeroOwnedOpening = applyXeroOpeningCash(
  { openingBalance: "1000", openingBalanceSource: "qbo" },
  800,
  "2026-10-07",
);
assert(
  xeroOwnedOpening.changed && xeroOwnedOpening.cashflow.openingBalanceSource === "xero",
  "a ledger opening refreshes when the other ledger syncs",
);
assert(
  applyQboOpeningCash({ openingBalance: "10" }, 800, "2026-10-07").reason === "typed_opening",
  "a typed opening still wins",
);

const noBanks = qboBankActivityFromParts({
  accounts: [
    { id: "9", name: "Sales", type: "Income", subType: "Sales", balance: 8633, active: true },
  ],
  balanceSheetCash: 7430.22,
  received: 0,
  spent: 0,
  from: "2026-07-08",
  to: "2026-10-07",
});
assert(noBanks.accountCount === 0, "an income account is not a bank account");
assert(noBanks.source === "balance_sheet", "no bank accounts fall back to the balance sheet");
assert(noBanks.totalClosing === 7430.22, "opening cash is the balance-sheet cash line");
const typedOpening = applyQboOpeningCash(
  { openingBalance: "100" },
  noBanks.totalClosing ?? 0,
  "2026-10-07",
);
assert(
  typedOpening.reason === "typed_opening",
  "balance-sheet cash does not overwrite a typed opening",
);
const held = seedQboBankForecastLines(
  typedOpening.cashflow,
  {
    accountCount: noBanks.accountCount,
    cashReceived: noBanks.cashReceived,
    cashSpent: noBanks.cashSpent,
    from: noBanks.from,
    to: noBanks.to,
  },
  { balanceSheetCash: 7430.22 },
);
assert(
  held.status === "seeded" && held.changed,
  "no bank accounts still seed from balance-sheet cash",
);
assert(held.cashflow.openingBalance === "100", "the seeded forecast keeps the typed opening");
assert(
  held.cashflow.forecastLinesSource === QBO_BANK_LINES_SOURCE,
  "the hold is a QuickBooks forecast",
);
assert(
  isQboBalanceSheetHoldNote(String(held.reason)),
  "the note names the balance sheet and 13 weeks",
);
const heldLines = held.cashflow.revenue as Array<{ id: string; frequency: string }>;
assert(heldLines[0]?.id === QBO_BANK_RECEIVED_LINE_ID, "the hold is a QuickBooks forecast line");
assert(heldLines[0]?.frequency === "recurring-weekly", "the hold covers the weekly forecast");
const holdOutlook = resolveThirteenWeekForecast({
  financials: { revenue: 0, cogs: 0, fixedCosts: 0, cash: 7430.22, periodMonths: "1" },
  cashflow: held.cashflow,
  openingCash: 100,
  now: new Date(2026, 9, 7),
});
assert(holdOutlook.replaceStored === false, "a balance-sheet hold is not replaced by a zero P&L");
assert(holdOutlook.weekDates.length === 13, "the hold is a 13-week forecast");
assert(holdOutlook.opening === 100, "the hold uses the typed opening");
assert(
  holdOutlook.inflow.every((n) => n === 0) && holdOutlook.outflow.every((n) => n === 0),
  "the hold does not invent cash received or cash spent",
);
assert(
  !ledgerSeededCashflow(held.cashflow as never),
  "a zero-movement hold can still be upgraded from the budget",
);

const quietMonth = buildAutoPopulateWrites(
  { profitability: true, cash_forecast: true, budget: true },
  {
    fields: { revenue: "1200", cogs: "400", fixedCosts: "300", cash: "7430.22", periodMonths: "1" },
    existingCashflow: held.cashflow as never,
    market: ZA_MARKET,
    now: "2026-10-07T12:00:00.000Z",
  },
);
assert(quietMonth.applied.includes("cash_forecast"), "real figures still draft the cash forecast");
assert(
  (quietMonth.update.cashflow as { openingBalance?: string }).openingBalance === "100",
  "the budget draft does not overwrite a typed opening",
);

const kept = buildAutoPopulateWrites(
  { profitability: true, cash_forecast: true, budget: true },
  {
    fields: { revenue: "1200", cogs: "400", fixedCosts: "300", cash: "500", periodMonths: "1" },
    existingCashflow: seeded.cashflow as never,
    market: ZA_MARKET,
    now: "2026-10-07T12:00:00.000Z",
  },
);
assert(kept.applied.includes("budget"), "sync still seeds the budget");
assert(kept.applied.includes("cash_forecast"), "cash forecast counts as populated");
assert(!("cashflow" in kept.update), "ledger cash lines are not replaced by the budget draft");
assert(
  kept.changes.some((line) => line.includes("ledger sync")),
  "the change says the ledger seed was kept",
);

const owner = read("src/routes/app.tsx");
const studio = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(owner.includes("runSyncAutoPopulate"), "owner sync runs auto-populate");
assert(
  (owner.match(/runSyncAutoPopulate\(/g) ?? []).length >= 3,
  "owner QuickBooks, Xero, and Sage populate",
);
assert(studio.includes("runSyncAutoPopulate"), "accountant sync runs auto-populate");
assert(studio.includes("populateAfterSync"), "accountant sync handlers share one populate path");
const qboFn = read("src/lib/qbo.functions.ts");
const xeroFn = read("src/lib/xero.functions.ts");
assert(qboFn.includes("seedQboBankForecastLines"), "QuickBooks sync seeds forecast lines");
assert(qboFn.includes("applyLedgerSyncFinancials"), "QuickBooks sync owns the live file");
assert(xeroFn.includes("applyLedgerSyncFinancials"), "Xero sync owns the live file");
assert(qboFn.includes("fetchQboBankActivity"), "QuickBooks sync reads bank activity");
const briefing = read("src/components/client-briefing.tsx");
assert(briefing.includes("syncOwnsFigures"), "a sync that owns the file demotes the upload CTA");
assert(
  briefing.includes("Upload a statement instead"),
  "upload stays available without a second primary CTA",
);
assert(
  briefing.includes("syncOwnsFigures ? null"),
  "a sync that owns the file hides Connect QuickBooks and Connect Xero",
);
assert(qboFn.includes("ledgerSyncWouldWipe"), "QuickBooks sync refuses an empty report");
const sageServer = read("src/lib/sage-sync.server.ts");
assert(sageServer.includes("sageSyncWriteDecision"), "Sage sync refuses an empty report");
assert(
  sageServer.includes('applyLedgerSyncFinancials(prev, fields, "sage")'),
  "Sage sync owns the live file",
);
assert(owner.includes("auto-populate after Sage sync:"), "owner Sage sync runs auto-populate");
assert(
  studio.includes('populateAfterSync(inputs, "Sage")'),
  "accountant Sage sync runs auto-populate",
);
assert(
  qboFn.includes("balanceSheetCash"),
  "QuickBooks sync passes balance-sheet cash into the forecast seed",
);
const qboComplete = studio.slice(
  studio.indexOf("const onQboSyncComplete"),
  studio.indexOf("const onXeroSyncComplete"),
);
assert(
  qboComplete.includes("setCashForecastReloadToken"),
  "QuickBooks sync reloads the cash forecast",
);

console.log("sync-auto-populate: all assertions passed");
