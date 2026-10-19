/**
 * Final accountant walk: recurring bank payees, hotel seed, hotel budget,
 * action-plan coherence, and the smaller display fixes.
 * Run: pnpm test:final-walk-industry
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CashBankExtract, CashStatementTransaction } from "../src/lib/cash-from-banks.types.ts";
import { distributeForecastLine } from "../src/lib/client-metrics.ts";
import {
  projectForecastFrequency,
  recurringPayeeFrequency,
} from "../src/lib/cash-recurring-payees.ts";
import { suggestOnceOffRows } from "../src/lib/cash-once-off-suggest.ts";
import {
  budgetPriceLabel,
  hotelTemplateRows,
  serviceDriverName,
} from "../src/lib/budget-industry.ts";
import { budgetYtdWithStatement } from "../src/lib/budget-chart-table.ts";
import {
  actionDisplayTitle,
  planGoalIsOverdue,
  rankStrategicMoves,
  stockSittingApplies,
} from "../src/lib/strategic-moves.ts";
import { interventionStepsFromActions } from "../src/lib/intervention-grounding.ts";
import { todayAttentionAction } from "../src/lib/portfolio-dashboard.ts";
import { describeBusiness } from "../src/lib/client-briefing.ts";
import { clientIndustryDisplay } from "../src/lib/profile-signals.ts";
import { adviceIndustryLabel } from "../src/lib/advice-industry.ts";
import { saFirmDisplayPrice } from "../src/lib/firm-band-upgrade.ts";
import type { ClientOperatingProfile } from "../src/lib/client-profile.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

function sqlStatements(sql: string): string {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function txn(
  date: string,
  amount: number,
  counterparty: string,
  bucket: CashStatementTransaction["ai_bucket"],
  direction: CashStatementTransaction["direction"],
): CashStatementTransaction {
  return {
    txn_date: date,
    amount,
    direction,
    description: counterparty,
    counterparty,
    ai_bucket: bucket,
    excluded: false,
  };
}

const extract: CashBankExtract = {
  period_start: "2026-05-01",
  period_end: "2026-07-01",
  opening_balance: null,
  closing_balance: null,
  currency: "ZAR",
  notes: null,
  transactions: [
    txn("2026-05-01", 28000, "Greeff Properties", "rent", "out"),
    txn("2026-07-01", 28000, "Greeff Properties", "rent", "out"),
    txn("2026-05-01", 25000, "T Mokoena", "payroll", "out"),
    txn("2026-07-01", 25000, "T Mokoena", "payroll", "out"),
    txn("2026-05-01", 6000, "R Dlamini", "payroll", "out"),
    txn("2026-07-01", 6000, "R Dlamini", "payroll", "out"),
    txn("2026-05-01", 4500, "B Petersen", "payroll", "out"),
    txn("2026-07-01", 4500, "B Petersen", "payroll", "out"),
    txn("2026-05-01", 458, "FNB", "opex", "out"),
    txn("2026-07-01", 458, "FNB", "opex", "out"),
    txn("2026-05-12", 16800, "Andre Galvao Seminar", "trading", "in"),
  ],
};

const bankDraft = { lines: [], extract };
const recurring = recurringPayeeFrequency(bankDraft);
const stored = [
  ["Greeff Properties", "28000"],
  ["T Mokoena", "25000"],
  ["R Dlamini", "6000"],
  ["B Petersen", "4500"],
  ["FNB", "458"],
] as const;

for (const [name, amount] of stored) {
  const frequency = projectForecastFrequency(name, "once-off", recurring);
  assert(frequency === "recurring-monthly", `${name} projects monthly from two history hits`);
  const weeks = distributeForecastLine({ amount, frequency, startWeek: 1 }, 13);
  assert(weeks[0] === Number(amount) && weeks[4] === Number(amount), `${name} lands in week 1 and week 5`);
  assert(weeks[9] === Number(amount) && weeks[12] === 0, `${name} lands a third time and not in week 13`);
  assert(weeks[1] === 0 && weeks[2] === 0, `${name} is not repeated every week`);
}

const lone = projectForecastFrequency("Greeff Properties", "once-off", null, { side: "expenses" });
assert(lone === "recurring-monthly", "rent is assumed monthly from one month");
const loneWeeks = distributeForecastLine({ amount: "28000", frequency: lone, startWeek: 1 }, 13);
assert(loneWeeks[0] === 28000 && loneWeeks[4] === 28000 && loneWeeks[9] === 28000 && loneWeeks[12] === 0, "assumed rent lands three times");
const stranger = projectForecastFrequency("Dis-Chem", "once-off", null, { side: "expenses" });
assert(stranger === "once-off", "a single non-recurring purchase stays in its week");

const suggested = suggestOnceOffRows({
  bankDraft,
  existing: [],
  bankSourced: true,
  forecastLines: [
    ...stored.map(([name, amount], index) => ({
      id: `grid-${index}`,
      name,
      amount,
      frequency: "once-off",
      startWeek: 1,
      side: "expenses" as const,
    })),
    {
      id: "grid-seminar",
      name: "Andre Galvao Seminar",
      amount: "16800",
      frequency: "once-off",
      startWeek: 1,
      side: "revenue" as const,
    },
  ],
});
const suggestedNames = suggested.lines.map((line) => line.name.toLowerCase());
for (const [name] of stored) {
  assert(!suggestedNames.some((row) => row.includes(name.toLowerCase().split(" ").pop()!)), `${name} stays out of once-offs`);
}
assert(suggestedNames.some((row) => row.includes("galvao")), "a one-hit seminar receipt is still a once-off");
const emptyHistory = suggestOnceOffRows({
  bankDraft: null,
  existing: [],
  bankSourced: true,
  forecastLines: [
    { id: "w1", name: "Greeff Properties", amount: "28000", frequency: "once-off", startWeek: 1, side: "expenses" },
    { id: "w2", name: "Dis-Chem", amount: "392", frequency: "once-off", startWeek: 1, side: "expenses" },
  ],
});
assert(!emptyHistory.lines.some((line) => line.name === "Greeff Properties"), "assumed rent is not staged as a once-off");
assert(emptyHistory.lines.some((line) => line.name === "Dis-Chem"), "a one-off with no monthly keyword is still staged");
assert(!read("src/lib/cash-recurring-payees.ts").includes("last_forecast_at"), "projection does not move the forecast stamp");

const seed = read("scripts/seed-chill-pepper-hotel.sql");
assert(seed.includes("Chill Pepper Boutique Hotel"), "the seed names the hotel");
assert(seed.includes("79c4c485-9fa7-4499-9139-e1bb7cb40649"), "the seed targets the hotel client");
assert(/seminar\|instructor/i.test(seed), "the seed drops seminar and instructor lines");
assert(!/\binsert\b/i.test(sqlStatements(seed)), "the seed does not insert a new amount");
for (const file of readdirSync(resolve("scripts")).filter((name) => name.endsWith(".sql"))) {
  const sql = sqlStatements(read(`scripts/${file}`));
  const pairsHotelWithSeminar =
    /hotel/i.test(sql) && /andre galvao|guest instructor/i.test(sql) && /\binsert\b/i.test(sql);
  assert(!pairsHotelWithSeminar, `${file} does not insert a hotel with seminar lines`);
}

const hotelRows = hotelTemplateRows("hospitality_rooms");
assert(hotelRows != null, "the hotel template has rows");
const hotelText = hotelRows!.map((row) => `${row.name} ${row.detail} ${row.value}`).join(" | ");
for (const phrase of ["Room-nights", "ADR", "Occupancy", "Food & beverage", "Housekeeping and staff", "Rent", "—"]) {
  assert(hotelText.includes(phrase), `hotel template includes ${phrase}`);
}
assert(hotelRows!.some((row) => row.value === "Occupancy —"), "occupancy without a stored figure stays blank");
assert(serviceDriverName("Day / shift labour") && serviceDriverName("Billable work") && serviceDriverName("Jobs / call-outs"), "service driver names are hidden on a hotel");
assert(budgetPriceLabel("day_labour", "hospitality_rooms", "Day rate") === "ADR", "a hotel price reads ADR");
const ytd = budgetYtdWithStatement(
  { budget: 1000, actual: null },
  { chip: "Statement", revenue: 48000, budgetRevenue: 50000 },
);
assert(ytd.actual === null && ytd.budget === 1000, "a statement total does not become the YTD actual");
const simple = read("src/components/budget/budget-simple-view.tsx");
const workspace = read("src/components/budget/budget-workspace.tsx");
assert(simple.includes("Budget-year") && simple.includes("not the 13-week"), "the simple view labels the budget-year trough");
assert(workspace.includes("Budget-year") && workspace.includes("not the 13-week"), "the workspace labels the budget-year trough");

assert(
  actionDisplayTitle("Target a D/E below 1× for conservative businesses, below 2× for growth") ===
    "Bring debt-to-equity under the target",
  "the raw debt guidance becomes the action title",
);
assert(actionDisplayTitle("review the karoo lease") === "Review the karoo lease", "a lowercase title is sentence-cased");
const quick = rankStrategicMoves({ debtorDays: 6, limit: 40 });
assert(
  quick.every((move) => !/pay faster/i.test(move.title) && move.actions.every((action) => !/pay faster/i.test(action))),
  "debtor days of 6 do not suggest paying faster",
);
const slow = rankStrategicMoves({ debtorDays: 40, limit: 40 });
assert(slow.some((move) => /pay faster/i.test(move.title)), "slower debtors can still say pay faster");
assert(stockSittingApplies({ inventoryIntensity: "none" }) === false, "no inventory drops stock sitting time");
assert(stockSittingApplies({ templateId: "hospitality_rooms" }) === false, "a hotel drops stock sitting time");
assert(stockSittingApplies({ templateId: "day_labour" }) === false, "a services kit drops stock sitting time");
assert(
  stockSittingApplies({ inventoryIntensity: "high", templateId: "hospitality_covers" }) === true,
  "a restaurant keeps stock sitting time",
);
const leverage = rankStrategicMoves({
  healthByKey: { equityMultiplier: 0 },
  financingHealth: 60,
  entries: [{ key: "equityMultiplier", title: "Leverage", ratioName: "Leverage Level", icon: "", actions: ["Leverage"], impact: 7 }],
});
assert(leverage[0]?.health === 60, "Leverage Level uses the financing pillar score");
assert(planGoalIsOverdue("Not set", "2020-01-01", "2026-10-19") === false, "an unset goal is not overdue");
assert(planGoalIsOverdue("Lift the cash floor", "2020-01-01", "2026-10-19") === true, "a real goal with a past date is overdue");
const steps = interventionStepsFromActions(["One", "Two", "Three", "Four", "Five", "One"]);
assert(steps.length === 4 && steps[0] === "One" && steps[3] === "Four", "the intervention plan is the first four open actions");

assert(
  todayAttentionAction({ tab: "plan", openPlan: true, overdue: false }) === "Open →",
  "an open plan without an overdue action opens",
);
assert(
  todayAttentionAction({ tab: "plan", openPlan: true, overdue: true }) === "Chase →",
  "an overdue plan action is the chase",
);
const exceptions = read("src/components/portfolio-exceptions.tsx");
assert(exceptions.includes('row.tab === "plan" && row.overdue'), "the attention strip chases only overdue work");
const labourHotel = { templateId: "day_labour", businessTypeId: "hospitality" } as ClientOperatingProfile;
assert(
  clientIndustryDisplay("Seaside Stay", labourHotel, "hospitality") === "Hospitality",
  "a hospitality business is not labelled as labour",
);
const about = describeBusiness(labourHotel, "hospitality", null, {
  name: "Seaside Stay",
  businessType: "hospitality",
});
assert(about != null && /business focused on /.test(about), `about keeps the sentence shape: ${about}`);
assert(about != null && !/labour/i.test(about), `about does not say labour: ${about}`);
assert(
  adviceIndustryLabel({ clientName: "Chill Pepper Boutique Hotel", templateId: "day_labour", businessType: "service" }) ===
    "Hotels & accommodation",
  "advice uses the hotel industry, not the labour template id",
);
const starter = saFirmDisplayPrice("starter", "month");
assert(starter.includes("R299") && !starter.includes("$") && !/vat/i.test(starter), `SA starter is rand: ${starter}`);
const vatStripped = saFirmDisplayPrice("starter", "month", "$39/mo excl. VAT");
assert(vatStripped.includes("R299") && !vatStripped.includes("$") && !/vat/i.test(vatStripped), "a dollar SA fallback is the published rand price");
const css = read("src/styles/accountant-portal.css");
assert(css.includes("max-width:420px") && css.includes("padding-bottom"), "the narrow practice page clears the share button");
const context = read("supabase/functions/ask-ai/context-builder.ts");
assert(context.includes("adviceIndustryLabel"), "advice context uses the client's industry");
const sphere = read("src/components/sphere-hero.tsx");
assert(!sphere.includes("These are the first three"), "an empty potential impact block is not shown");
assert(sphere.includes("See all recommended moves"), "the recommended-moves button stays");
assert(sphere.includes('d.na ? "N/A"'), "a no-stock driver reads N/A");

console.log("final-walk-industry ok");
