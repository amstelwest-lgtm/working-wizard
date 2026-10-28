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
import { proratedPeriodLabel } from "../supabase/functions/_shared/firm-year-label.ts";

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
assert(brief.actions.map((row) => row.button).join(",") === "hand,chase", brief.actions.map((a) => a.button).join(","));
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
  dip.healthCue?.includes("minimum · Financial Manager") === true,
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
const runwayStrain = buildFinancialManagerBrief({
  clientName: "Yankees",
  currentFinancials: current,
  currentPeriodEnd: "2026-03-31",
  snapshots,
  cashOpening: 7430,
  cashFloor: 5661,
  cashClosing: [7430],
  cashPillarStatus: "critical",
  cashStrainLine: "Cash runway is 2 weeks.",
  market: { currency: "USD", locale: "en-US" },
  formatMoney: (amount) => `$${amount}`,
});
assert(runwayStrain.cashFloorLine === "Cash runway is 2 weeks.", runwayStrain.cashFloorLine ?? "missing runway line");
assert(runwayStrain.cashFloorChip === "Critical", "a named runway stays Critical on the brief");
const criticalAbove = buildFinancialManagerBrief({
  clientName: "Yankees",
  currentFinancials: current,
  currentPeriodEnd: "2026-03-31",
  snapshots,
  cashOpening: 7430,
  cashFloor: 5661,
  cashClosing: [7430],
  cashPillarStatus: "critical",
  market: { currency: "USD", locale: "en-US" },
  formatMoney: (amount) => `$${amount}`,
});
assert(
  criticalAbove.cashFloorLine === "Cash is $7430, above the $5661 floor.",
  criticalAbove.cashFloorLine ?? "missing above-floor line",
);
assert(criticalAbove.cashFloorChip == null, "critical with no other reason does not chip the brief");
assert(
  watchPillar.healthCue === "Below your $50k minimum · Financial Manager",
  watchPillar.healthCue ?? "Watch still lines the Health cash pillar",
);
assert(
  !brief.actions.some((row) => row.id === "cash-floor"),
  "a dip week without forecast lines is not a forecast already on file",
);
const withLines = buildFinancialManagerBrief({
  clientName: "Chill Pepper",
  currentFinancials: current,
  currentPeriodEnd: "2026-03-31",
  snapshots,
  cashDipWeek: 6,
  cashOpening: 40000,
  cashFloor: 55000,
  cashflow: {
    openingBalance: "40000",
    revenue: [{ amount: "10000", frequency: "once", startWeek: 1 }],
    expenses: [{ amount: "80000", frequency: "once", startWeek: 6 }],
  },
  formatMoney: money,
});
assert(
  withLines.actions.some((row) => row.id === "cash-floor"),
  "real forecast lines can still raise the floor banner",
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
const briefCss = readFileSync(resolve("src/components/financial-manager-brief.css"), "utf8");
assert(briefCss.includes(".home-attn__detail"), "the reason line has its own muted style");
assert(briefCss.includes(".hand-to-assignee"), "the assignee name on the button stays readable");
assert(src.includes("<HandToMenu"), "Needs attention hands off through the shared menu");
assert(src.includes("commitActionHandoff"), "Hand to writes the assignment");
assert(src.includes("toast.success"), "an accountant assign toasts");
assert(!src.includes("<AssignmentNotes"), "Needs attention does not repeat the hand-off notes");
assert(src.includes("HandoffRunStatus"), "Needs attention shows Working and the slow retry");
assert(src.includes("showTimeline={false}"), "the run step list stays off Home");
assert(!src.includes("What changed"), "Home drops the movement paragraph");
const runStatus = readFileSync(resolve("src/components/handoff-run-status.tsx"), "utf8");
assert(runStatus.includes("data-agent-pickup"), "a finished run names itself on the row");
assert(runStatus.includes("Taking longer than usual ·"), "a slow run offers retry");
assert(!src.includes("onHandToBot"), "Hand to does not navigate to the Financial Manager");
assert(src.includes("Draft chase"), "chase button");
assert(src.includes("Open"), "open button");
assert(src.includes("ChaseDraftDialog"), "Draft chase opens the shared chase draft");
assert(!src.includes("textarea"), "the brief does not keep a second chase draft");
assert(!/supabase|sendEmail|mailto/i.test(src), "the brief does not send");

const page = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(page.includes("<FinancialManagerBrief"), "client Home renders the brief");
const homePane = page.slice(page.indexOf('id="pane-overview"'), page.indexOf('id="pane-summary"'));
assert(
  homePane.indexOf("<OwnerHome") >= 0 && homePane.indexOf("<OwnerHome") < homePane.indexOf("<ClientHomePaged"),
  "the team cards come before the Home menu",
);
assert(!homePane.includes("needs={homeNeeds}"), "accountant Home drops the What needs you strip");
assert(homePane.includes("attention: (") && homePane.includes("progress: (") && homePane.includes("books: ("), "three panes");
assert(page.includes("handoffs={shownHandoffs}"), "Act on these uses the open action rows");
assert(page.includes("openPlanHandoffs.map"), "the shown rows start from the stored actions");
assert(
  !page.includes('onHandToBot={() => openHomeAgent("financial_manager")}'),
  "the home hand control does not open the Financial Manager page",
);

const proRata = proratedPeriodLabel(
  ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
  ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
);
assert(proRata != null, "the edge helper names the clipped period");
const clippedPeriod = {
  label: proRata,
  prorated: true,
  months: 7,
  revenue: 1,
  cogs: null,
  grossProfit: null,
  operatingExpenses: null,
  operatingProfit: null,
  netProfit: null,
};
const labelled = topMoneyMovements(current, lastMonth, 3, clippedPeriod);
assert(!labelled.some((row) => row.key === "netIncome"), "a pro-rated period still drops net profit");
const flowLabels: Record<string, string> = {
  revenue: "Revenue",
  fixedCosts: "Fixed costs",
  cash: "Cash",
};
for (const key of ["revenue", "fixedCosts", "cash"] as const) {
  const row = labelled.find((item) => item.key === key);
  assert(row?.label === `${flowLabels[key]} (${proRata})`, `${key} label ${row?.label}`);
}
const uncaptioned = topMoneyMovements(current, lastMonth, 3, { ...clippedPeriod, label: "Mar 2026 – Sep 2026" });
assert(
  !uncaptioned.some((row) => row.key === "revenue" || row.key === "fixedCosts" || row.key === "cash"),
  "a clipped period without the pro-rata caption drops the raw flow rows",
);

console.log("financial-manager-brief ok");
