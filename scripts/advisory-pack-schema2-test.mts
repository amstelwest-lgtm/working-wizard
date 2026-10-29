/**
 * Schema 2 advisory pack figures match the Health, Cash, and Profit reports
 * for the Chill Pepper books and the Harbour & Co sample statement.
 * Run: pnpm test:advisory-pack-schema2
 */
import { assessClientMetrics } from "../src/lib/client-metrics";
import { scorecardHealthFromFinancials } from "../src/lib/health-score";
import { buildBridgeSteps } from "../src/lib/profit-bridge-steps";
import { buildProfitabilityData, profitabilityStringRecord } from "../src/lib/profitability-data";
import { metricDirection } from "../src/lib/ratios";
import { scorecardRatiosFromFinancials } from "../src/lib/scorecard-rows";
import { sampleFinancialsFor } from "../src/lib/sample-business";
import { sampleOpeningCash } from "../src/lib/trial-sample-view";
import {
  buildAdvisoryPack,
  packNarrativeRatios,
  parsePackContent,
  advisoryPackFiguresChanged,
  type PackBooks,
  type PackInputs,
} from "../src/lib/advisory-pack";
import { ZA_MARKET } from "../src/lib/market/resolve";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = "2026-09-30T12:00:00.000Z";
const NOW_DATE = new Date(NOW);

/** Stored Chill Pepper Boutique Hotel statement (data-coherence fixture). */
const CHILL = {
  revenue: 1_215_000,
  cogs: -56_000,
  ebit: 56_800,
  ebitda: 126_800,
  ebt: 37_000,
  netIncome: 27_010,
  laborCost: 426_000,
  fixedCosts: "",
  payables: 38_000,
  receivables: 21_500,
  inventory: 14_200,
  equity: 54_600,
  totalAssets: 331_600,
  cash: null,
  periodEnd: "2026-09-30",
};

const line = (
  name: string,
  amount: number,
  frequency: "once-off" | "recurring-monthly",
  startWeek: number,
) => ({ name, amount: String(amount), frequency, startWeek });

const CHILL_CASH = {
  openingBalance: "44480",
  openingBalanceSource: null,
  seededFromBanksAt: "2026-08-24T20:07:05.368Z",
  startDate: "2026-05-30",
  revenue: [
    line("Netcash", 36360, "recurring-monthly", 3),
    line("Andre Galvao Seminar", 16800, "once-off", 1),
    line("Netcash", 5760, "once-off", 1),
    line("Yoco", 2250, "recurring-monthly", 5),
    line("D Pillay", 900, "once-off", 1),
    line("L Ferreira", 900, "once-off", 1),
    line("J Botha", 795, "once-off", 1),
    line("M Adams", 795, "once-off", 1),
    line("S Naidoo", 595, "once-off", 1),
  ],
  expenses: [
    line("Greeff Properties", 28000, "once-off", 1),
    line("Fuji SA", 9200, "once-off", 1),
    line("Seminar Guest Instructor Fee", 7200, "once-off", 1),
    line("R Dlamini", 6000, "once-off", 1),
    line("B Petersen", 4500, "once-off", 1),
    line("Sparkle Cleaning", 3500, "once-off", 1),
    line("SARS", 3480, "once-off", 1),
    line("City of Cape Town", 2947.5, "recurring-monthly", 2),
    line("Meta", 2800, "once-off", 1),
    line("Ledger & Co", 2500, "once-off", 1),
    line("Santam", 2200, "once-off", 1),
    line("Webafrica", 899, "once-off", 1),
    line("Netcash", 748, "once-off", 1),
    line("Dis-Chem", 392, "once-off", 1),
    line("FNB", 458, "recurring-monthly", 5),
  ],
  other: [line("T Mokoena", 25000, "once-off", 1), line("FNB", 6800, "once-off", 1)],
};

/** ZA sample statement, named Harbour & Co. Opening is the sample bank balance. */
const HARBOUR: Record<string, string> = {
  ...sampleFinancialsFor("ZA"),
  cash: String(sampleOpeningCash("ZA")),
  periodEnd: "2026-09-30",
};

function booksFor(
  financials: Record<string, unknown>,
  cashflow?: unknown,
): PackBooks {
  return {
    financials,
    cashflow,
    financialsUpdatedAt: NOW,
    fyStartMonth: 3,
    timeZone: ZA_MARKET.timezone,
    now: NOW_DATE,
    market: ZA_MARKET,
    sourceLabel: "Books on file",
    assumptions: ["Forecast inputs approved in Forecast setup."],
  };
}

function packFor(name: string, financials: Record<string, unknown>, cashflow?: unknown) {
  const books = booksFor(financials, cashflow);
  const health = scorecardHealthFromFinancials({
    financials,
    fyStartMonth: 3,
    market: ZA_MARKET,
    industry: null,
  });
  const ratios = scorecardRatiosFromFinancials(financials, { fyStartMonth: 3 });
  const numeric: Record<string, number> = {};
  for (const [key, value] of Object.entries(ratios)) {
    if (typeof value === "number" && Number.isFinite(value)) numeric[key] = value;
  }
  const assessed = assessClientMetrics({
    financials,
    cashflow,
    financialsUpdatedAt: NOW,
    now: NOW_DATE,
    timeZone: ZA_MARKET.timezone,
    fyStartMonth: 3,
  });
  const input: PackInputs & { books: PackBooks } = {
    clientName: name,
    firmName: "Harbour & Co",
    hasFirm: true,
    periodLabel: "Results to 30 September 2026",
    priorPeriodLabel: null,
    figuresAsOf: "2026-09-30",
    health,
    ratios: numeric,
    narrativeRatios: packNarrativeRatios(financials, numeric),
    priorRatios: null,
    openingBalance: assessed.outlook.openingCash,
    closings: assessed.outlook.cashOnFile === false ? null : assessed.outlook.closing,
    floor: assessed.outlook.floor,
    cashRunwayWeeks: assessed.runway.kind === "weeks" ? assessed.runway.weeks : null,
    runwayLabel: assessed.runway.label,
    recommendations: [],
    dataRequests: [],
    openActions: 0,
    overdueActions: 0,
    now: NOW,
    currency: "ZAR",
    market: ZA_MARKET,
    books,
  };
  return { pack: buildAdvisoryPack(input), assessed, health };
}

function checkClient(name: string, financials: Record<string, unknown>, cashflow?: unknown) {
  const { pack, assessed, health } = packFor(name, financials, cashflow);
  eq(pack.schema, 2, `${name} schema`);
  eq(pack.health?.overall, health.overall, `${name} health overall`);
  for (const pillar of health.pillars) {
    const frozen = pack.health?.pillars.find((row) => row.id === pillar.id);
    eq(frozen?.score, pillar.score, `${name} ${pillar.id} score`);
    eq(frozen?.label, pillar.label, `${name} ${pillar.id} label`);
  }

  const profit = buildProfitabilityData(profitabilityStringRecord(financials));
  assert(profit, `${name} waterfall data`);
  const steps = buildBridgeSteps(profit!);
  eq(pack.profit?.steps.length, steps.length, `${name} bridge step count`);
  steps.forEach((step, index) => {
    const frozen = pack.profit?.steps[index];
    eq(frozen?.label, step.label, `${name} step ${index} label`);
    eq(frozen?.amount, step.delta, `${name} step ${index} amount`);
  });
  eq(pack.profit?.margins.gross, profit!.gross_margin_pct, `${name} gross margin`);
  eq(pack.profit?.margins.operating, profit!.operating_margin_pct, `${name} operating margin`);
  eq(pack.profit?.margins.net, profit!.net_margin_pct, `${name} net margin`);

  const ratios = scorecardRatiosFromFinancials(financials, { fyStartMonth: 3 });
  const net = ratios["Net Margin"];
  const turnover = ratios["Asset Turnover"];
  const multiplier = ratios["Equity Multiplier"];
  if (typeof net === "number" && typeof turnover === "number" && typeof multiplier === "number") {
    eq(pack.dupont?.netMargin, net, `${name} dupont margin`);
    eq(pack.dupont?.assetTurnover, turnover, `${name} dupont turnover`);
    eq(pack.dupont?.equityMultiplier, multiplier, `${name} dupont multiplier`);
    assert(pack.dupont?.mainDriver, `${name} names a DuPont driver`);
  }

  const debtorBench = metricDirection("Debtor Days")?.peerMedian ?? null;
  const debtor = pack.ratios.find((row) => row.name === "Debtor Days");
  if (debtor) eq(debtor.benchmark, debtorBench, `${name} debtor benchmark`);
  for (const row of pack.ratios) {
    if (row.name !== "Debtor Days") eq(row.benchmark, null, `${name} ${row.name} has no invented benchmark`);
  }

  const opening =
    assessed.outlook.cashOnFile === false
      ? null
      : (assessed.outlook.openingCash ?? assessed.outlook.opening);
  if (opening != null) {
    eq(pack.forecast?.weeks.length, assessed.outlook.closing.length, `${name} week count`);
    eq(pack.forecast?.openingBalance, opening, `${name} opening`);
    eq(pack.forecast?.floor, assessed.outlook.floor, `${name} floor`);
    assessed.outlook.closing.forEach((closing, index) => {
      eq(pack.forecast?.weeks[index]?.closing, closing, `${name} week ${index + 1} closing`);
      eq(pack.forecast?.weeks[index]?.cashIn, assessed.outlook.inflow[index], `${name} week ${index + 1} in`);
      eq(pack.forecast?.weeks[index]?.cashOut, assessed.outlook.outflow[index], `${name} week ${index + 1} out`);
    });
  }

  const again = parsePackContent(JSON.parse(JSON.stringify(pack)));
  eq(again.schema, 2, `${name} round-trip schema`);
  if (again.schema === 2) {
    eq(again.profit?.steps.length, pack.profit?.steps.length, `${name} round-trip steps`);
    eq(again.sections.length, 7, `${name} section count`);
    assert(
      again.sections.every((section) => section.approved === false && section.meaning.length > 0),
      `${name} sections have meaning`,
    );
  }
  console.log(name, "health", pack.health?.overall, "steps", pack.profit?.steps.length, "weeks", pack.forecast?.weeks.length);
}

checkClient("Chill Pepper Boutique Hotel", CHILL, CHILL_CASH);
checkClient("Harbour & Co", HARBOUR);
{
  const chill = packFor("Chill Pepper Boutique Hotel", CHILL, CHILL_CASH).pack;
  const harbour = packFor("Harbour & Co", HARBOUR).pack;
  eq(chill.forecast?.weeks.length, 13, "Chill Pepper freezes 13 weeks");
  eq(harbour.forecast?.weeks.length, 13, "Harbour & Co freezes 13 weeks");
}

{
  const legacy = parsePackContent({
    schema: 1,
    generatedAt: NOW,
    clientName: "Old Co",
    sections: [{ key: "headline", title: "In one line", body: "Old Co is watch at 60." }],
  });
  eq(legacy.schema, 1, "schema 1 stays schema 1");
  if (legacy.schema === 1) {
    eq(legacy.sections[0]?.body, "Old Co is watch at 60.", "schema 1 body survives");
  }
}

{
  const { pack } = packFor("Chill Pepper Boutique Hotel", CHILL, CHILL_CASH);
  assert(
    !advisoryPackFiguresChanged(pack, {
      runwayLabel: pack.sections.find((section) => section.key === "cash")?.meaning.includes("Cash generative")
        ? "Cash generative"
        : null,
      cash: pack.forecast?.openingBalance ?? null,
      healthScore: pack.health?.overall ?? null,
    }),
    "unchanged chill figures are not stale",
  );
  assert(
    advisoryPackFiguresChanged(pack, {
      runwayLabel: null,
      cash: pack.forecast?.openingBalance ?? null,
      healthScore: (pack.health?.overall ?? 0) + 5,
    }),
    "a moved health score marks schema 2 stale",
  );
}

console.log("advisory-pack-schema2: ok");
