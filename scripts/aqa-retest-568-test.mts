/**
 * Retest of #568 on prod 591b127a.
 * Run: pnpm test:aqa-retest-568
 */
import { assessClientMetrics } from "../src/lib/client-metrics";
import {
  clientListRunwayHeadline,
  clientListStatusWord,
  forecastRunwayHeadlineShared,
} from "../src/lib/cash-forecast-parity";
import { formatFirmClientUsage } from "../src/lib/firm-band-upgrade";
import { ZA_MARKET } from "../src/lib/market";
import { ownerCardStatuses, type OwnerBooks } from "../src/lib/owner-answers";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const empty = assessClientMetrics({});
const emptyRaw = forecastRunwayHeadlineShared({
  opening: empty.outlook.opening,
  closings: empty.outlook.closing,
  floor: empty.outlook.floor,
}).headline;
assert(empty.outlook.cashOnFile === false, "an empty file has no cash balance");
assert(empty.outlook.dipsBelowFloorWeek == null, "an empty file does not invent a floor breach");
assert(emptyRaw === "13+ wks", `empty series raw headline (${emptyRaw})`);
assert(
  clientListRunwayHeadline({
    source: empty.outlook.source,
    opening: empty.outlook.opening,
    closings: empty.outlook.closing,
    floor: empty.outlook.floor,
    totalInflow: empty.outlook.totalInflow,
    totalOutflow: empty.outlook.totalOutflow,
    healthOverall: null,
  }) === "—",
  "no forecast data does not say 13 weeks below",
);
assert(
  clientListStatusWord({
    healthLabel: "Watch",
    healthOverall: null,
    source: empty.outlook.source,
    opening: empty.outlook.opening,
    floor: empty.outlook.floor,
    dipsBelowFloorWeek: empty.outlook.dipsBelowFloorWeek,
    totalInflow: empty.outlook.totalInflow,
    totalOutflow: empty.outlook.totalOutflow,
  }) === "—",
  "an unscored row stays blank",
);

const sketch = assessClientMetrics({ financials: { revenue: "1000", ebit: "220" } });
assert(
  clientListRunwayHeadline({
    source: sketch.outlook.source,
    opening: sketch.outlook.opening,
    closings: sketch.outlook.closing,
    floor: sketch.outlook.floor,
    totalInflow: sketch.outlook.totalInflow,
    totalOutflow: sketch.outlook.totalOutflow,
    healthOverall: null,
  }) === "—",
  "an unscored derived sketch is not a forecast",
);

const closings = Array.from({ length: 13 }, (_, week) => (week < 7 ? 44_480 : 20_000));
const dipped = {
  source: "stored" as const,
  opening: 44_480,
  floor: 34_903,
  dipsBelowFloorWeek: 8,
  totalInflow: 120_000,
  totalOutflow: 140_000,
};
assert(
  clientListStatusWord({
    healthLabel: "Watch",
    healthOverall: 71,
    ...dipped,
  }) === "Critical: cash below floor",
  "a floor dip uses the Financial Manager word",
);
const runway = clientListRunwayHeadline({
  ...dipped,
  closings,
  healthOverall: 71,
  runwayLabel: "Cash generative",
  cashGenerative: true,
});
assert(runway === "6 weeks below", runway);
assert(runway !== "Cash generative", "the floor headline replaces the P&L label");

const books: OwnerBooks = {
  hasBooks: true,
  ledger: "Xero",
  revenue: null,
  priorRevenue: null,
  cogs: null,
  priorCogs: null,
  receivables: null,
  cashflow: null,
  cashOutlook: {
    opening: dipped.opening,
    closing: closings,
    floor: dipped.floor,
    dipsBelowFloorWeek: dipped.dipsBelowFloorWeek,
  },
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: ZA_MARKET,
};
assert(
  ownerCardStatuses(books).financial_manager?.word === "Below your minimum",
  "the Financial Manager card is a floor alert on the same outlook",
);
assert(
  clientListStatusWord({
    healthLabel: "Watch",
    healthOverall: 71,
    source: "stored",
    opening: 80_000,
    floor: 34_903,
    dipsBelowFloorWeek: null,
    totalInflow: 10_000,
    totalOutflow: 8_000,
  }) === "Watch",
  "cash above the floor keeps the health word",
);

assert(
  formatFirmClientUsage(8, 5, "Starter") === "8 active clients · Starter limit 5",
  formatFirmClientUsage(8, 5, "Starter"),
);

console.log("aqa retest 568 ok");
