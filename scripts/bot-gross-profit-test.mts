/**
 * AQA US 1020E: client home and the Analyst header say "Gross profit is $241,000"
 * (revenue 412,000 minus cost of sales 171,000, margin 58.5%). The Bot context
 * listed only the margin. Owner and accountant prompts, and the milon-bot
 * snapshot, quote that same dollar figure. A ZA March year quotes the
 * firm-year slice as R 187 444. A file with neither a stored gross profit nor
 * revenue and cost of sales still omits the gross-profit line. Gross margin
 * is that gross profit divided by revenue, and it reads "not available" when
 * either figure is missing. Cash runway is the Overview card headline on the
 * base forecast. Unknown runway reads "not available", not 0 weeks. A saved
 * collection delay does not replace the base headline.
 *
 * Other side? ask-ai (owner and accountant audiences) and milon-bot both read
 * statementGrossProfit through the overview brief and the snapshot tool.
 *
 * Run: pnpm test:bot-gross-profit
 */
import { fiscalStatementSlice } from "../src/lib/budget-period.ts";
import { forecastRunwayHeadlineShared } from "../src/lib/cash-forecast-parity.ts";
import {
  assessClientMetrics,
  forecastMinimumCash,
  rollForwardForecast,
  runwayDisplayLabel,
  RUNWAY_PROFITABLE_LABEL,
} from "../src/lib/client-metrics.ts";
import { resolveMarket } from "../src/lib/market/resolve.ts";
import {
  ownerAnswerTiles,
  ownerHomeLines,
  type OwnerBooks,
} from "../src/lib/owner-answers.ts";
import { buildPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import type { AskAiContext } from "../supabase/functions/ask-ai/types.ts";
import {
  buildOverviewBrief,
  formatOverviewForPrompt,
  overviewCardRunwayLabel,
} from "../supabase/functions/ask-ai/overview-brief.ts";
import { shapeSnapshot } from "../supabase/functions/milon-bot/tools.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const NBSP = /\u00a0/g;
const plain = (s: string | undefined) => (s ?? "").replace(NBSP, " ");

/** 1020E / 1020F statement. Gross profit is not stored. */
const JAN_SEP: Record<string, string> = {
  revenue: "412000",
  cogs: "171000",
  fixedCosts: "189000",
  ebit: "52000",
  ebt: "48400",
  netIncome: "38200",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
  periodMonths: "9",
};

const US = resolveMarket({ country: "US", regionCode: "CA" });
const ZA = resolveMarket({ country: "ZA" });

function books(fin: Record<string, string>, market: typeof US, fy: number): OwnerBooks {
  const n = (k: string) => (fin[k] != null && fin[k] !== "" ? Number(fin[k]) : null);
  return {
    hasBooks: true,
    ledger: null,
    revenue: n("revenue"),
    priorRevenue: null,
    cogs: n("cogs"),
    priorCogs: null,
    grossProfit: n("grossProfit"),
    netIncome: n("netIncome"),
    operatingProfit: n("ebit"),
    profitPeriod: fiscalStatementSlice(fin, fy),
    receivables: null,
    cashflow: null,
    openAction: null,
    actionsReady: true,
    signedBy: null,
    signedOn: null,
    market,
  };
}

function analystLine(b: OwnerBooks): string {
  return plain(ownerHomeLines(ownerAnswerTiles(b), null).analyst[0]);
}

function ctx(overview: AskAiContext["overview"], copyPack: "za" | "us"): AskAiContext {
  return {
    profile: null,
    profileQuestions: [],
    scores: null,
    ratios: [],
    playbook: [],
    copyPack,
    waterfall: null,
    cashForecast: null,
    productLines: [],
    nextSteps: [],
    actionPlan: null,
    deliverables: [],
    overview,
  };
}

const usHome = analystLine(books(JAN_SEP, US, 1));
assert(usHome === "Gross profit is $241,000. Net profit is $38,200.", `US home: ${usHome}`);

const usBrief = buildOverviewBrief({
  financials: JAN_SEP,
  copyPack: "us",
  fyStartMonth: 1,
  clientName: "1020E",
});
assert(usBrief.grossProfit === 241_000, `US brief gross ${usBrief.grossProfit}`);
assert(
  usBrief.grossMargin != null && Math.abs(usBrief.grossMargin - 241_000 / 412_000) < 1e-9,
  `US margin ${usBrief.grossMargin}`,
);

const usOwner = formatOverviewForPrompt(usBrief, "owner");
const usAccountant = formatOverviewForPrompt(usBrief, "accountant");
for (const text of [usOwner, usAccountant]) {
  assert(text.includes("Gross profit: $241,000"), text);
  assert(text.includes("Gross margin: 58.5%"), text);
  assert(text.includes("Cash runway: not available"), text);
  assert(!text.includes("R "), text);
  assert(!/\b0 weeks\b/.test(text), text);
}
const usOwnerAsk = buildPrompt("What is gross profit?", ctx(usBrief, "us"), "full", "owner");
const usAccountantAsk = buildPrompt("What is gross profit?", ctx(usBrief, "us"), "full", "accountant");
assert(usOwnerAsk.user.includes("Gross profit: $241,000"), usOwnerAsk.user);
assert(usAccountantAsk.user.includes("Gross margin: 58.5%"), usOwnerAsk.user);
assert(usAccountantAsk.user.includes("Gross profit: $241,000"), usAccountantAsk.user);
assert(usAccountantAsk.user.includes("Gross margin: 58.5%"), usAccountantAsk.user);
assert(usOwnerAsk.user.includes("Cash runway: not available"), usOwnerAsk.user);
assert(usAccountantAsk.user.includes("Cash runway: not available"), usAccountantAsk.user);

const usSnap = shapeSnapshot({
  periodLabel: "Jan 1 – Sep 30, 2026",
  periodDate: "2026-09-30",
  ratios: {},
  financials: JAN_SEP,
  cashRunwayWeeks: null,
  fyStartMonth: 1,
});
const usTotals = usSnap.statement_totals as { grossProfit?: number };
assert(usTotals.grossProfit === 241_000, `US snapshot gross ${usTotals.grossProfit}`);
assert(
  typeof usSnap.gross_margin === "number" && Math.abs(usSnap.gross_margin - 241_000 / 412_000) < 1e-9,
  `US snapshot margin ${usSnap.gross_margin}`,
);
assert(usSnap.cash_runway_weeks == null && usSnap.cash_runway == null, "a null runway is not stored as 0");

const zaHome = analystLine(books(JAN_SEP, ZA, 3));
assert(plain(zaHome).includes("Gross profit is R 187 444."), `ZA home: ${zaHome}`);

const zaBrief = buildOverviewBrief({
  financials: JAN_SEP,
  copyPack: "za",
  fyStartMonth: 3,
  clientName: "1020F",
});
const zaOwner = formatOverviewForPrompt(zaBrief, "owner");
const zaAccountant = formatOverviewForPrompt(zaBrief, "accountant");
for (const text of [zaOwner, zaAccountant]) {
  assert(text.includes("Gross profit: R 187 444"), text);
  assert(text.includes("Gross margin: 58.5%"), text);
  assert(text.includes("Cash runway: not available"), text);
  assert(!text.includes("$241,000"), text);
  assert(!text.includes("$"), text);
}
const zaAsk = buildPrompt("What is gross profit?", ctx(zaBrief, "za"), "full", "accountant");
const zaOwnerAsk = buildPrompt("What is gross profit?", ctx(zaBrief, "za"), "full", "owner");
for (const asked of [zaAsk, zaOwnerAsk]) {
  assert(asked.user.includes("Gross profit: R 187 444"), asked.user);
  assert(asked.user.includes("Gross margin: 58.5%"), asked.user);
  assert(asked.user.includes("Cash runway: not available"), asked.user);
  assert(!asked.user.includes("$241,000"), asked.user);
}
const zaSnap = shapeSnapshot({
  periodLabel: "1 Jan 2026 – 30 Sep 2026",
  periodDate: "2026-09-30",
  ratios: {},
  financials: JAN_SEP,
  cashRunwayWeeks: null,
  fyStartMonth: 3,
});
const zaTotals = zaSnap.statement_totals as { grossProfit?: number; revenue?: number };
assert(
  zaTotals.grossProfit != null && Math.abs(zaTotals.grossProfit - (241_000 * 7) / 9) < 0.02,
  `ZA snapshot gross ${zaTotals.grossProfit}`,
);
assert(
  typeof zaSnap.gross_margin === "number" && Math.abs(zaSnap.gross_margin - 241_000 / 412_000) < 1e-9,
  `ZA snapshot margin ${zaSnap.gross_margin}`,
);
assert(zaSnap.cash_runway == null, "ZA snapshot does not invent a runway");

const bare = buildOverviewBrief({
  financials: { revenue: "412000" },
  copyPack: "us",
  fyStartMonth: 1,
});
assert(bare.grossProfit == null, `blank cost invented gross ${bare.grossProfit}`);
assert(bare.grossMargin == null, `blank cost invented a margin ${bare.grossMargin}`);
for (const audience of ["owner", "accountant"] as const) {
  const barePrompt = formatOverviewForPrompt(bare, audience);
  assert(!barePrompt.includes("Gross profit:"), `${audience} still omits an unavailable gross profit`);
  assert(barePrompt.includes("Gross margin: not available"), barePrompt);
  assert(!barePrompt.includes("Gross margin: 0"), barePrompt);
  assert(!barePrompt.includes("Gross margin: 100"), barePrompt);
  assert(barePrompt.includes("Cash runway: not available"), barePrompt);
  assert(!/\b0 weeks\b/.test(barePrompt), barePrompt);
}

const storedOnly = buildOverviewBrief({
  financials: { revenue: "412000", grossProfit: "241000" },
  copyPack: "us",
  fyStartMonth: 1,
});
assert(storedOnly.grossProfit === 241_000, `stored-only gross ${storedOnly.grossProfit}`);
assert(
  storedOnly.grossMargin != null && Math.abs(storedOnly.grossMargin - 241_000 / 412_000) < 1e-9,
  `stored-only margin ${storedOnly.grossMargin}`,
);
assert(
  formatOverviewForPrompt(storedOnly, "owner").includes("Gross profit: $241,000"),
  "a stored gross profit with no cost of sales is still quoted",
);
assert(
  formatOverviewForPrompt(storedOnly, "accountant").includes("Gross margin: 58.5%"),
  "a stored gross profit still has a margin",
);

const noCash = assessClientMetrics({ financials: JAN_SEP, cashflow: null, fyStartMonth: 1 });
assert(noCash.runway.weeks == null && noCash.cash.amount == null, "1020E has no cash runway");
const noCashLabel = overviewCardRunwayLabel({
  runwayLabel: runwayDisplayLabel(noCash.runway),
  runwayWeeks: noCash.runway.weeks,
  cash: noCash.cash.amount,
  opening: noCash.outlook.opening,
  closings: noCash.outlook.closing,
  floor: noCash.outlook.floor,
  openingMissing: false,
  cashGenerative: false,
});
assert(noCashLabel == null, `unknown runway became ${noCashLabel}`);
const noCashBrief = buildOverviewBrief({
  financials: JAN_SEP,
  copyPack: "us",
  fyStartMonth: 1,
  cash: noCash.cash.amount,
  runwayWeeks: noCash.runway.weeks,
  runwayLabel: runwayDisplayLabel(noCash.runway),
  cashflow: null,
  openingMissing: false,
  cashOpening: noCash.outlook.opening,
  cashClosings: noCash.outlook.closing,
  cashFloor: noCash.outlook.floor,
  clientName: "1020E",
});
for (const audience of ["owner", "accountant"] as const) {
  const text = formatOverviewForPrompt(noCashBrief, audience);
  const asked = buildPrompt("What is the cash runway?", ctx(noCashBrief, "us"), "full", audience);
  for (const body of [text, asked.user]) {
    assert(body.includes("Gross margin: 58.5%"), body);
    assert(body.includes("Gross profit: $241,000"), body);
    assert(body.includes("Cash runway: not available"), body);
    assert(!body.includes("R "), body);
    assert(!/\b0 weeks\b/.test(body), body);
  }
}

const monday = new Date(2026, 9, 5);
const scenarioFin = { ...JAN_SEP, cash: "50000" };
const scenarioFlow = {
  startDate: "2026-10-05",
  openingBalance: "50000",
  openingBalanceSource: "manual",
  collectDelay: 8,
  revAdj: 50,
  revenue: [{ amount: "9000", frequency: "recurring-weekly", startWeek: 1 }],
  expenses: [{ amount: "8000", frequency: "recurring-weekly", startWeek: 1 }],
};
const baseMetrics = assessClientMetrics({
  financials: scenarioFin,
  cashflow: scenarioFlow,
  fyStartMonth: 1,
  now: monday,
});
const baseLabel = overviewCardRunwayLabel({
  runwayLabel: runwayDisplayLabel(baseMetrics.runway),
  runwayWeeks: baseMetrics.runway.weeks,
  cash: baseMetrics.cash.amount,
  opening: baseMetrics.outlook.opening,
  closings: baseMetrics.outlook.closing,
  floor: baseMetrics.outlook.floor,
  openingMissing: false,
  cashGenerative: baseMetrics.runway.kind === "cash_generative",
});
const rawRoll = rollForwardForecast(scenarioFlow);
assert(rawRoll != null, "the saved scenario still rolls");
const scenarioHeadline = forecastRunwayHeadlineShared({
  opening: 50_000,
  closings: rawRoll.closing,
  floor: forecastMinimumCash({ weeklyOutflows: rawRoll.outflow }),
  runwayLabel: runwayDisplayLabel(baseMetrics.runway),
  cashGenerative: false,
}).headline;
assert(baseLabel != null && baseLabel !== scenarioHeadline, `base ${baseLabel} vs scenario ${scenarioHeadline}`);
assert(baseLabel !== RUNWAY_PROFITABLE_LABEL, `card headline stayed the long label ${baseLabel}`);
const scenarioBrief = buildOverviewBrief({
  financials: scenarioFin,
  copyPack: "us",
  storedMarket: { country: "US" },
  fyStartMonth: 1,
  cash: baseMetrics.cash.amount,
  runwayWeeks: baseMetrics.runway.weeks,
  runwayLabel: runwayDisplayLabel(baseMetrics.runway),
  cashGenerative: baseMetrics.runway.kind === "cash_generative",
  cashflow: scenarioFlow,
  openingMissing: false,
  cashOpening: baseMetrics.outlook.opening,
  cashClosings: baseMetrics.outlook.closing,
  cashFloor: baseMetrics.outlook.floor,
  now: monday,
  clientName: "1020E",
});
assert(scenarioBrief.runwayLabel === baseLabel, `brief runway ${scenarioBrief.runwayLabel}`);
for (const audience of ["owner", "accountant"] as const) {
  const text = formatOverviewForPrompt(scenarioBrief, audience);
  const asked = buildPrompt("What is the cash runway?", ctx(scenarioBrief, "us"), "full", audience);
  for (const body of [text, asked.user]) {
    assert(body.includes(`Cash runway: ${baseLabel}`), body);
    assert(!body.includes(`Cash runway: ${scenarioHeadline}`), body);
    assert(body.includes("Gross profit: $241,000"), body);
    assert(body.includes("Gross margin: 58.5%"), body);
    assert(!body.includes("R "), body);
  }
}
const scenarioSnap = shapeSnapshot({
  periodLabel: "Jan 1 – Sep 30, 2026",
  periodDate: "2026-09-30",
  ratios: {},
  financials: scenarioFin,
  cashRunwayWeeks: baseMetrics.runway.kind === "weeks" || baseMetrics.runway.kind === "zero" ? baseMetrics.runway.weeks : null,
  runwayLabel: baseLabel,
  fyStartMonth: 1,
});
assert(scenarioSnap.cash_runway === baseLabel, `snapshot quoted ${scenarioSnap.cash_runway}`);
assert(scenarioSnap.cash_runway !== scenarioHeadline, "snapshot did not keep the saved scenario");

console.log("bot-gross-profit: ok");
