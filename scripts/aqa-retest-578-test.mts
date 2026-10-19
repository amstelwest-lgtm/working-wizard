/**
 * AQA retest of #578. One month of rent, staff and subscriptions is assumed
 * monthly. An SA practice plan is the rand ladder. Hotel chat uses template
 * line names. Debt-to-equity uses one title.
 * Run: pnpm test:aqa-retest-578
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionPlanAutomation } from "../src/components/action-plan-automation";
import { adviceChatProductName, adviceChatVolumeUnit } from "../src/lib/advice-industry";
import { displayForecastFrequency, forecastRowLabel } from "../src/lib/cash-forecast-rows";
import { suggestOnceOffRows } from "../src/lib/cash-once-off-suggest";
import { distributeForecastLine, forecastMinimumCash } from "../src/lib/client-metrics";
import { practiceDisplaysZarPlan, saFirmDisplayPrice, saPlanRegionControls } from "../src/lib/firm-band-upgrade";
import { buildFinancialManagerBrief } from "../src/lib/financial-manager-brief";
import { ownerAnswerTiles, type OwnerBooks } from "../src/lib/owner-answers";
import { homeActionNeeds } from "../src/lib/owner-needs";
import { planAnswerSentence } from "../src/lib/plan-pack-copy";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const line = (
  name: string,
  amount: number,
  frequency: "once-off" | "recurring-monthly",
  startWeek: number,
) => ({ name, amount: String(amount), frequency, startWeek });

const hotel = {
  openingBalance: "44480",
  seededFromBanksAt: "2026-08-24T20:07:05.368Z",
  revenue: [
    line("Netcash", 36360, "recurring-monthly", 3),
    line("D Pillay", 900, "once-off", 1),
  ],
  expenses: [
    line("Greeff Properties", 28000, "once-off", 1),
    line("Fuji SA", 9200, "once-off", 1),
    line("R Dlamini", 6000, "once-off", 1),
    line("B Petersen", 4500, "once-off", 1),
    line("Dis-Chem", 392, "once-off", 1),
    line("City of Cape Town", 2947.5, "recurring-monthly", 2),
    line("FNB", 458, "recurring-monthly", 5),
  ],
  other: [line("T Mokoena", 25000, "once-off", 1)],
};

const assumedMonthly: Array<[string, number, "expenses" | "other", string]> = [
  ["Greeff Properties", 28000, "expenses", "rent (assumed monthly)"],
  ["R Dlamini", 6000, "expenses", "payroll (assumed monthly)"],
  ["B Petersen", 4500, "expenses", "payroll (assumed monthly)"],
  ["T Mokoena", 25000, "other", "payroll (assumed monthly)"],
];

for (const [name, amount, side, rule] of assumedMonthly) {
  const frequency = displayForecastFrequency(name, "once-off", { side });
  assert(frequency === "recurring-monthly", `${name} is assumed monthly from one month`);
  const weeks = distributeForecastLine({ amount: String(amount), frequency, startWeek: 1 }, 13);
  assert(weeks[0] === amount && weeks[4] === amount && weeks[8] === amount && weeks[12] === amount, `${name} lands in weeks 1, 5, 9 and 13`);
  assert(weeks[1] === 0 && weeks[2] === 0, `${name} is not copied onto every week`);
  const label = forecastRowLabel(name, "once-off", { side });
  assert(label.includes(rule), `${name} is labelled ${label}`);
}
const fujiWeeks = distributeForecastLine(
  { amount: "9200", frequency: displayForecastFrequency("Fuji SA", "once-off", { side: "expenses" }), startWeek: 1 },
  13,
);
assert(fujiWeeks[0] === 9200 && fujiWeeks.slice(1).every((n) => n === 0), "Fuji stays a one-off purchase");
assert(forecastRowLabel("Fuji SA", "once-off", { side: "expenses" }).includes("purchase (one-off)"), "Fuji is tagged as a purchase");

const guest = distributeForecastLine(
  {
    amount: "900",
    frequency: displayForecastFrequency("D Pillay", "once-off", { side: "revenue" }),
    startWeek: 1,
  },
  13,
);
assert(guest[0] === 900 && guest.slice(1).every((n) => n === 0), "a guest receipt stays in week 1");
assert(
  !forecastRowLabel("City of Cape Town", "recurring-monthly", { side: "expenses" }).includes("assumed"),
  "a stored monthly debit order keeps its own cadence label",
);
assert(
  !forecastRowLabel("Dis-Chem", "once-off", { side: "expenses" }).includes("assumed"),
  "a shop purchase is not assumed monthly",
);

function screenSeries(book: typeof hotel) {
  const weeks = 13;
  const inflow = new Array<number>(weeks).fill(0);
  const outflow = new Array<number>(weeks).fill(0);
  const add = (rows: typeof hotel.revenue, side: "revenue" | "expenses" | "other", target: number[]) => {
    for (const row of rows) {
      const frequency = displayForecastFrequency(row.name, row.frequency, { side });
      distributeForecastLine({ amount: row.amount, frequency, startWeek: row.startWeek }, weeks).forEach((n, i) => {
        target[i] += n;
      });
    }
  };
  add(book.revenue, "revenue", inflow);
  add(book.expenses, "expenses", outflow);
  add(book.other, "other", outflow);
  const closing: number[] = [];
  let bal = Number(book.openingBalance);
  for (let i = 0; i < weeks; i++) {
    bal += inflow[i]! - outflow[i]!;
    closing.push(bal);
  }
  return { outflow, closing };
}

const projected = screenSeries(hotel);
const withoutRent = screenSeries({
  ...hotel,
  expenses: hotel.expenses.map((row) => (row.frequency === "once-off" ? { ...row, name: "Fit-out" } : row)),
  other: hotel.other.map((row) => ({ ...row, name: "Bonus" })),
});
assert(projected.closing[12]! < withoutRent.closing[12]!, "week 13 does not climb by leaving rent and staff out");
assert(withoutRent.closing[12]! - projected.closing[12]! >= 28000, "week 13 still carries the rent");
const floor = forecastMinimumCash({ configured: null, weeklyOutflows: projected.outflow });
const thinFloor = forecastMinimumCash({ configured: null, weeklyOutflows: withoutRent.outflow });
assert(floor > thinFloor, `the floor uses the repeated costs (${floor} vs ${thinFloor})`);
const below = projected.closing.filter((n) => n < floor).length;
const thinBelow = withoutRent.closing.filter((n) => n < thinFloor).length;
assert(below !== thinBelow || floor !== thinFloor, "weeks below the floor are recomputed with the repeated costs");
const lowest = Math.min(...projected.closing);
const lowestWeek = projected.closing.findIndex((n) => n === lowest) + 1;
assert(lowestWeek >= 1 && lowestWeek <= 13, `lowest point is week ${lowestWeek}`);

const staged = suggestOnceOffRows({
  bankDraft: null,
  existing: [],
  bankSourced: true,
  forecastLines: [
    ...assumedMonthly.map(([name, amount, side]) => [name, amount, side] as const).map(([name, amount, side], index) => ({
      id: `a${index}`,
      name,
      amount: String(amount),
      frequency: "once-off",
      startWeek: 1,
      side,
    })),
    { id: "fuji", name: "Fuji SA", amount: "9200", frequency: "once-off", startWeek: 1, side: "expenses" as const },
    { id: "chem", name: "Dis-Chem", amount: "392", frequency: "once-off", startWeek: 1, side: "expenses" as const },
    { id: "guest", name: "D Pillay", amount: "900", frequency: "once-off", startWeek: 1, side: "revenue" as const },
  ],
});
const stagedNames = staged.lines.map((row) => row.name);
for (const [name] of assumedMonthly) {
  assert(!stagedNames.includes(name), `${name} is not offered as a once-off`);
}
assert(
  stagedNames.includes("Dis-Chem") && stagedNames.includes("D Pillay") && stagedNames.includes("Fuji SA"),
  "a purchase and a guest stay available as once-offs until a second month is on file",
);

const usFirm = { country: "US", regionCode: "NY" };
const zaBook = [
  { country: "ZA", regionCode: null },
  { country: "ZA", regionCode: null },
  { country: "ZA", regionCode: null },
  { country: "ZA", regionCode: null },
  { country: "ZA", regionCode: null },
  { country: "ZA", regionCode: null },
  { country: "US", regionCode: "NY" },
  { country: "US", regionCode: "NY" },
  { country: "US", regionCode: "NY" },
];
assert(
  practiceDisplaysZarPlan({ firmMarket: usFirm, clientMarkets: zaBook }),
  "a practice whose clients are mostly in South Africa sees the rand plan",
);
assert(
  !practiceDisplaysZarPlan({
    firmMarket: usFirm,
    clientMarkets: [{ country: "US", regionCode: "NY" }, { country: "US", regionCode: "CA" }],
  }),
  "a United States practice keeps the dollar ladder",
);
const starter = saFirmDisplayPrice("starter", "month");
const solo = saFirmDisplayPrice("solo", "month");
assert(starter.includes("R 299") && !starter.includes("$") && !/vat/i.test(starter), starter);
assert(solo.includes("R 799") && !solo.includes("$") && !/vat/i.test(solo), solo);
const hidden = saPlanRegionControls(true);
assert(hidden.stateDropdown === false && hidden.vatCopy === false, "an SA plan has no state list and no VAT wording");
assert(saPlanRegionControls(false).stateDropdown === true, "a US plan still asks for a state");

const hotelNames = ["product 1", "product 2", "product 3", "product 4"].map((name, index) =>
  adviceChatProductName({
    clientName: "Chill Pepper Boutique Hotel",
    templateId: "day_labour",
    businessType: "service",
    index,
    name,
  }),
);
const chat = hotelNames.join(" ");
assert(/rooms/i.test(chat) && /occupancy/i.test(chat) && chat.includes("ADR"), chat);
assert(!hotelNames.some((name) => /product\s*2/i.test(name)), chat);
const driver = adviceChatVolumeUnit({
  clientName: "Chill Pepper Boutique Hotel",
  templateId: "day_labour",
  businessType: "service",
  volumeUnit: "day_shift",
});
assert(/room-nights/i.test(driver) && driver.includes("ADR") && /occupancy/i.test(driver), driver);
assert(
  adviceChatProductName({
    clientName: "Chill Pepper Boutique Hotel",
    templateId: "day_labour",
    businessType: "service",
    index: 0,
    name: "Spa packages",
  }) === "Spa packages",
  "a named line is kept",
);
const builder = readFileSync("supabase/functions/ask-ai/context-builder.ts", "utf8");
assert(builder.includes("adviceChatProductName") && builder.includes("adviceChatVolumeUnit"), "chat context uses the template names");
assert(!readFileSync("supabase/functions/ask-ai/prompt.ts", "utf8").includes("HOTEL_CHAT_LINES"), "the persona file is unchanged");

const raw = "Target a D/E below 1× for conservative businesses, below 2× for growth";
const summary = planAnswerSentence([
  { title: raw, status: "open" },
  { title: "Collect the overdue invoices", status: "open" },
]);
assert(summary.toLowerCase().includes("bring debt-to-equity under the target"), summary);
assert(!summary.includes("Target a D/E"), summary);
const needs = homeActionNeeds({ known: true, titles: ["Collect the overdue invoices", raw], overdue: 0 });
assert(needs.lines[1] === "Bring debt-to-equity under the target", needs.lines.join(" | "));
assert(!needs.lines.join(" ").includes("Target a D/E"), "What needs you uses the short title");
const ownerBooks: OwnerBooks = {
  hasBooks: false,
  ledger: null,
  revenue: null,
  priorRevenue: null,
  cogs: null,
  receivables: null,
  cashflow: null,
  openAction: raw,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: { currency: "ZAR", locale: "en-ZA" },
};
const ownerAnswer = ownerAnswerTiles(ownerBooks).find((tile) => tile.id === "answer");
assert(ownerAnswer?.sentence === "Bring debt-to-equity under the target", ownerAnswer?.sentence ?? "");
const brief = buildFinancialManagerBrief({
  clientName: "Chill Pepper Boutique Hotel",
  currentFinancials: null,
  openActionTitles: [raw],
  actionsReady: true,
  formatMoney: (amount) => `R${amount}`,
});
assert(brief.actions[0]?.title === "Bring debt-to-equity under the target", brief.actions[0]?.title ?? "");
const suggested = renderToStaticMarkup(
  createElement(ActionPlanAutomation, {
    rows: [
      {
        id: "de",
        title: raw,
        owner: { kind: "bot", id: "financial_manager", name: "Financial Manager" },
        ownerSuggested: true,
        dueDate: "2026-11-02",
        dueSuggested: true,
        followUp: "none",
        overdue: false,
      },
    ],
    duplicates: [],
    contradictions: [],
    canEdit: false,
    onConfirm: () => undefined,
    onDrop: () => undefined,
  }),
);
assert(suggested.includes("Bring debt-to-equity under the target"), "the suggested row uses the short title");
assert(!suggested.includes("Target a D/E"), "the suggested row drops the old guidance sentence");

console.log("aqa-retest-578 ok");
