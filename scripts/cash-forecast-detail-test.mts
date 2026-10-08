/**
 * Detailed cashflow forecast — week overrides + accountant chrome.
 * Run: pnpm test:cash-forecast-detail
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyWeekOverrides,
  parseEditableAmount,
  setWeekOverride,
} from "../src/lib/cash-week-overrides";
import { figureSourceChipLabel } from "../src/lib/ledger-link-copy";
import {
  cashForecastSearchWithView,
  cashForecastViewFromSearch,
  cashGraphWeekTickInterval,
  forecastChipSource,
  hashIsCashDetailAnchor,
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
assert(cashSrc.includes("cashGraphWeekTickInterval"), "the graph thins week ticks from the frame width");
assert(cashSrc.includes("<ViewToggle"), "graph and 13-week share one toggle");
assert(cashSrc.includes('value: "13week"'), "13-week is a view value");
assert(cashSrc.includes("detailed-forecast"), "old detailed-forecast anchor still resolves");
assert(cashSrc.includes("hashIsCashDetailAnchor"), "anchor hashes redirect onto the card");
assert(cashSrc.includes("const startLabel = weeks[0]"), "forecast start uses the week-axis label");
assert(!cashSrc.includes("`Start ${startDate}`"), "opening stat does not print the raw ISO start");
assert(!cashSrc.includes("`Forecast starts ${startDate}"), "PDF assumption does not print the raw ISO start");

const studio = readFileSync(
  resolve("src/routes/_authenticated/clients.$clientId.tsx"),
  "utf8",
);
assert(studio.includes('activeTab === "cash"'), "cash tab hides simple/complex");
assert(!studio.includes('id="wizard-profit-walk" style={{ colorScheme: "dark" }}'), "no dark island");

const wf = readFileSync(resolve("src/components/profitability-waterfall.tsx"), "utf8");
assert(wf.includes("text-[#0f172a]"), "waterfall values use ink that survives light-mode overrides");
assert(wf.includes("bg-[#fffdf8]/90"), "value labels sit on a readable chip");
assert(wf.includes("profitStepBand"), "waterfall chips use the shared score band");
assert(!wf.includes('"AT RISK"'), "waterfall does not keep a private AT RISK label");

console.log("cash-forecast-detail-test: all assertions passed");
