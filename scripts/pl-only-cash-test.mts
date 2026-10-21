/**
 * A P&L with no balance sheet does not invent cash of $0 or a minimum.
 * Run: pnpm test:pl-only-cash
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerHome } from "../src/components/owner-door/owner-home.tsx";
import { emptyAgentActivity } from "../src/lib/milon-team-activity.ts";
import { ownerPresence } from "../src/lib/owner-presence.ts";
import { buildFinancialManagerBrief } from "../src/lib/financial-manager-brief.ts";
import { buildSpherePillars } from "../src/components/sphere-hero-adapter.ts";
import { sphereDriverAsideText } from "../src/components/sphere-hero.tsx";
import { cashDriverDayFigures } from "../src/lib/cash-driver-label.ts";
import {
  HEALTH_MISSING_MARK,
  HEALTH_NOT_ENOUGH_DATA,
  healthDayRowPresentation,
} from "../src/lib/health-metric-row.ts";
import {
  cashPillarFollowsForecast,
  healthMapFromRatios,
  liveHealthFromBooks,
  overviewRatios,
  scoreAndBand,
  scorecardHealthFromFinancials,
} from "../src/lib/health-score.ts";
import { localizeCopy } from "../src/lib/market/copy.ts";
import {
  needsTrialBalanceRefresh,
  TRIAL_BALANCE_REFRESH_COPY,
} from "../src/lib/trial-balance-refresh.ts";
import { assessClientMetrics } from "../src/lib/client-metrics.ts";
import { clientListStatusWord } from "../src/lib/cash-forecast-parity.ts";
import {
  CASH_NOT_ON_FILE,
  ownerAnswerTiles,
  ownerCardStatuses,
  ownerHomeLines,
  type OwnerBooks,
} from "../src/lib/owner-answers.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const us = {
  currency: "USD" as const,
  locale: "en-US",
  country: "US" as const,
  copyPack: "us" as const,
};

const plOnly = {
  revenue: "412000",
  cogs: "120000",
  ebit: "180000",
  netIncome: "150000",
  periodMonths: "12",
};

const assessed = assessClientMetrics({ financials: plOnly, cashflow: null });
assert(assessed.cash.amount == null, "P&L revenue is not a cash balance");
assert(assessed.outlook.cashOnFile === false, "the forecast marks cash as missing");
assert(
  assessed.outlook.floor === 0,
  `the minimum was derived from missing cash (${assessed.outlook.floor})`,
);
assert(assessed.outlook.dipsBelowFloorWeek == null, "a missing balance does not dip under a floor");
assert(assessed.outlook.totalOutflow > 0, "nine-plus months of costs seed weekly payments");
assert(assessed.outlook.openingCash === null, "a missing balance is not stored as zero");
assert(
  assessed.outlook.openingNote === "Opening cash unknown",
  assessed.outlook.openingNote ?? "missing note",
);
assert(
  assessed.outlook.closing.every((n) => n === 0),
  "closings are not rolled from a missing opening",
);
assert(assessed.outlook.seededFromActuals === true, "the P&L actuals still seed the weeks");

const books = {
  hasBooks: true,
  ledger: null,
  revenue: 412000,
  priorRevenue: null,
  cogs: 120000,
  receivables: null,
  cashflow: null,
  hasEvidence: true,
  cashOnFile: false,
  openingMissing: false,
  cashOutlook: null,
  cashPillarStatus: null,
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: us,
} satisfies OwnerBooks;

const cashSentence = ownerAnswerTiles(books).find((tile) => tile.id === "cash")?.sentence ?? "";
assert(cashSentence === CASH_NOT_ON_FILE, cashSentence);
assert(cashSentence === "Cash not on file yet, upload a balance sheet.", cashSentence);
assert(!/\$0|Critical|below your minimum/i.test(cashSentence), cashSentence);

const status = ownerCardStatuses(books);
assert(status.financial_manager == null, status.financial_manager?.word ?? "chip should be absent");
const lines = ownerHomeLines(ownerAnswerTiles(books), null);
assert(lines.financial_manager[0] === CASH_NOT_ON_FILE, lines.financial_manager.join(" | "));
assert(
  !lines.financial_manager.some((line) => /\$0|Critical|below your/i.test(line)),
  lines.financial_manager.join(" | "),
);

const health = cashPillarFollowsForecast(
  scorecardHealthFromFinancials({
    financials: plOnly,
    cashBalance: null,
    cashRunwayWeeks: null,
    market: us,
  }),
  {
    hasEvidence: true,
    cashOnFile: false,
    opening: assessed.outlook.opening,
    closings: assessed.outlook.closing,
    floor: assessed.outlook.floor,
  },
);
const cashPillar = health.pillars.find((pillar) => pillar.id === "cash");
assert(cashPillar?.score == null, `cash pillar was scored (${cashPillar?.score})`);
assert(
  !health.pillars.some((pillar) => pillar.id === "cash" && pillar.score != null),
  "cash with no data is not in the score",
);

const live = liveHealthFromBooks({
  financials: plOnly,
  cashflow: null,
  market: us,
});
const liveCash = live.pillars.find((pillar) => pillar.id === "cash");
assert(liveCash?.score == null, `liveHealthFromBooks scored missing cash (${liveCash?.score})`);
assert(live.displayLabel !== "Critical", live.displayLabel);
assert(live.hasCriticalPillar === false, "a missing cash line is not a critical pillar");
const statusWord = clientListStatusWord({
  healthLabel: health.displayLabel,
  healthOverall: health.overall,
  source: assessed.outlook.source,
  opening: assessed.outlook.opening,
  floor: assessed.outlook.floor,
  dipsBelowFloorWeek: assessed.outlook.dipsBelowFloorWeek,
  totalInflow: assessed.outlook.totalInflow,
  totalOutflow: assessed.outlook.totalOutflow,
  cashOnFile: false,
});
assert(!statusWord.startsWith("Critical"), statusWord);

const brief = buildFinancialManagerBrief({
  clientName: "AQA Gate Throwaway 1020B",
  currentFinancials: plOnly,
  snapshots: [],
  cashOpening: 0,
  cashFloor: 36923,
  cashClosing: assessed.outlook.closing,
  cashDipWeek: 1,
  market: us,
  openingMissing: false,
  cashOnFile: false,
  actionsReady: true,
  draftsReady: true,
  formatMoney: (amount) => `$${amount}`,
});
assert(brief.cashFloorLine === CASH_NOT_ON_FILE, brief.cashFloorLine ?? "missing cash line");
assert(brief.cashFloorChip == null, brief.cashFloorChip ?? "chip");
assert(brief.healthCue == null, brief.healthCue ?? "strip");
assert(!brief.actions.some((row) => row.id === "cash-floor"), "no below-minimum action");

const html = renderToStaticMarkup(
  createElement(OwnerHome, {
    variant: "character",
    audience: "accountant",
    showInvite: false,
    title: "Your whole finance team",
    marketCountry: "US",
    sampleClient: false,
    cardPhase: "ready",
    presence: ownerPresence(emptyAgentActivity()),
    lines,
    status,
    needs: {
      actionsHeading: "Actions",
      actionLines: ["Nothing is waiting."],
      draftsHeading: "Drafts",
      draftLines: ["No draft waiting."],
      deliverablesHeading: "Reports",
      deliverableLines: [],
      syncHeading: "Books",
      syncLines: ["Books are on file."],
    },
    onOpen: () => undefined,
    onAsk: () => undefined,
    onMoves: () => undefined,
    onDeliverables: () => undefined,
  }),
);
assert(
  html.includes("Cash not on file yet, upload a balance sheet"),
  "home renders the missing-cash line",
);
assert(!html.includes("Critical"), "home does not render Critical");
assert(!/below your minimum/i.test(html), "home does not render the minimum strip");
assert(!html.includes("$0"), "home does not render $0");

const realZero = assessClientMetrics({
  financials: {
    revenue: "412000",
    cogs: "120000",
    cash: "0",
    totalAssets: "100000",
    equity: "80000",
    receivables: "20000",
    periodMonths: "12",
  },
});
assert(realZero.cash.amount === 0, `a balance-sheet zero was dropped (${realZero.cash.amount})`);
assert(realZero.outlook.cashOnFile !== false, "a written zero stays on file");
assert(realZero.outlook.floor > 0, "a real zero can still sit under a minimum");

const plRatios = overviewRatios(plOnly);
for (const name of ["Debtor Days", "Creditor Days", "Inventory Days", "Working Capital Days"]) {
  assert(
    plRatios[name] == null,
    `${name} is null on a P&L with no balance sheet (${plRatios[name]})`,
  );
}
const blankScore = scoreAndBand("Debtor Days", null, us);
assert(
  blankScore.score == null && blankScore.tier == null,
  "a null day count has no score and no band",
);
const plHealthMap = healthMapFromRatios(plRatios, us);
assert(
  plHealthMap.debtorDays == null && plHealthMap.creditorDays == null,
  "null days stay out of the health map",
);
assert(
  !health.pillars.some((pillar) => pillar.id === "cash" && pillar.score != null),
  "the cash pillar does not keep a score from blank day metrics",
);

const dayCounts = cashDriverDayFigures(plOnly);
assert(
  dayCounts.debtorDays == null && dayCounts.creditorDays == null,
  "statement day figures stay null",
);
const pillarHealths = {
  profit: health.pillars.find((pillar) => pillar.id === "profit")?.score ?? Number.NaN,
  assets: health.pillars.find((pillar) => pillar.id === "assets")?.score ?? Number.NaN,
  financing: health.pillars.find((pillar) => pillar.id === "financing")?.score ?? Number.NaN,
  cash: health.pillars.find((pillar) => pillar.id === "cash")?.score ?? Number.NaN,
};
const ownerDays = buildSpherePillars({
  overallHealth: health.overall ?? Number.NaN,
  pillarHealths,
  healthMap: plHealthMap,
  ratioMeta: {
    debtorDays: { friendly: "Customer Pay Speed" },
    creditorDays: { friendly: "Supplier Pay Window" },
  },
  dayCounts,
});
const accountantDays = buildSpherePillars({
  overallHealth: health.overall ?? Number.NaN,
  pillarHealths,
  healthMap: plHealthMap,
  ratioMeta: {
    debtorDays: { friendly: localizeCopy("Debtor Days", us) },
    creditorDays: { friendly: localizeCopy("Creditor Days", us) },
  },
  dayCounts,
});
const ownerCash = ownerDays.find((pillar) => pillar.id === "cash")?.drivers ?? [];
const accountantCash = accountantDays.find((pillar) => pillar.id === "cash")?.drivers ?? [];
for (const driver of [...ownerCash, ...accountantCash].filter(
  (row) => row.key === "debtorDays" || row.key === "creditorDays",
)) {
  const aside = sphereDriverAsideText(driver);
  assert(driver.reading == null, `${driver.label} must not print a day count (${driver.reading})`);
  assert(!Number.isFinite(driver.health), `${driver.label} must not keep a score`);
  assert(driver.note === HEALTH_NOT_ENOUGH_DATA, `${driver.label} note was ${driver.note}`);
  assert(aside.primary === HEALTH_MISSING_MARK, `${driver.label} prints ${aside.primary}`);
  assert(
    aside.secondary === HEALTH_NOT_ENOUGH_DATA,
    `${driver.label} secondary was ${aside.secondary}`,
  );
  assert(
    !/score\s+\d+|HEALTHY|0 days/i.test(`${driver.label} ${aside.primary} ${aside.secondary}`),
    driver.label,
  );
}
assert(
  accountantCash.find((row) => row.key === "debtorDays")?.label === "Days sales outstanding",
  "US Health names days sales outstanding",
);
assert(
  accountantCash.find((row) => row.key === "creditorDays")?.label === "Days payable outstanding",
  "US Health names days payable outstanding",
);
const dsoRow = healthDayRowPresentation(dayCounts.debtorDays, plHealthMap.debtorDays);
const dpoRow = healthDayRowPresentation(dayCounts.creditorDays, plHealthMap.creditorDays);
assert(
  dsoRow.figure === "—" && dsoRow.note === "Not enough data" && dsoRow.score == null,
  "DSO row",
);
assert(
  dpoRow.figure === "—" && dpoRow.note === "Not enough data" && dpoRow.score == null,
  "DPO row",
);

const plSnapshot = {
  source: "pdf_upload",
  period_date: "2026-10-31",
  financials: plOnly,
};
assert(
  !needsTrialBalanceRefresh({ live: plOnly, snapshots: [plSnapshot] }),
  "a P&L-only upload does not ask to re-import the trial balance",
);
assert(
  needsTrialBalanceRefresh({
    live: { ...plOnly, fixedCosts: "", cash: "" },
    snapshots: [
      {
        source: "pdf_upload",
        period_date: "2026-10-31",
        financials: { ...plOnly, totalAssets: "90000", fixedCosts: "", cash: "" },
      },
    ],
  }),
  "a stale balance sheet still asks for a re-import",
);
assert(
  TRIAL_BALANCE_REFRESH_COPY ===
    "Re-import the trial balance to refresh operating profit and runway",
  "the re-import sentence stays the shared copy",
);

const fullSheet = {
  revenue: "50000",
  cogs: "20000",
  ebit: "10000",
  netIncome: "8000",
  receivables: "6000",
  payables: "4000",
  inventory: "2000",
  totalAssets: "30000",
  equity: "20000",
  cash: "5000",
  periodMonths: "12",
};
const fullRatios = overviewRatios(fullSheet);
assert(fullRatios["Debtor Days"] === 44, `full-sheet DSO ${fullRatios["Debtor Days"]}`);
assert(fullRatios["Creditor Days"] === 73, `full-sheet DPO ${fullRatios["Creditor Days"]}`);
assert(fullRatios["Inventory Days"] === 37, `full-sheet DIO ${fullRatios["Inventory Days"]}`);
const storedZero = overviewRatios({ ...fullSheet, receivables: "0" });
assert(
  storedZero["Debtor Days"] === 0,
  `a stored zero stays 0 days (${storedZero["Debtor Days"]})`,
);
const zeroScore = scoreAndBand("Debtor Days", storedZero["Debtor Days"], us);
assert(zeroScore.score === 100 && zeroScore.tier === "healthy", "an entered zero still scores");

console.log("pl-only-cash-test: all assertions passed");
