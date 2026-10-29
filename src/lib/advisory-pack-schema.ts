/**
 * Schema 2 advisory pack. Chart figures are frozen from the same helpers
 * the Health, Cash, and Profit reports use, so a signed pack redraws
 * those charts after the books move.
 */
import type { HealthPillarId, ScoreMarket } from "./health-score.ts";
import { pillarForRatioName, scorecardHealthFromFinancials } from "./health-score.ts";
import { assessClientMetrics } from "./client-metrics.ts";
import { firstClosingBelow, forecastLowestPoint } from "./cash-forecast-parity.ts";
import { buildBridgeSteps } from "./profit-bridge-steps.ts";
import { periodProfitBridge, statementNetProfit } from "./period-profit.ts";
import { currentRatioValue, metricDirection, periodMonthsOf } from "./ratios.ts";
import { scorecardRatiosFromFinancials } from "./scorecard-rows.ts";
import { diagnoseDuPont } from "./dupont-diagnosis.ts";
import type { OutcomeVerdict, Recommendation } from "./recommendations.ts";
import type {
  AdvisoryPackContentV1,
  PackDataGapRef,
  PackForecastBlock,
  PackHealthBlock,
  PackInputs,
  PackRatioBlock,
  PackRecommendationRef,
} from "./advisory-pack.ts";

export const PACK_SCHEMA1_LAYOUT_NOTE =
  "Created before the new pack layout. Generate a new version for charts.";

export const PACK_SECTION_V2_KEYS = [
  "summary",
  "health",
  "dupont",
  "cash",
  "profit",
  "priorities",
  "notes",
] as const;

export type PackSectionV2Key = (typeof PACK_SECTION_V2_KEYS)[number];

export type PackSectionV2 = {
  key: PackSectionV2Key;
  /** "What it means for this client". Editable later. */
  meaning: string;
  /** "What to do". Editable later. */
  actions: string[];
  /** Cover and summary one-liners. */
  verdict?: string;
  approved: boolean;
};

export type PackDuPontDriver = "netMargin" | "assetTurnover" | "equityMultiplier";

export type PackDuPontBlock = {
  roe: number | null;
  netMargin: number | null;
  assetTurnover: number | null;
  equityMultiplier: number | null;
  prior: {
    roe: number | null;
    netMargin: number | null;
    assetTurnover: number | null;
    equityMultiplier: number | null;
  } | null;
  benchmark: {
    netMargin: number | null;
    assetTurnover: number | null;
    equityMultiplier: number | null;
  } | null;
  mainDriver: PackDuPontDriver | null;
};

export type PackForecastWeek = {
  week: number;
  label: string;
  cashIn: number;
  cashOut: number;
  closing: number;
};

export type PackProfitStep = {
  key: string;
  label: string;
  amount: number;
  kind: "total" | "decrease" | "increase";
};

export type PackRecommendationV2 = PackRecommendationRef & {
  pillar: HealthPillarId | null;
  owner: string | null;
  dueDate: string | null;
  metric: string | null;
};

export type PackOutcomeV2 = {
  title: string;
  metric: string;
  target: string;
  result: OutcomeVerdict;
};

/** The six to eight ratios the management report shows, in reading order. */
export const ADVISORY_PACK_RATIO_NAMES = [
  "Net Margin",
  "Gross Margin",
  "Operating Margin",
  "Debtor Days",
  "Creditor Days",
  "Inventory Days",
  "Asset Turnover",
  "Current Ratio",
] as const;

export type AdvisoryPackContentV2 = {
  schema: 2;
  generatedAt: string;
  clientName: string;
  periodLabel: string | null;
  priorPeriodLabel: string | null;
  figuresAsOf: string | null;
  reviewer: "accountant" | "owner";
  health:
    | (PackHealthBlock & {
        priorOverall: number | null;
        pillars: Array<{
          id: HealthPillarId;
          label: string;
          score: number | null;
          prior: number | null;
          status: string | null;
        }>;
      })
    | null;
  ratios: Array<PackRatioBlock & { benchmark: number | null; history: number[] }>;
  dupont: PackDuPontBlock | null;
  forecast: (PackForecastBlock & { weeks: PackForecastWeek[]; floor: number | null }) | null;
  profit: {
    steps: PackProfitStep[];
    margins: {
      gross: number | null;
      operating: number | null;
      net: number | null;
      priorGross: number | null;
      priorOperating: number | null;
      priorNet: number | null;
    };
  } | null;
  cashCycle: {
    debtorDays: number | null;
    creditorDays: number | null;
    stockDays: number | null;
  } | null;
  outcomes: PackOutcomeV2[];
  recommendations: PackRecommendationV2[];
  dataGaps: PackDataGapRef[];
  /** Forecast-setup assumptions frozen with the pack. */
  assumptions: string[];
  sourceLabel: string | null;
  sections: PackSectionV2[];
};

const V2_TITLES: Record<PackSectionV2Key, string> = {
  summary: "Summary",
  health: "Health",
  dupont: "DuPont diagnosis",
  cash: "Cash",
  profit: "Profit",
  priorities: "Priorities",
  notes: "Notes",
};

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteOrNull(value: number | null | undefined): number | null {
  return finite(value) ? value : null;
}

function ratioMap(
  financials: Record<string, unknown> | null | undefined,
  fyStartMonth: number | null | undefined,
): Record<string, number> {
  const raw = scorecardRatiosFromFinancials(financials, { fyStartMonth });
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (finite(value)) out[name] = value;
  }
  const assets = finite(Number(financials?.currentAssets))
    ? Number(financials?.currentAssets)
    : NaN;
  const liabilities = finite(Number(financials?.currentLiabilities))
    ? Number(financials?.currentLiabilities)
    : NaN;
  const current = currentRatioValue(assets, liabilities);
  if (finite(current)) out["Current Ratio"] = current;
  return out;
}

function industryBenchmark(name: string): number | null {
  const spec = metricDirection(name);
  if (!spec || spec.peerMedian == null || !Number.isFinite(spec.peerMedian)) return null;
  return spec.peerMedian;
}

function dupontBenchmark(name: string): number | null {
  const peer = industryBenchmark(name);
  if (peer != null) return peer;
  const spec = metricDirection(name);
  if (!spec) return null;
  if (spec.direction === "lower_is_better" || spec.direction === "sweet_spot") {
    return finiteOrNull(spec.healthyMax);
  }
  return finiteOrNull(spec.healthyMin);
}

function leverBlock(ratios: Record<string, number> | null) {
  if (!ratios) return null;
  const netMargin = finiteOrNull(ratios["Net Margin"]);
  const assetTurnover = finiteOrNull(ratios["Asset Turnover"]);
  const equityMultiplier = finiteOrNull(ratios["Equity Multiplier"]);
  const roe = finiteOrNull(ratios["Return on Equity"]);
  if (netMargin == null && assetTurnover == null && equityMultiplier == null && roe == null) {
    return null;
  }
  return { roe, netMargin, assetTurnover, equityMultiplier };
}

function mainDriver(levers: NonNullable<ReturnType<typeof leverBlock>>): PackDuPontDriver | null {
  if (levers.netMargin == null || levers.assetTurnover == null || levers.equityMultiplier == null) {
    return null;
  }
  const roe = levers.roe ?? levers.netMargin * levers.assetTurnover * levers.equityMultiplier;
  const diagnosis = diagnoseDuPont({
    roe,
    netMargin: levers.netMargin,
    assetTurnover: levers.assetTurnover,
    equityMultiplier: levers.equityMultiplier,
  });
  if (diagnosis.weakLever === "margin") return "netMargin";
  if (diagnosis.weakLever === "turnover") return "assetTurnover";
  if (diagnosis.weakLever === "leverage") return "equityMultiplier";
  return null;
}

function pillarForRecommendation(rec: Recommendation): HealthPillarId | null {
  const fromEvidence = rec.evidence?.find((item) => item.kind === "pillar")?.key;
  if (
    fromEvidence === "profit" ||
    fromEvidence === "assets" ||
    fromEvidence === "financing" ||
    fromEvidence === "cash"
  ) {
    return fromEvidence;
  }
  switch (rec.expected_impact_metric) {
    case "cash":
    case "debtor_days":
    case "creditor_days":
    case "stock_days":
      return "cash";
    case "profit":
    case "revenue":
    case "gross_margin":
      return "profit";
    default:
      return null;
  }
}

function profitSnapshot(financials: Record<string, unknown>): {
  input: {
    revenue: number;
    gross_profit: number;
    operating_profit: number;
    ebt: number;
    tax: number;
    net_profit: number;
    depreciation: number;
  };
  margins: { gross: number | null; operating: number | null; net: number | null };
} | null {
  const bridge = periodProfitBridge(financials);
  if (!(bridge.revenue > 0)) return null;
  const stated = statementNetProfit(financials);
  const net = stated ?? bridge.ebit - bridge.interest - bridge.tax;
  const margin = (amount: number) => (bridge.revenue > 0 ? amount / bridge.revenue : null);
  return {
    input: {
      revenue: bridge.revenue,
      gross_profit: bridge.grossProfit,
      operating_profit: bridge.ebit,
      ebt: bridge.ebit - bridge.interest,
      tax: bridge.tax,
      net_profit: net,
      depreciation: bridge.depreciation,
    },
    margins: {
      gross: margin(bridge.grossProfit),
      operating: margin(bridge.ebit),
      net: margin(net),
    },
  };
}

function stepKind(kind: "total" | "decrease" | "subtotal", delta: number): PackProfitStep["kind"] {
  if (kind === "decrease") return delta > 0 ? "increase" : "decrease";
  return "total";
}

function stepKey(label: string): string {
  return label.replace(/\s+/g, "_").replace(/[^\w]/g, "").toLowerCase();
}

function bodyOf(base: AdvisoryPackContentV1, key: string): string {
  return base.sections.find((section) => section.key === key)?.body ?? "";
}

function bulletsOf(base: AdvisoryPackContentV1, key: string): string[] {
  return base.sections.find((section) => section.key === key)?.bullets ?? [];
}

function forecastFromSeries(
  opening: number | null,
  closings: number[],
  floor: number | null,
  runwayWeeks: number | null,
): PackForecastBlock | null {
  if (closings.length === 0 || opening == null) return null;
  const low = forecastLowestPoint(opening, closings);
  const comfort = floor != null && floor > 0 ? floor : null;
  return {
    openingBalance: opening,
    lowestClosing: low.amount,
    lowestWeek: low.isOpening ? null : low.week,
    firstNegativeWeek: firstClosingBelow(closings, 0),
    firstThinWeek: comfort == null ? null : firstClosingBelow(closings, comfort),
    breachesZero: low.amount < 0,
    breachesThreshold: comfort != null && low.amount < comfort,
    runwayWeeks,
    horizonWeeks: closings.length,
  };
}

export function assembleAdvisoryPackV2(args: {
  base: AdvisoryPackContentV1;
  input: PackInputs;
  formatRatio: (name: string, value: number) => string;
}): AdvisoryPackContentV2 {
  const books = args.input.books;
  const financials = books?.financials ?? null;
  const priorFinancials = books?.priorFinancials ?? null;
  const fyStartMonth = books?.fyStartMonth ?? null;
  const ratios = financials ? ratioMap(financials, fyStartMonth) : {};
  const priorRatios = priorFinancials ? ratioMap(priorFinancials, fyStartMonth) : null;
  const market = books?.market ?? undefined;

  const priorHealth = priorFinancials
    ? scorecardHealthFromFinancials({
        financials: priorFinancials,
        fyStartMonth,
        periodMonths: periodMonthsOf(priorFinancials),
        market: market as ScoreMarket | undefined,
        industry: books?.industry,
      })
    : null;

  const health = args.base.health
    ? {
        ...args.base.health,
        priorOverall: priorHealth?.overall ?? null,
        pillars: args.base.health.pillars.map((pillar) => ({
          id: pillar.id,
          label: pillar.label,
          score: pillar.score,
          prior: priorHealth?.pillars.find((row) => row.id === pillar.id)?.score ?? null,
          status: pillar.status,
        })),
      }
    : null;

  const ratioBlocks = ADVISORY_PACK_RATIO_NAMES.flatMap((name) => {
    const value = ratios[name];
    if (!finite(value)) return [];
    const prior = priorRatios ? finiteOrNull(priorRatios[name]) : null;
    const history = prior != null ? [prior, value] : [value];
    return [
      {
        name,
        pillar: pillarForRatioName(name),
        value,
        prior,
        score: null as number | null,
        formatted: args.formatRatio(name, value),
        benchmark: industryBenchmark(name),
        history,
      },
    ];
  }).map((row) => {
    const scored = args.base.ratios.find((item) => item.name === row.name);
    return { ...row, score: scored?.score ?? row.score };
  });

  const currentLevers = leverBlock(ratios);
  const priorLevers = leverBlock(priorRatios);
  const dupont: PackDuPontBlock | null = currentLevers
    ? {
        ...currentLevers,
        prior: priorLevers,
        benchmark: {
          netMargin: dupontBenchmark("Net Margin"),
          assetTurnover: dupontBenchmark("Asset Turnover"),
          equityMultiplier: dupontBenchmark("Equity Multiplier"),
        },
        mainDriver: mainDriver(currentLevers),
      }
    : null;

  const assessed = financials
    ? assessClientMetrics({
        financials,
        cashflow: books?.cashflow,
        financialsUpdatedAt: books?.financialsUpdatedAt ?? args.input.figuresAsOf,
        priorFinancials,
        now: books?.now,
        timeZone: books?.timeZone,
        fyStartMonth,
      })
    : null;
  const outlook = assessed?.outlook ?? null;
  const openingCash =
    outlook == null || outlook.cashOnFile === false
      ? null
      : outlook.openingCash != null
        ? outlook.openingCash
        : outlook.opening;
  const cashKnown = outlook != null && openingCash != null && Number.isFinite(openingCash);
  const weeksAligned =
    outlook != null &&
    outlook.inflow.length === outlook.closing.length &&
    outlook.outflow.length === outlook.closing.length &&
    outlook.closing.every((value) => finite(value)) &&
    outlook.inflow.every((value) => finite(value)) &&
    outlook.outflow.every((value) => finite(value));
  const weeks: PackForecastWeek[] =
    cashKnown && outlook && weeksAligned
      ? outlook.closing.map((closing, index) => ({
          week: index + 1,
          label: `Week ${index + 1}`,
          cashIn: outlook.inflow[index],
          cashOut: outlook.outflow[index],
          closing,
        }))
      : [];
  const seriesFloor = cashKnown && outlook && finite(outlook.floor) ? outlook.floor : null;
  const seriesForecast =
    cashKnown && outlook && weeksAligned
      ? forecastFromSeries(openingCash, outlook.closing, seriesFloor, args.input.cashRunwayWeeks)
      : null;
  const forecast = seriesForecast
    ? { ...seriesForecast, weeks, floor: seriesFloor }
    : args.base.forecast
      ? { ...args.base.forecast, weeks: [], floor: finiteOrNull(args.input.floor) }
      : null;

  const profitNow = financials ? profitSnapshot(financials) : null;
  const profitPrior = priorFinancials ? profitSnapshot(priorFinancials) : null;
  const profit = profitNow
    ? {
        steps: buildBridgeSteps(profitNow.input).map((step) => ({
          key: stepKey(step.label),
          label: step.label,
          amount: step.delta,
          kind: stepKind(step.kind, step.delta),
        })),
        margins: {
          gross: profitNow.margins.gross,
          operating: profitNow.margins.operating,
          net: profitNow.margins.net,
          priorGross: profitPrior?.margins.gross ?? null,
          priorOperating: profitPrior?.margins.operating ?? null,
          priorNet: profitPrior?.margins.net ?? null,
        },
      }
    : null;

  const debtorDays = finiteOrNull(ratios["Debtor Days"]);
  const creditorDays = finiteOrNull(ratios["Creditor Days"]);
  const stockDays = finiteOrNull(ratios["Inventory Days"]);
  const cashCycle =
    debtorDays == null && creditorDays == null && stockDays == null
      ? null
      : { debtorDays, creditorDays, stockDays };

  const recommendations: PackRecommendationV2[] = args.base.recommendations.map((rec, index) => {
    const source = args.input.recommendations.find((row) => row.id === rec.id);
    return {
      ...rec,
      pillar: source ? pillarForRecommendation(source) : null,
      owner: null,
      dueDate: null,
      metric: source?.expected_impact_metric ?? null,
      priority: rec.priority || ["critical", "high", "medium", "low"][Math.min(index, 3)],
    };
  });

  const outcomes: PackOutcomeV2[] = (args.input.outcomes ?? []).map((story) => ({
    title: story.title,
    metric: story.verdictLabel,
    target: story.sentence,
    result: story.verdict,
  }));

  const dupontSentence =
    dupont &&
    dupont.netMargin != null &&
    dupont.assetTurnover != null &&
    dupont.equityMultiplier != null
      ? diagnoseDuPont({
          roe: dupont.roe ?? dupont.netMargin * dupont.assetTurnover * dupont.equityMultiplier,
          netMargin: dupont.netMargin,
          assetTurnover: dupont.assetTurnover,
          equityMultiplier: dupont.equityMultiplier,
        }).sentence
      : "Return on equity cannot be split into margin, turnover, and leverage from the figures on file.";

  const profitMeaning =
    profit && profit.margins.net != null
      ? `${args.base.clientName} net margin is ${args.formatRatio("Net Margin", profit.margins.net)}.`
      : bodyOf(args.base, "state_of_business");

  const assumptions = (books?.assumptions ?? []).map((line) => line.trim()).filter(Boolean);
  const source = books?.sourceLabel?.trim() || null;
  const notesMeaning = [
    bodyOf(args.base, "disclosure"),
    source ? `Source: ${source}.` : "",
    assumptions.length ? `Forecast assumptions: ${assumptions.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const topActions = bulletsOf(args.base, "recommendations").slice(0, 3);
  const sections: PackSectionV2[] = [
    {
      key: "summary",
      verdict: bodyOf(args.base, "headline"),
      meaning: bodyOf(args.base, "state_of_business"),
      actions: topActions,
      approved: false,
    },
    {
      key: "health",
      meaning: [
        bodyOf(args.base, "what_matters"),
        ...bulletsOf(args.base, "what_matters").slice(0, 2),
      ]
        .filter(Boolean)
        .join(" "),
      actions: topActions.slice(0, 2),
      approved: false,
    },
    {
      key: "dupont",
      meaning: dupontSentence,
      actions: topActions.slice(0, 2),
      approved: false,
    },
    {
      key: "cash",
      meaning: bodyOf(args.base, "forecast"),
      actions: topActions.slice(0, 2),
      approved: false,
    },
    {
      key: "profit",
      meaning: profitMeaning,
      actions: topActions.slice(0, 2),
      approved: false,
    },
    {
      key: "priorities",
      meaning: bodyOf(args.base, "recommendations"),
      actions: bulletsOf(args.base, "recommendations"),
      approved: false,
    },
    {
      key: "notes",
      meaning: notesMeaning,
      actions: bulletsOf(args.base, "data_gaps"),
      approved: false,
    },
  ];

  return {
    schema: 2,
    generatedAt: args.base.generatedAt,
    clientName: args.base.clientName,
    periodLabel: args.base.periodLabel,
    priorPeriodLabel: args.base.priorPeriodLabel,
    figuresAsOf: args.base.figuresAsOf,
    reviewer: args.base.reviewer,
    health,
    ratios: ratioBlocks,
    dupont,
    forecast,
    profit,
    cashCycle,
    outcomes,
    recommendations,
    dataGaps: args.base.dataGaps,
    assumptions,
    sourceLabel: source,
    sections,
  };
}

export function packV2SectionTitle(key: PackSectionV2Key): string {
  return V2_TITLES[key];
}

export function parseAdvisoryPackV2(raw: Record<string, unknown>): AdvisoryPackContentV2 | null {
  if (raw.schema !== 2) return null;
  const sections = Array.isArray(raw.sections)
    ? raw.sections.flatMap((item): PackSectionV2[] => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const key = row.key;
        if (typeof key !== "string" || !(PACK_SECTION_V2_KEYS as readonly string[]).includes(key)) {
          return [];
        }
        return [
          {
            key: key as PackSectionV2Key,
            meaning: typeof row.meaning === "string" ? row.meaning : "",
            actions: Array.isArray(row.actions) ? row.actions.map(String) : [],
            verdict: typeof row.verdict === "string" ? row.verdict : undefined,
            approved: row.approved === true,
          },
        ];
      })
    : [];
  return {
    schema: 2,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
    clientName: typeof raw.clientName === "string" ? raw.clientName : "",
    periodLabel: typeof raw.periodLabel === "string" ? raw.periodLabel : null,
    priorPeriodLabel: typeof raw.priorPeriodLabel === "string" ? raw.priorPeriodLabel : null,
    figuresAsOf: typeof raw.figuresAsOf === "string" ? raw.figuresAsOf : null,
    reviewer: raw.reviewer === "accountant" ? "accountant" : "owner",
    health: (raw.health as AdvisoryPackContentV2["health"]) ?? null,
    ratios: Array.isArray(raw.ratios) ? (raw.ratios as AdvisoryPackContentV2["ratios"]) : [],
    dupont: (raw.dupont as AdvisoryPackContentV2["dupont"]) ?? null,
    forecast: (raw.forecast as AdvisoryPackContentV2["forecast"]) ?? null,
    profit: (raw.profit as AdvisoryPackContentV2["profit"]) ?? null,
    cashCycle: (raw.cashCycle as AdvisoryPackContentV2["cashCycle"]) ?? null,
    outcomes: Array.isArray(raw.outcomes)
      ? (raw.outcomes as PackOutcomeV2[]).map((row) => ({
          title: String(row.title ?? ""),
          metric: String(row.metric ?? ""),
          target: String(row.target ?? ""),
          result: row.result,
        }))
      : [],
    recommendations: Array.isArray(raw.recommendations)
      ? (raw.recommendations as PackRecommendationV2[])
      : [],
    dataGaps: Array.isArray(raw.dataGaps) ? (raw.dataGaps as PackDataGapRef[]) : [],
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [],
    sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : null,
    sections,
  };
}

export function isAdvisoryPackV2(
  content: { schema?: number } | null | undefined,
): content is AdvisoryPackContentV2 {
  return content?.schema === 2;
}
