/**
 * Detailed cashflow forecast — week overrides + accountant chrome.
 * Run: pnpm test:cash-forecast-detail
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CashThirteenWeekGrid } from "../src/components/cash-thirteen-week";
import { distributeForecastLine } from "../src/lib/client-metrics";
import {
  applyCashLineSchedule,
  cashLineFillFrequency,
  CASH_LINE_FREQUENCY_LABEL,
} from "../src/lib/cash-line-schedule";
import { projectForecastFrequency } from "../src/lib/cash-recurring-payees";
import {
  applyWeekOverrides,
  parseEditableAmount,
  setWeekOverride,
} from "../src/lib/cash-week-overrides";
import { figureSourceChipLabel } from "../src/lib/ledger-link-copy";
import {
  cashForecastSearchWithView,
  cashForecastViewFromSearch,
  cashStackedEnlargeTarget,
  cashBalanceSeries,
  cashGraphAxisTicks,
  cashGraphWeekTickInterval,
  forecastChipSource,
  hashIsCashDetailAnchor,
  lowestCashPoint,
  weeksBelowFloorCopy,
} from "../src/lib/cash-forecast-view";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const base = [10, 20, 30, 40];
assert(applyWeekOverrides(base, { "1": 99 })[1] === 99, "override replaces one week");
assert(applyWeekOverrides(base, { "1": 99 })[0] === 10, "other weeks stay formula");
assert(applyWeekOverrides(base, null)[2] === 30, "no overrides is identity");
assert(applyWeekOverrides(base, { "9": 1 })[0] === 10, "out-of-range override is ignored");

const added = setWeekOverride(undefined, 2, 50);
assert(added?.["2"] === 50, "first override creates the map");
assert(setWeekOverride(added, 2, null) === undefined, "clearing the last override drops the map");
assert(parseEditableAmount("1,250.5") === 1250.5, "typed amount strips commas");
assert(parseEditableAmount("") === null, "blank clears the override");
assert(parseEditableAmount("—") === null, "dash clears the override");

assert(cashForecastViewFromSearch(undefined) === "graph", "graph is the default with no param");
assert(cashForecastViewFromSearch("graph") === "graph", "an unknown view stays on the graph");
assert(cashForecastViewFromSearch("13week") === "13week", "view=13week opens the weekly model");
assert(cashGraphWeekTickInterval(360) === 2, "a 360-wide chart keeps W1 W4 W7 W10 W13");
assert(cashGraphWeekTickInterval(439) === 2, "a narrow chart thins the week ticks");
assert(cashGraphWeekTickInterval(440) === 0, "a chart that fits shows every week");
assert(cashGraphWeekTickInterval(1280) === 0, "a wide chart shows every week");
assert(cashGraphWeekTickInterval(0) === 0, "an unmeasured chart shows every week");
const below = weeksBelowFloorCopy({
  empty: false,
  weeksBelow: 6,
  horizon: 13,
  firstDipWeek: 8,
  firstDipDate: "23 Nov",
  opensBelow: false,
});
assert(below.value === "6 of 13", "weeks below floor counts the horizon");
assert(below.sub === "first dip W8 · 23 Nov", "the first dip names the week and date");
assert(
  weeksBelowFloorCopy({
    empty: false,
    weeksBelow: 0,
    horizon: 13,
    firstDipWeek: null,
    firstDipDate: null,
    opensBelow: false,
  }).sub === "stays above the floor",
  "a clear forecast does not invent a dip",
);
const opensUnder = cashBalanceSeries({
  opening: 46300,
  closings: [52080, 57860, 63640],
  floor: 49200,
});
assert(opensUnder[0]?.key === "Now" && opensUnder[0].belowFloor, "opening is the first point on the series");
assert(opensUnder[1]?.key === "W1" && opensUnder[1].belowFloor === false, "week 1 close can sit above the floor");
const opensUnderLow = lowestCashPoint(opensUnder);
assert(
  opensUnderLow.key === "Now" && opensUnderLow.belowFloor && opensUnderLow.balance === 46300,
  "the low point is the opening when it is under the floor",
);
const opensUnderCopy = weeksBelowFloorCopy({
  empty: false,
  weeksBelow: 0,
  horizon: 13,
  firstDipWeek: null,
  firstDipDate: null,
  opensBelow: true,
});
assert(opensUnderCopy.value === "Below floor now", opensUnderCopy.value);
assert(opensUnderCopy.sub === "recovers W1", opensUnderCopy.sub);
assert(!opensUnderCopy.value.startsWith("0 of"), "an under-floor opening is not 0 of 13");
const openingIsLow = cashBalanceSeries({
  opening: 128000,
  closings: [140000, 151000, 162000],
  floor: 49200,
});
const openingIsLowPoint = lowestCashPoint(openingIsLow);
assert(
  openingIsLowPoint.key === "Now" &&
    openingIsLowPoint.balance === 128000 &&
    openingIsLowPoint.belowFloor === false,
  "the opening can be the lowest point while staying above the floor",
);
assert(
  openingIsLow.every((point) => point.belowFloor === false),
  "an above-floor series has no breach to shade",
);
const dippedWhileOpen = weeksBelowFloorCopy({
  empty: false,
  weeksBelow: 2,
  horizon: 13,
  firstDipWeek: 8,
  firstDipDate: "23 Nov",
  opensBelow: true,
});
assert(dippedWhileOpen.value === "Below floor now", dippedWhileOpen.value);
assert(dippedWhileOpen.sub === "first dip W8 · 23 Nov", dippedWhileOpen.sub);
const axisKeys = ["Now", ...Array.from({ length: 13 }, (_, index) => `W${index + 1}`)];
assert(
  JSON.stringify(cashGraphAxisTicks(360, axisKeys)) === JSON.stringify(["Now", "W4", "W7", "W10", "W13"]),
  "a narrow chart keeps Now and the later week labels",
);
assert(cashGraphAxisTicks(1280, axisKeys) === undefined, "a wide chart shows every point including Now");
assert(hashIsCashDetailAnchor("#detailed-forecast"), "detailed-forecast is a legacy anchor");
assert(hashIsCashDetailAnchor("wizard-cash-table"), "the old table id is a legacy anchor");
assert(!hashIsCashDetailAnchor("#wizard-cash-outlook"), "the outlook anchor is not the table");
const cleared = cashForecastSearchWithView({ tab: "overview", section: "cash", view: "13week" }, "graph");
assert(!("view" in cleared), "graph drops the view param");
assert(cleared.section === "cash", "other search params stay");
assert(
  cashForecastSearchWithView({ section: "cash" }, "13week").view === "13week",
  "13-week writes view=13week",
);
assert(forecastChipSource("xero-bank-summary") === "xero", "xero lines use the Xero chip");
assert(forecastChipSource("qbo-bank-activity") === "qbo", "qbo lines use the QuickBooks chip");
assert(forecastChipSource("upload") === "upload", "an upload stays an upload chip");
assert(forecastChipSource(null) === "assumption", "an untagged line is an assumption");
assert(figureSourceChipLabel("assumption") === "Assumption", "assumption is a chip");
assert(figureSourceChipLabel("xero") === "Xero", "xero chip is unchanged");
assert(figureSourceChipLabel("qbo") === "QuickBooks", "quickbooks chip is unchanged");
assert(figureSourceChipLabel("upload") === "Uploaded statement", "upload chip is unchanged");

const cashSrc = readFileSync(resolve("src/components/cash-forecast.tsx"), "utf8");
const gridSrc = readFileSync(resolve("src/components/cash-thirteen-week.tsx"), "utf8");
assert(!cashSrc.includes('title="Detailed cashflow forecast"'), "the separate detailed section is gone");
assert(cashSrc.includes("Double-click a figure to edit"), "edit affordance stays on the 13-week view");
assert(gridSrc.includes("milon-forecast-amount"), "hover underline hint without restyle");
assert(cashSrc.includes("applyWeekOverrides"), "grid uses persisted week overrides");
assert(gridSrc.includes("{symbol}"), "currency symbol stays while editing");
assert(cashSrc.includes("cashBalanceSeries"), "the graph plots the shared opening series");
assert(cashSrc.includes("cashGraphAxisTicks"), "the graph thins week ticks from the frame width");
assert(gridSrc.includes("data-cash-opening-tight"), "an opening under the floor tints that cell");
const paymentsRow = gridSrc.slice(gridSrc.indexOf('key: "total-payments"'), gridSrc.indexOf('key: "total-payments"') + 280);
assert(paymentsRow.includes("blankZero: true"), "a zero payment week shows a dash");
assert(paymentsRow.includes('tone: "plain"') && paymentsRow.includes("rule: true"), "total payments stays neutral");
assert(!paymentsRow.includes('tone: "out"'), "total payments is not a red band");
assert(cashSrc.includes("<ViewToggle"), "cash uses the same Chart | 13-week toggle");
const cashToggleAt = cashSrc.indexOf('ariaLabel="Cash forecast"');
const cashToggleHeaderStart = cashSrc.lastIndexOf(
  'className="mb-3 flex flex-wrap items-center justify-end gap-2"',
  cashToggleAt,
);
const cashToggleHeader = cashSrc.slice(cashToggleHeaderStart, cashToggleAt);
assert(
  (cashToggleHeader.match(/<EnlargeButton/g) ?? []).length === 1,
  "one enlarge control sits in the toggle header",
);
assert(
  cashToggleHeader.includes("cashStackedEnlargeTarget"),
  "that control follows the active lens",
);
assert(cashStackedEnlargeTarget("chart", true) === "chart", "chart lens enlarges the graph");
assert(cashStackedEnlargeTarget("table", true) === "table", "13-week lens enlarges the table");
assert(cashStackedEnlargeTarget("table", false) === "table", "13-week still enlarges when the chart is empty");
assert(cashStackedEnlargeTarget("chart", false) === null, "an empty chart lens has no enlarge");
assert(cashSrc.includes('label: "13-week"'), "the cash toggle names the 13-week table");
assert(cashSrc.includes('id="detailed-forecast"'), "the weekly table keeps the old anchor");
assert(cashSrc.includes("<CashThirteenWeekGrid"), "the weekly table sits on the cash page");
assert(cashSrc.includes("detailed-forecast"), "old detailed-forecast anchor still resolves");
assert(cashSrc.includes("hashIsCashDetailAnchor"), "anchor hashes redirect onto the card");
assert(cashSrc.includes("const startLabel = weeks[0]"), "forecast start uses the week-axis label");
assert(cashSrc.includes("sub={openingLabel}"), "opening tile can use the balance-sheet date");
assert(cashSrc.includes("balanceSheetCashAsOf"), "opening label reads the statement cash date");
assert(cashSrc.includes("openingNote={openingAsOf ? openingLabel : null}"), "13-week opening uses the balance-sheet date");
assert(gridSrc.includes('row.key === "opening" && openingNote'), "opening row shows the as-of date");
assert(!cashSrc.includes("`Start ${startDate}`"), "opening stat does not print the raw ISO start");
assert(!cashSrc.includes("`Forecast starts ${startDate}"), "PDF assumption does not print the raw ISO start");

const studio = readFileSync(
  resolve("src/routes/_authenticated/clients.$clientId.tsx"),
  "utf8",
);
assert(studio.includes('activeTab === "cash"'), "cash tab hides simple/complex");
assert(!studio.includes('id="wizard-profit-walk" style={{ colorScheme: "dark" }}'), "no dark island");

const wf = readFileSync(resolve("src/components/profitability-waterfall.tsx"), "utf8");
assert(wf.includes("text-[#102A43]"), "waterfall values use navy that survives light-mode overrides");
assert(wf.includes("bg-[#FFFFFF]/90"), "value labels sit on a readable chip");
assert(wf.includes("profitStepBand"), "waterfall chips use the shared score band");
assert(!wf.includes('"AT RISK"'), "waterfall does not keep a private AT RISK label");

assert(!gridSrc.includes("SourceChip"), "13-week lines do not render a source chip");
assert(!gridSrc.includes("figureSourceChipLabel"), "13-week lines do not label assumption chips");
assert(!gridSrc.includes("openingChip"), "the grid no longer takes a source chip");
assert(gridSrc.includes("data-cash-line-schedule"), "editable lines show interval and start week");
assert(gridSrc.includes("Interval for"), "the interval control is named");
assert(gridSrc.includes("Start week for"), "the start week control is named");
assert(cashSrc.includes("onSchedule={commitLineSchedule}"), "interval edits use the cash line state");
assert(cashSrc.includes("applyCashLineSchedule"), "a new cadence clears week overrides and refills");
assert(!cashSrc.includes("openingChip"), "the cash page no longer passes assumption chips");
assert(!cashSrc.includes("flowChip"), "receipt and payment chips are gone");
const ownerDoor = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const accountantDoor = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(ownerDoor.includes("<CashForecastPanel"), "the owner mounts the shared cash forecast");
assert(accountantDoor.includes("<CashForecastPanel"), "the accountant mounts the shared cash forecast");
assert(!ownerDoor.includes("CashThirteenWeekGrid"), "the owner has no second 13-week table");
assert(!accountantDoor.includes("CashThirteenWeekGrid"), "the accountant has no second 13-week table");
assert(
  !Object.values(CASH_LINE_FREQUENCY_LABEL).some((label) => /fortnight/i.test(label)),
  "the interval list does not invent a fortnight",
);
assert(CASH_LINE_FREQUENCY_LABEL["once-off"] === "Once-off", "once-off stays a supported cadence");
assert(CASH_LINE_FREQUENCY_LABEL["recurring-weekly"] === "Weekly", "weekly stays a supported cadence");
assert(CASH_LINE_FREQUENCY_LABEL["recurring-monthly"] === "Monthly", "monthly stays a supported cadence");

const cardboard = {
  id: "cardboard",
  name: "Mpact Recycling (cardboard)",
  amount: "31000",
  frequency: "recurring-weekly",
  startWeek: 1,
  splitCount: 1,
  weekOverrides: { "2": 5 },
};
const onceCardboard = applyCashLineSchedule(cardboard, { frequency: "once-off" });
assert(onceCardboard.weekOverrides == null, "a new interval drops hand-edited weeks");
assert(onceCardboard.frequency === "once-off", "the receipt stores once-off");
assert(onceCardboard.scheduleExplicit === true, "choosing an interval keeps that cadence");
assert(applyCashLineSchedule(cardboard, { startWeek: 4 }).scheduleExplicit !== true, "moving the start week leaves the display rule alone");
const projectedReceipt = projectForecastFrequency("Mpact Recycling (cardboard)", "once-off", null, {
  side: "revenue",
  singleMonth: true,
});
assert(projectedReceipt === "recurring-monthly", "an untouched once-off receipt is still assumed monthly");
assert(
  cashLineFillFrequency(onceCardboard, projectedReceipt) === "once-off",
  "an explicit once-off is not rewritten to monthly",
);
const onceWeeks = distributeForecastLine(onceCardboard, 13);
assert(onceWeeks[0] === 31000 && onceWeeks[1] === 0 && onceWeeks[2] === 0, "once-off fills only the start week");
const laterCardboard = applyCashLineSchedule(onceCardboard, { startWeek: 6 });
const laterWeeks = distributeForecastLine(laterCardboard, 13);
assert(laterWeeks[5] === 31000 && laterWeeks[0] === 0, "start week 6 moves the receipt");
assert(applyCashLineSchedule(laterCardboard, { startWeek: 6 }) === laterCardboard, "the same start week does not rewrite the line");

const scrap = {
  id: "scrap",
  name: "Karoo Scrap Metals",
  amount: "9500",
  frequency: "recurring-weekly",
  startWeek: 1,
  splitCount: 1,
};
const scrapLater = applyCashLineSchedule(scrap, { startWeek: 4 });
const scrapWeeks = distributeForecastLine(scrapLater, 13);
assert(scrapWeeks.slice(0, 3).every((value) => value === 0), "a payment waits until its start week");
assert(scrapWeeks.slice(3).every((value) => value === 9500), "a weekly payment fills from the start week");
const scrapMonth = applyCashLineSchedule(scrapLater, { frequency: "recurring-monthly", startWeek: 1 });
const scrapMonthWeeks = distributeForecastLine(scrapMonth, 13);
assert(scrapMonthWeeks[0] === 9500 && scrapMonthWeeks[1] === 0 && scrapMonthWeeks[4] === 9500, "monthly lands on the engine's month weeks");

function cashRow(html: string, key: string): string {
  const start = html.indexOf(`data-cash-row="${key}"`);
  if (start < 0) return "";
  const next = html.indexOf("data-cash-row=", start + 10);
  return html.slice(start, next === -1 ? undefined : next);
}

const weekLabels = Array.from({ length: 13 }, (_, index) => `W${index + 1}`);
const filled = Array.from({ length: 13 }, () => 1000);
const gridMarkup = renderToStaticMarkup(
  createElement(CashThirteenWeekGrid, {
    weeks: weekLabels,
    opening: 412000,
    receipts: [
      {
        id: "cardboard",
        name: "Mpact Recycling (cardboard)",
        vals: filled,
        bucket: "revenue",
        schedule: { frequency: "recurring-weekly", startWeek: 1, splitCount: 1 },
      },
    ],
    payments: [
      {
        id: "scrap",
        name: "Karoo Scrap Metals",
        vals: filled,
        bucket: "expenses",
        schedule: { frequency: "split-weeks", startWeek: 2, splitCount: 4 },
      },
    ],
    inflow: filled,
    outflow: filled,
    net: filled,
    closing: filled,
    floor: 40000,
    symbol: "R",
    format: (value) => `R${value}`,
    onCommit: () => undefined,
    onSchedule: () => undefined,
  }),
);
assert(!/assumption/i.test(gridMarkup), "the 13-week table does not print an assumption chip");
for (const key of ["opening", "total-receipts", "total-payments", "net", "closing", "floor"]) {
  assert(!cashRow(gridMarkup, key).includes("<select"), `${key} has no interval control`);
}
const receiptRow = cashRow(gridMarkup, "cardboard");
const paymentRow = cashRow(gridMarkup, "scrap");
assert(receiptRow.includes('aria-label="Interval for Mpact Recycling (cardboard)"'), "a receipt has an interval");
assert(receiptRow.includes('aria-label="Start week for Mpact Recycling (cardboard)"'), "a receipt has a start week");
assert(receiptRow.includes(">Weekly<") && receiptRow.includes(">Once-off<"), "the receipt lists the engine cadences");
assert(paymentRow.includes('aria-label="Interval for Karoo Scrap Metals"'), "a payment has an interval");
assert(paymentRow.includes('aria-label="Start week for Karoo Scrap Metals"'), "a payment has a start week");
assert(paymentRow.includes('value="2"'), "the payment start week shows week 2");
assert(paymentRow.includes('aria-label="Number of weeks"'), "split weeks keeps the count control");
assert(!/fortnight/i.test(gridMarkup), "the dropdown does not offer fortnightly");

const readOnlyMarkup = renderToStaticMarkup(
  createElement(CashThirteenWeekGrid, {
    weeks: weekLabels,
    opening: 412000,
    receipts: [
      {
        id: "cardboard",
        name: "Mpact Recycling (cardboard)",
        vals: filled,
        bucket: "revenue",
        schedule: { frequency: "recurring-weekly", startWeek: 1, splitCount: 1 },
      },
    ],
    payments: [
      {
        id: "scrap",
        name: "Karoo Scrap Metals",
        vals: filled,
        bucket: "expenses",
        schedule: { frequency: "recurring-monthly", startWeek: 1, splitCount: 1 },
      },
    ],
    inflow: filled,
    outflow: filled,
    net: filled,
    closing: filled,
    floor: 40000,
    symbol: "R",
    format: (value) => `R${value}`,
    readOnly: true,
    onCommit: () => undefined,
  }),
);
assert(!readOnlyMarkup.includes("<select"), "a read-only 13-week table keeps the controls off");
assert(!/assumption/i.test(readOnlyMarkup), "a read-only table also drops the assumption chip");

console.log("cash-forecast-detail-test: all assertions passed");
