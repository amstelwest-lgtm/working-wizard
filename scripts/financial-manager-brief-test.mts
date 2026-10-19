/**
 * Client Home brief uses stored months and stored amounts only.
 * Run: pnpm test:financial-manager-brief
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatMoney } from "../src/lib/market/format";
import { ZA_MARKET } from "../src/lib/market";
import {
  buildFinancialManagerBrief,
  previousMonthSnapshot,
  topMoneyMovements,
} from "../src/lib/financial-manager-brief";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const money = (amount: number) => formatMoney(amount, ZA_MARKET);

const current = {
  periodEnd: "2026-03-31",
  revenue: 120000,
  cash: 40000,
  netIncome: 8000,
  receivables: 15000,
  payables: 4000,
  fixedCosts: 30000,
};
const lastMonth = {
  periodEnd: "2026-02-28",
  revenue: 100000,
  cash: 55000,
  netIncome: 8000,
  receivables: 9000,
  payables: 4000,
  fixedCosts: 22000,
};

const snapshots = [
  {
    periodDate: "2025-03-31",
    periodLabel: "March 2025",
    financials: { revenue: 1, cash: 1 },
  },
  {
    periodDate: "2026-02-28",
    periodLabel: "February 2026",
    financials: lastMonth,
  },
];

const prior = previousMonthSnapshot(snapshots, { periodEnd: "2026-03-31", financials: current });
assert(prior?.periodLabel === "February 2026", "last month is February, not the year-ago snapshot");

const moves = topMoneyMovements(current, lastMonth);
assert(moves.length === 3, `top 3 movements, got ${moves.length}`);
assert(moves[0]?.key === "revenue", "largest move is revenue");
assert(moves[0]?.delta === 20000, "revenue delta is the stored difference");
assert(!moves.some((row) => row.key === "netIncome"), "an unchanged figure is not a movement");

const brief = buildFinancialManagerBrief({
  clientName: "Chill Pepper",
  currentFinancials: current,
  currentPeriodEnd: "2026-03-31",
  snapshots,
  openActionTitle: "Chase the March invoices",
  overdueActions: 2,
  cashDipWeek: 6,
  cashOpening: 40000,
  cashFloor: 55000,
  receivables: 15000,
  drafts: [{ id: "d1", title: "Advisory note" }],
  formatMoney: money,
});
assert(brief.movements.length === 3, "brief keeps three movements");
assert(brief.actions.map((row) => row.button).join(",") === "hand,chase,open", brief.actions.map((a) => a.button).join(","));
assert(brief.chase?.actions[0]?.title === "Chase the outstanding balance", "chase uses the shared draft input");
assert(brief.chase?.actions[0]?.overdue === true, "overdue actions mark the shared chase draft");
assert(brief.drafts[0]?.title === "Advisory note", "draft title is the stored title");
assert(
  brief.cashFloorLine ===
    `Cash ${money(40000)}, ${money(15000)} below your ${money(55000)} minimum.`,
  brief.cashFloorLine ?? "missing cash floor line",
);
assert(brief.cashFloorChip === "Below your minimum", "the brief uses the owner floor chip");
const dip = buildFinancialManagerBrief({
  clientName: "Chill Pepper",
  currentFinancials: { ...current, cash: 44480 },
  currentPeriodEnd: "2026-03-31",
  snapshots,
  cashDipWeek: 4,
  cashOpening: 44480,
  cashFloor: 32688,
  cashClosing: [30000],
  market: ZA_MARKET,
  formatMoney: money,
});
assert(
  dip.cashFloorLine ===
    `Cash ${money(30000)}, ${money(2688)} below your ${money(32688)} minimum.`,
  dip.cashFloorLine ?? "missing dip line",
);
assert(dip.cashFloorChip === "Below your minimum", "a projected dip keeps the same chip");
assert(
  dip.healthCue?.includes("minimum · see FM") === true,
  dip.healthCue ?? "the brief and the health pillar share the floor line",
);
const watchPillar = buildFinancialManagerBrief({
  clientName: "Harbour",
  currentFinancials: current,
  currentPeriodEnd: "2026-03-31",
  snapshots,
  cashOpening: 4335,
  cashFloor: 50000,
  cashClosing: [4335],
  cashPillarStatus: "at_risk",
  market: { currency: "USD", locale: "en-US" },
  formatMoney: (amount) => `$${amount}`,
});
assert(watchPillar.cashFloorLine === "Cash is $4335.", watchPillar.cashFloorLine ?? "missing watch line");
assert(watchPillar.cashFloorChip == null, "Watch keeps the floor chip off the card");
assert(
  watchPillar.healthCue === "Below your $50k minimum · see FM",
  watchPillar.healthCue ?? "Watch still lines the Health cash pillar",
);
assert(
  brief.actions.find((row) => row.id === "cash-floor")?.reason === brief.cashFloorLine,
  "the cash-floor action quotes the same amounts",
);
const missingOpening = buildFinancialManagerBrief({
  clientName: "Karoo",
  currentFinancials: current,
  currentPeriodEnd: "2026-03-31",
  snapshots,
  cashDipWeek: 1,
  cashOpening: 0,
  cashFloor: 55000,
  openingMissing: true,
  formatMoney: money,
});
assert(
  missingOpening.cashFloorLine === "Opening balance missing.",
  missingOpening.cashFloorLine ?? "missing opening line",
);
assert(
  !missingOpening.actions.some((row) => row.id === "cash-floor"),
  "a missing opening is not a floor breach",
);

const empty = buildFinancialManagerBrief({
  clientName: "Chill Pepper",
  currentFinancials: current,
  currentPeriodEnd: "2026-03-31",
  snapshots: [],
  actionsReady: true,
  draftsReady: true,
  formatMoney: money,
});
assert(empty.movements.length === 0, "no last month means no movements");
assert(empty.movementEmpty === "No last-month figures are on file.", empty.movementEmpty ?? "");
assert(empty.actions.length === 0, "no stored work means no actions");
assert(empty.chase == null, "no balance and no overdue means no chase draft");
assert(empty.draftEmpty === "No draft is waiting for review.", empty.draftEmpty ?? "");

const src = readFileSync(resolve("src/components/financial-manager-brief.tsx"), "utf8");
assert(src.includes("Hand to bot"), "hand button");
assert(src.includes("Draft chase"), "chase button");
assert(src.includes("Open"), "open button");
assert(src.includes("ChaseDraftDialog"), "Draft chase opens the shared chase draft");
assert(!src.includes("textarea"), "the brief does not keep a second chase draft");
assert(!/supabase|sendEmail|mailto/i.test(src), "the brief does not send");

const page = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(page.includes("<FinancialManagerBrief"), "client Home renders the brief");

console.log("financial-manager-brief ok");
