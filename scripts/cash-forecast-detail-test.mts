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

const cashSrc = readFileSync(resolve("src/components/cash-forecast.tsx"), "utf8");
assert(cashSrc.includes("Detailed cashflow forecast"), "section title");
assert(cashSrc.includes("Double-click a figure to edit"), "edit affordance in the subtitle");
assert(cashSrc.includes("milon-forecast-amount"), "hover underline hint without restyle");
assert(cashSrc.includes("applyWeekOverrides"), "grid uses persisted week overrides");
assert(cashSrc.includes("{symbol}"), "currency symbol stays while editing");

const studio = readFileSync(
  resolve("src/routes/_authenticated/clients.$clientId.tsx"),
  "utf8",
);
assert(studio.includes('activeTab === "cash"'), "cash tab hides simple/complex");
assert(!studio.includes('id="wizard-profit-walk" style={{ colorScheme: "dark" }}'), "no dark island");

const wf = readFileSync(resolve("src/components/profitability-waterfall.tsx"), "utf8");
assert(wf.includes("text-[#0f172a]"), "waterfall values use ink that survives light-mode overrides");
assert(wf.includes("bg-[#fffdf8]/90"), "value labels sit on a readable chip");

console.log("cash-forecast-detail-test: all assertions passed");
