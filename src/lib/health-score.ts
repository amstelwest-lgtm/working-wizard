import { HEALTH_RATIO_COUNT, PILLAR_RATIO_NAMES } from "./health-catalogue.ts";
import { withCanonicalDebtorCreditorDays } from "./deliverable-input-config.ts";
import { coherentEquity, effectivePeriodMonths } from "./equity-coherence.ts";
import {
  bandedPillarStatus,
  computeRatios,
  healthBandLabel,
  periodMonthsOf,
  scoreTier,
  type HealthTier,
  type RatioInputs,
} from "./ratios.ts";
import { salesPerEmployeeHealthy } from "./market/benchmarks.ts";
import type { ResolvedMarket } from "./market/types.ts";
import {
  assessClientMetrics,
  hasFinancialEvidence,
  persistedRunwayWeeks,
  scoreCreditorDays,
  scoreLowerIsBetterDays,
  scoreWorkingCapitalDays,
  scoreWorkingCapitalFunding,
  storedOpeningIsMissing,
} from "./client-metrics.ts";

export type ScoreMarket = Pick<ResolvedMarket, "country" | "copyPack">;

/**
 * Single source of truth for overall health scoring.
 *
 * Surfaces that must agree:
 * - Owner app overview sphere + captions
 * - Accountant portfolio dashboard (ring + status chip)
 * - Client header ring + sphere pillars
 * - `client_score_history` writes
 * - Health Scorecard PDF overall + pillar band
 *
 * Overall = equal average of available pillar scores.
 * Cash runway (when known) is one leg of the cash pillar — never a 55% override.
 * A client never shows a clean "Healthy" chip when any pillar is critical,
 * when runway is 0 weeks, or when week 1 of the forecast is already short.
 */

export type FlatFinancials = Record<string, string | number | undefined | null> | null | undefined;

export type HealthPillarId = "profit" | "assets" | "financing" | "cash";

export type PillarScore = {
  id: HealthPillarId;
  label: string;
  score: number | null;
  status: HealthTier;
  /** Set when the pillar has no confident score, such as a missing opening balance. */
  note?: string | null;
};

export type OverallHealth = {
  /** Rounded 0–100 overall, or null when nothing scorable exists. */
  overall: number | null;
  /** Tier from the overall number alone. */
  status: HealthTier;
  /**
   * Display tier. "healthy" is demoted to "at_risk" when any pillar is critical
   * or week 1 is short. Zero weeks of runway, or cash under the floor, forces "critical".
   */
  displayStatus: HealthTier;
  /** Short UI label for chips ("Healthy" / "Watch" / "Critical"). */
  displayLabel: string;
  pillars: PillarScore[];
  weakestPillar: PillarScore | null;
  hasCriticalPillar: boolean;
};

/**
 * One name per pillar. Home, Health, the action plan, the pack, the scorecard
 * PDF, and the landing page all use this map. Scores are out of 100.
 */
export const PILLAR_LABELS: Record<HealthPillarId, string> = {
  profit: "Profit",
  assets: "Assets",
  financing: "Financing",
  cash: "Cash",
};

/** Same words as `PILLAR_LABELS`. Kept so older call sites stay on the map. */
export const PILLAR_SHORT_LABELS: Record<HealthPillarId, string> = PILLAR_LABELS;

/** Cash has no confident score until an opening balance is on file. */
export const CASH_OPENING_UNSCORED = "Needs opening balance";

/** Gross margin above this, outside software, is a mapping problem, not a healthy score. */
export const IMPLAUSIBLE_GROSS_MARGIN = 0.85;

export const GROSS_MARGIN_MAPPING_NOTE = "Check cost of sales mapping";

const SOFTWARE_INDUSTRY = /saas|software/i;

/**
 * A margin above 85% is implausible for hospitality and most other named
 * industries. Software is exempt. No industry label leaves the ratio scored,
 * so a pack that has not been told the industry still matches Overview.
 */
export function grossMarginLooksImplausible(margin: number, industry?: string | null): boolean {
  if (!Number.isFinite(margin) || margin <= IMPLAUSIBLE_GROSS_MARGIN) return false;
  const label = (industry ?? "").trim();
  if (!label || SOFTWARE_INDUSTRY.test(label)) return false;
  return true;
}

/** Maps `computeRatios()` human-readable names → camelCase keys used in UI health maps. */
export const RATIO_NAME_TO_KEY: Record<string, string> = {
  "Gross Margin": "grossMargin",
  "Gross Profit Margin": "grossMargin",
  "Operating Margin": "operatingMargin",
  "Net Margin": "netMargin",
  "Return on Assets": "roa",
  "Return on Equity": "roe",
  "Asset Turnover": "assetTurnover",
  "Equity Multiplier": "equityMultiplier",
  "Debt-to-Equity": "debtToEquity",
  "Interest Burden": "interestBurden",
  "Tax Burden": "taxBurden",
  "Debtor Days": "debtorDays",
  "Inventory Days": "inventoryDays",
  "Creditor Days": "creditorDays",
  "Working Capital Days": "workingCapitalDays",
  "Fixed Cost Ratio": "fixedCostRatio",
  "Degree of Operating Leverage": "dol",
  "Top-5 Customer Share": "customerConcentration",
  "Gross Profit / Labor": "gpToLabor",
  "Sales-per-Employee Ratio": "salesPerEmployee",
  "OCF / EBITDA": "ocfToEbitda",
};

/** Build a camelCase healthMap from `computeRatios` output via shared `scoreRatio`. */
export function healthMapFromRatios(
  ratios: Record<string, number>,
  market?: ScoreMarket,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [name, val] of Object.entries(ratios)) {
    if (!Number.isFinite(val)) continue;
    const scored = scoreRatio(name, val, market);
    if (!Number.isFinite(scored)) continue;
    const key = RATIO_NAME_TO_KEY[name];
    if (key) map[key] = Math.round(scored);
  }
  return map;
}

/**
 * Band for one ratio score. The driver card and the ratio drawer both call
 * this, so a score of 60 is Watch on both and a score under 40 is Critical.
 */
export function ratioScoreBand(score: number): {
  score: number;
  tier: HealthTier;
  label: ReturnType<typeof healthBandLabel>;
} {
  const rounded = Number.isFinite(score) ? Math.round(score) : Number.NaN;
  const tier = scoreTier(rounded);
  return { score: rounded, tier, label: healthBandLabel(tier) };
}

/** Catalogue keys that share a scored ratio under another name. */
const PLAYBOOK_RATIO_ALIAS: Record<string, string> = {
  wipDays: "inventoryDays",
};

/** Chip and score line when a live client has no inputs for a catalogue ratio. */
export const NOT_SCORED_LABEL = "Not scored";

/** Health, pillars, and the ring when the file has no books and no parsed statement. */
export const NOT_SCORED_YET_LABEL = "Not scored yet";

/**
 * Playbook card score from the shared ratio map. Missing keys are unscored —
 * callers show "Not scored" instead of a catalogue fixture such as Healthy 75.
 */
export function scorePlaybookRatio(
  ratioKey: string,
  healthMap: Record<string, number> | null | undefined,
): { health_score: number; health_tier: HealthTier; unscored: boolean } | null {
  if (!healthMap) return null;
  const key = PLAYBOOK_RATIO_ALIAS[ratioKey] ?? ratioKey;
  const score = healthMap[key];
  if (score == null || !Number.isFinite(score)) {
    return { health_score: 0, health_tier: "critical", unscored: true };
  }
  const health_score = Math.round(score);
  return { health_score, health_tier: scoreTier(health_score), unscored: false };
}

/**
 * Score a playbook catalogue from live ratios. Fixture scores on the rows are
 * dropped. A key with no inputs (revenue per employee with no headcount) is
 * "Not scored" — health_score 0 and unscored, never the demo 75 / 28 / 41.
 */
export function scorePlaybookCatalogue<T extends { ratio_key: string }>(
  rows: readonly T[],
  ratios: Record<string, number>,
  market?: ScoreMarket,
): Array<T & { health_score: number; health_tier: HealthTier; unscored: boolean }> {
  const map = healthMapFromRatios(ratios, market);
  const wcDays = ratios["Working Capital Days"];
  if (Number.isFinite(wcDays)) {
    const funded = scoreWorkingCapitalFunding(wcDays / 365);
    if (Number.isFinite(funded)) map.workingCapitalFunding = Math.round(funded);
  }
  return rows.map((row) => {
    const scored = scorePlaybookRatio(row.ratio_key, map);
    if (!scored || scored.unscored) {
      return { ...row, health_score: 0, health_tier: "at_risk" as const, unscored: true };
    }
    return {
      ...row,
      health_score: scored.health_score,
      health_tier: scored.health_tier,
      unscored: false,
    };
  });
}

export { HEALTH_RATIO_COUNT, PILLAR_RATIO_NAMES };

const ALL_PILLARS: HealthPillarId[] = ["profit", "assets", "financing", "cash"];

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/** Mean of finite scores only. Empty / non-finite inputs are omitted — never 0 or 50. */
function avg(nums: number[]): number | null {
  const finite = nums.filter((n) => Number.isFinite(n));
  if (!finite.length) return null;
  return finite.reduce((s, n) => s + n, 0) / finite.length;
}

/** Real numeric ratio only — empty string / null / NaN are missing, not 0. */
function toFiniteNumber(val: unknown): number | null {
  if (val == null || val === "") return null;
  const n = typeof val === "number" ? val : Number(val);
  return Number.isFinite(n) ? n : null;
}

function emptyRatioInputs(): RatioInputs {
  return {
    revenue: "",
    cogs: "",
    ebit: "",
    ebt: "",
    netIncome: "",
    ebitda: "",
    operatingCashflow: "",
    totalAssets: "",
    equity: "",
    receivables: "",
    inventory: "",
    payables: "",
    fixedCosts: "",
    variableCosts: "",
    top5Revenue: "",
    laborCost: "",
    employees: "",
    founderHours: "",
  };
}

function fyStartForScore(market?: ScoreMarket): number | undefined {
  if (market?.country === "US") return 1;
  if (market?.country === "ZA") return 3;
  return undefined;
}

/** Map a flat `clients.financials` blob into RatioInputs. */
export function flatToRatioInputs(
  financials: FlatFinancials,
  opts?: { fyStartMonth?: number | null },
): RatioInputs {
  const base = emptyRatioInputs();
  if (!financials) return base;
  const keys = Object.keys(base) as (keyof RatioInputs)[];
  for (const k of keys) {
    const v = financials[k];
    if (v == null || v === "") continue;
    base[k] = String(v);
  }
  base.periodMonths = String(effectivePeriodMonths(financials as Record<string, unknown>, opts));
  const liabilities = (financials as Record<string, unknown>).totalLiabilities;
  if (liabilities != null && liabilities !== "") base.totalLiabilities = String(liabilities);
  const coherent = coherentEquity(financials as Record<string, unknown>);
  if (coherent.equity) base.equity = coherent.equity;
  return base;
}

/**
 * Ratio inputs Overview and the Ratios grid score.
 * Period length follows the financial-year span. Equity stays the figure on
 * the statement — the same fields the accountant page passes to `computeRatios`.
 */
export function overviewRatioInputs(
  financials: FlatFinancials | Record<string, unknown> | null | undefined,
  opts?: { fyStartMonth?: number | null; periodMonths?: number | null },
): RatioInputs & { totalLiabilities?: string } {
  const fin = (financials ?? {}) as Record<string, unknown>;
  const text = (key: string): string => {
    const value = fin[key];
    if (value == null) return "";
    return typeof value === "string" ? value : String(value);
  };
  return {
    revenue: text("revenue"),
    cogs: text("cogs"),
    ebit: text("ebit"),
    ebt: text("ebt"),
    netIncome: text("netIncome"),
    ebitda: text("ebitda"),
    operatingCashflow: text("operatingCashflow"),
    totalAssets: text("totalAssets"),
    equity: text("equity"),
    receivables: text("receivables"),
    inventory: text("inventory"),
    payables: text("payables"),
    fixedCosts: text("fixedCosts"),
    variableCosts: text("variableCosts"),
    top5Revenue: text("top5Revenue"),
    laborCost: text("laborCost"),
    employees: text("employees"),
    founderHours: text("founderHours"),
    periodMonths: String(ratioCoverMonths(fin, opts)),
    totalLiabilities: text("totalLiabilities"),
  };
}

/**
 * Months used to annualise. Reports pass the stored cover (`periodMonthsOf`).
 * The Ratios grid keeps the year-span default when no cover is passed.
 */
function ratioCoverMonths(
  fin: Record<string, unknown>,
  opts?: { fyStartMonth?: number | null; periodMonths?: number | null },
): number {
  const explicit = opts?.periodMonths;
  if (explicit != null && Number.isFinite(explicit) && explicit >= 1 && explicit <= 12) {
    return Math.round(explicit);
  }
  return effectivePeriodMonths(fin, opts);
}

/**
 * Ratios Overview, the health orb, the scorecard, and the pack score.
 * Margins stay on the year-span cover. Debtor and creditor days are the
 * Ratios / Collections `periodMonthsOf` figures.
 */
export function overviewRatios(
  financials: FlatFinancials | Record<string, unknown> | null | undefined,
  opts?: { fyStartMonth?: number | null; periodMonths?: number | null },
): Record<string, number> {
  return withCanonicalDebtorCreditorDays(
    computeRatios(overviewRatioInputs(financials, opts)),
    financials,
  );
}

/**
 * Pillar and overall scores for Ratios, Overview, and the scorecard PDF.
 * One call: `overviewRatios` plus the same runway, market, and shortfall
 * Overview already passes to `computeOverallHealth`. The PDF renders this
 * result; it does not average a different row set.
 */
export function scorecardHealthFromFinancials(input: {
  financials: FlatFinancials | Record<string, unknown> | null | undefined;
  fyStartMonth?: number | null;
  /** Stored figures cover. Reports pass `periodMonthsOf`. Omitted on the Ratios page. */
  periodMonths?: number | null;
  cashRunwayWeeks?: number | null;
  /** Null when the client has no cash line. Runway then stays out of the cash pillar. */
  cashBalance?: number | null;
  market?: ScoreMarket;
  shortfallWeek?: number | null;
  /** Industry label. A gross margin above 85% is left unscored outside software. */
  industry?: string | null;
}): OverallHealth {
  const ratios = overviewRatios(input.financials, {
    fyStartMonth: input.fyStartMonth,
    periodMonths: input.periodMonths,
  });
  const gross = ratios["Gross Margin"];
  return computeOverallHealth({
    ratios,
    cashRunwayWeeks: input.cashRunwayWeeks,
    cashBalance: input.cashBalance,
    market: input.market,
    shortfallWeek: input.shortfallWeek,
    grossMarginImplausible:
      typeof gross === "number" && grossMarginLooksImplausible(gross, input.industry),
  });
}

/**
 * The score Home, the client list, notes, Analyst chat, an agent run, and
 * the pack all quote. Industry, the cash floor, and a missing opening are
 * applied here. An empty book stays unscored: the floor must not invent one.
 */
/**
 * Same equity the Score tab shows. A blank total is assets − liabilities
 * (payables when the sheet has no liability total). A typed total stays.
 * The client list stores the blank; Health scores the plugged figure.
 */
function booksWithReadTimeEquity(
  financials: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!financials) return null;
  const resolved = coherentEquity(financials);
  const current = financials.equity == null ? "" : String(financials.equity).trim();
  if (
    resolved.equity === "" ||
    !(resolved.derived || resolved.preClose || resolved.equity !== current)
  ) {
    return financials;
  }
  return {
    ...financials,
    equity: resolved.equity,
    ...(resolved.derived ? { equityDerived: "1" } : {}),
    ...(resolved.preClose ? { periodProfitInEquity: String(resolved.profitIncluded) } : {}),
  };
}

export function liveHealthFromBooks(input: {
  financials?: Record<string, unknown> | null;
  cashflow?: unknown;
  financialsUpdatedAt?: string | null;
  priorFinancials?: Record<string, unknown> | null;
  fyStartMonth?: number | null;
  market?: ScoreMarket;
  industry?: string | null;
  timeZone?: string | null;
  now?: Date;
}): OverallHealth {
  const stored =
    input.financials && typeof input.financials === "object" && !Array.isArray(input.financials)
      ? input.financials
      : null;
  if (!hasFinancialEvidence({ financials: stored, cashflow: input.cashflow })) {
    return healthWithoutEvidence(
      scorecardHealthFromFinancials({
        financials: stored,
        fyStartMonth: input.fyStartMonth,
        periodMonths: stored ? periodMonthsOf(stored) : null,
        market: input.market,
        industry: input.industry,
      }),
    );
  }
  const financials = booksWithReadTimeEquity(stored);
  const assessed = assessClientMetrics({
    financials,
    cashflow: input.cashflow,
    financialsUpdatedAt: input.financialsUpdatedAt ?? null,
    priorFinancials: input.priorFinancials ?? null,
    now: input.now,
    timeZone: input.timeZone,
    fyStartMonth: input.fyStartMonth,
  });
  const cashBalance = assessed.cash.amount;
  const cashKnown = cashBalance != null;
  const healthScored = scorecardHealthFromFinancials({
    financials,
    fyStartMonth: input.fyStartMonth,
    periodMonths: financials ? periodMonthsOf(financials) : null,
    cashRunwayWeeks: cashKnown ? persistedRunwayWeeks(assessed.runway) : null,
    cashBalance: cashKnown ? cashBalance : null,
    market: input.market,
    shortfallWeek: assessed.outlook.shortfallWeek,
    industry: input.industry,
  });
  if (healthScored.overall == null) return healthScored;
  return cashPillarFollowsForecast(healthScored, {
    openingMissing: storedOpeningIsMissing(input.cashflow),
    opening: assessed.outlook.opening,
    closings: assessed.outlook.closing,
    floor: assessed.outlook.floor,
  });
}

/**
 * Per-ratio health score (0–100). Shared by client page, reports studio,
 * and overall aggregation.
 */
export function scoreRatio(name: string, val: number, market?: ScoreMarket): number {
  // Missing / not-yet-calculated ratios must not become a fake midpoint.
  if (!Number.isFinite(val)) return Number.NaN;

  // Margins / returns — higher is better
  if (name === "Net Margin") return clamp((val / 0.15) * 100);
  if (name === "Operating Margin") return clamp((val / 0.2) * 100);
  if (name === "Gross Margin") return clamp((val / 0.4) * 100);
  if (name === "Return on Assets") return clamp((val / 0.12) * 100);
  if (name === "Return on Equity") return clamp((val / 0.2) * 100);
  if (name === "Asset Turnover") return clamp((val / 1.5) * 100);
  if (name === "Gross Profit / Labor") return clamp((val / 0.6) * 100);
  if (name === "Sales-per-Employee Ratio") {
    return clamp((val / salesPerEmployeeHealthy(market)) * 100);
  }
  if (name === "OCF / EBITDA") return clamp(val * 100);
  if (name === "Interest Burden") return clamp(val * 100);
  if (name === "Tax Burden") return clamp(val * 100);

  // Lower-is-better cost / concentration burdens
  if (name === "Fixed Cost Ratio") return clamp(((0.5 - val) / 0.5) * 100);
  if (name === "Top-5 Customer Share") return clamp(((0.8 - val) / 0.8) * 100);

  // Days. Creditors have a 30–60 day sweet spot; past that, longer is a risk.
  // Values beyond ±1000 days score 0 — they are not a healthy extreme.
  if (name === "Debtor Days" || name === "Inventory Days") return scoreLowerIsBetterDays(val);
  if (name === "Working Capital Days") return scoreWorkingCapitalDays(val);
  if (name === "Creditor Days") return scoreCreditorDays(val);

  // Structure / leverage
  if (name === "Equity Multiplier") return clamp(((4 - val) / 3) * 100);
  if (name === "Degree of Operating Leverage") {
    // Moderate operating leverage is healthier than extreme sensitivity
    if (val <= 0) return 30;
    if (val <= 2) return clamp(50 + (val / 2) * 40);
    if (val <= 4) return clamp(90 - ((val - 2) / 2) * 40);
    return clamp(50 - (val - 4) * 10);
  }

  // Extra names used by report builders / camelCase aliases
  if (name === "Debt-to-Equity" || name === "Debt to Equity") return clamp(((2 - val) / 2) * 100);
  if (name === "Debt-to-Assets" || name === "Debt to Assets")
    return clamp(((0.7 - val) / 0.7) * 100);
  if (name === "Current Ratio") return clamp((val / 2) * 100);
  if (name === "Revenue Growth") return clamp((val / 0.2) * 100);

  // An unnamed ratio is missing, not a midpoint.
  return Number.NaN;
}

/**
 * Cash runway → 0–100.
 * Aligns with HEALTH_BAND_TABLE: ≥12 wk (85) Healthy, 4–12 wk (45 and 65)
 * Watch, <4 wk critical.
 */
export function scoreCashRunway(weeks: number): number {
  if (!Number.isFinite(weeks)) return Number.NaN;
  if (weeks >= 16) return 100;
  if (weeks >= 12) return 85;
  if (weeks >= 8) return 65;
  if (weeks >= 4) return 45;
  if (weeks >= 2) return 25;
  return 10;
}

/** Assign a ratio's human name to a pillar. */
export function pillarForRatioName(name: string): HealthPillarId {
  for (const id of ALL_PILLARS) {
    if ((PILLAR_RATIO_NAMES[id] as readonly string[]).includes(name)) return id;
  }
  // Heuristic fallback for report-only names
  if (
    name.includes("Margin") ||
    name.includes("Growth") ||
    name.includes("Leverage") ||
    name.includes("Labor") ||
    name.includes("Customer") ||
    name.includes("Cost")
  ) {
    return "profit";
  }
  if (
    name.includes("Days") ||
    name.includes("Capital") ||
    name.includes("OCF") ||
    name.includes("Cash")
  ) {
    return "cash";
  }
  if (
    (name.includes("Equity") && !name.includes("Return")) ||
    name.includes("Multiplier") ||
    name.includes("Burden") ||
    name.includes("Debt") ||
    name.includes("Interest")
  ) {
    return "financing";
  }
  return "assets";
}

function chipLabel(status: HealthTier): string {
  return healthBandLabel(status);
}

/**
 * Profitability step chip. Same score and label as the Profit pillar
 * (`scoreRatio` + `HEALTH_BAND_TABLE`), not a private 10% / 20% scale.
 */
export function profitStepBand(
  ratioName: string,
  ratio: number,
): { tier: HealthTier; label: string } {
  const tier = scoreTier(scoreRatio(ratioName, ratio));
  return { tier, label: healthBandLabel(tier) };
}

export type ComputeOverallHealthInput = {
  /** Human-named ratio values from `computeRatios` (or equivalent). */
  ratios?: Record<string, number | null | undefined>;
  /**
   * Pre-scored ratios (e.g. scorecard `RatioResult[]`). When provided these
   * are used instead of re-scoring `ratios`.
   */
  scoredRatios?: Array<{
    name: string;
    score: number;
    pillar?: HealthPillarId;
  }>;
  cashRunwayWeeks?: number | null;
  /**
   * Cash on the balance sheet or a published bank balance.
   * `null` means there is no cash figure — runway must not score the cash pillar.
   * Omit the field to keep the previous behaviour for callers that only have runway.
   */
  cashBalance?: number | null;
  /**
   * First forecast week that closes below zero. Week 1 cannot display Healthy.
   * Zero weeks of runway cannot display Healthy either — the chip is Critical.
   */
  shortfallWeek?: number | null;
  /** Sales-per-employee uses a market-specific healthy target. Defaults ZA. */
  market?: ScoreMarket;
  /**
   * Gross margin is too high for this industry to score as Healthy.
   * The ratio stays on the statement; it does not lift the Profit pillar.
   */
  grossMarginImplausible?: boolean;
};

/**
 * Canonical overall health. Equal-weight average of pillars that have data.
 * Cash runway (when present) is blended into the cash pillar.
 */
export function computeOverallHealth(input: ComputeOverallHealthInput): OverallHealth {
  const bucket: Record<HealthPillarId, number[]> = {
    profit: [],
    assets: [],
    financing: [],
    cash: [],
  };

  const skipGross = input.grossMarginImplausible === true;
  if (input.scoredRatios?.length) {
    for (const r of input.scoredRatios) {
      if (!Number.isFinite(r.score)) continue;
      if (skipGross && r.name === "Gross Margin") continue;
      const pillar = r.pillar ?? pillarForRatioName(r.name);
      bucket[pillar].push(r.score);
    }
  } else if (input.ratios) {
    for (const [name, val] of Object.entries(input.ratios)) {
      if (skipGross && name === "Gross Margin") continue;
      const n = toFiniteNumber(val);
      if (n == null) continue;
      const scored = scoreRatio(name, n, input.market);
      if (!Number.isFinite(scored)) continue;
      const pillar = pillarForRatioName(name);
      bucket[pillar].push(scored);
    }
  }

  const cashKnown = input.cashBalance === undefined || input.cashBalance != null;
  if (cashKnown && input.cashRunwayWeeks != null && Number.isFinite(input.cashRunwayWeeks)) {
    bucket.cash.push(scoreCashRunway(input.cashRunwayWeeks));
  }

  const pillars: PillarScore[] = ALL_PILLARS.map((id) => {
    const components = bucket[id];
    const score = avg(components);
    const rounded = score == null ? null : Math.round(score);
    return {
      id,
      label: PILLAR_LABELS[id],
      score: rounded,
      status: bandedPillarStatus(rounded, components),
    };
  });

  const scoredPillars = pillars.filter((p) => p.score != null) as Array<
    PillarScore & { score: number }
  >;
  const overallRaw = avg(scoredPillars.map((p) => p.score));
  const overall = overallRaw == null ? null : Math.round(overallRaw);
  const status = scoreTier(overall);
  const hasCriticalPillar = scoredPillars.some((p) => p.status === "critical");
  let displayStatus: HealthTier = hasCriticalPillar && status === "healthy" ? "at_risk" : status;
  if (input.cashRunwayWeeks === 0) displayStatus = "critical";
  else if (input.shortfallWeek === 1 && displayStatus === "healthy") displayStatus = "at_risk";

  const weakestPillar =
    scoredPillars.length === 0
      ? null
      : ([...scoredPillars].sort((a, b) => a.score - b.score)[0] ?? null);

  return {
    overall,
    status,
    displayStatus,
    displayLabel: chipLabel(displayStatus),
    pillars,
    weakestPillar,
    hasCriticalPillar,
  };
}

function overallFromPillars(
  pillars: PillarScore[],
  extras?: { forceCritical?: boolean; flagUnscoredCash?: boolean },
): OverallHealth {
  const scored = pillars.filter((p) => p.score != null) as Array<PillarScore & { score: number }>;
  const overallRaw = avg(scored.map((p) => p.score));
  const overall = overallRaw == null ? null : Math.round(overallRaw);
  const status = scoreTier(overall);
  const hasCriticalPillar = scored.some((p) => p.status === "critical");
  let displayStatus: HealthTier = hasCriticalPillar && status === "healthy" ? "at_risk" : status;
  if (extras?.forceCritical) displayStatus = "critical";
  else if (extras?.flagUnscoredCash && displayStatus === "healthy") displayStatus = "at_risk";
  const weakestPillar =
    scored.length === 0 ? null : ([...scored].sort((a, b) => a.score - b.score)[0] ?? null);
  return {
    overall,
    status,
    displayStatus,
    displayLabel: chipLabel(displayStatus),
    pillars,
    weakestPillar,
    hasCriticalPillar,
  };
}

/**
 * Cash pillar follows the 13-week series. A closing under the floor, with a
 * real opening, is Critical and capped at 25, and the overall band is Critical
 * with it. A missing opening is not a breach: Cash is unscored and left out
 * of the average, and a Healthy overall is flagged down to Watch.
 */
export function cashPillarFollowsForecast(
  health: OverallHealth,
  input: {
    openingMissing?: boolean;
    opening?: number | null;
    closings?: readonly number[] | null;
    floor?: number | null;
    /**
     * False when the file has no synced figures and no parsed statement.
     * A flat zero series is the same case when the caller does not pass this.
     */
    hasEvidence?: boolean;
  },
): OverallHealth {
  if (input.hasEvidence === false) return health;
  if (input.openingMissing) {
    const pillars = health.pillars.map((pillar) => {
      if (pillar.id !== "cash") return pillar;
      return {
        ...pillar,
        score: null,
        status: "at_risk" as const,
        note: CASH_OPENING_UNSCORED,
      };
    });
    return overallFromPillars(pillars, { flagUnscoredCash: true });
  }
  const floor = input.floor;
  if (floor == null || !Number.isFinite(floor)) return health;
  // Thirteen zeros under the fallback floor are not a forecast. They used to
  // mint Cash 25 / Critical on a file with no books.
  const closings = input.closings ?? [];
  const openingFlat =
    input.opening == null || !Number.isFinite(input.opening) || Math.abs(input.opening) < 0.5;
  const closingsFlat = closings.every((n) => !Number.isFinite(n) || Math.abs(n) < 0.5);
  if (input.hasEvidence !== true && openingFlat && closingsFlat) return health;
  const openingUnder =
    input.opening != null && Number.isFinite(input.opening) && input.opening < floor;
  const closingUnder = (input.closings ?? []).some((n) => Number.isFinite(n) && n < floor);
  if (!openingUnder && !closingUnder) return health;

  const pillars = health.pillars.map((pillar) => {
    if (pillar.id !== "cash") return pillar;
    const score = pillar.score == null ? 25 : Math.min(pillar.score, 25);
    return { ...pillar, score, status: "critical" as const, note: null };
  });
  return overallFromPillars(pillars, { forceCritical: true });
}

/** Score (0-100) from a flat financials object shaped like `clients.financials`. */
export function scoreFromFlatFinancials(
  financials: FlatFinancials,
  cashRunwayWeeks?: number | null,
  market?: ScoreMarket,
): number | null {
  if (!financials && cashRunwayWeeks == null) return null;
  return computeOverallHealth({
    ratios: financials
      ? computeRatios(flatToRatioInputs(financials, { fyStartMonth: fyStartForScore(market) }))
      : undefined,
    cashRunwayWeeks,
    market,
  }).overall;
}

/** Full OverallHealth from flat financials — for chips that need the critical-pillar tell. */
export function healthFromFlatFinancials(
  financials: FlatFinancials,
  cashRunwayWeeks?: number | null,
  market?: ScoreMarket,
): OverallHealth {
  return computeOverallHealth({
    ratios: financials
      ? computeRatios(flatToRatioInputs(financials, { fyStartMonth: fyStartForScore(market) }))
      : undefined,
    cashRunwayWeeks,
    market,
  });
}

/** Score (0-100) from a full `RatioInputs` snapshot. */
export function scoreFromRatioInputs(
  inputs: RatioInputs,
  cashRunwayWeeks?: number | null,
  market?: ScoreMarket,
): number | null {
  return computeOverallHealth({
    ratios: computeRatios(inputs),
    cashRunwayWeeks,
    market,
  }).overall;
}

export function healthFromRatioInputs(
  inputs: RatioInputs,
  cashRunwayWeeks?: number | null,
  market?: ScoreMarket,
  shortfallWeek?: number | null,
): OverallHealth {
  return computeOverallHealth({
    ratios: computeRatios(inputs),
    cashRunwayWeeks,
    market,
    shortfallWeek,
  });
}

/**
 * No evidence. Overall and every pillar stay null. The ring says "Not scored yet".
 * A critical band is not invented from the fallback floor.
 */
export function healthWithoutEvidence(health: OverallHealth): OverallHealth {
  return {
    overall: null,
    status: "at_risk",
    displayStatus: "at_risk",
    displayLabel: NOT_SCORED_YET_LABEL,
    pillars: health.pillars.map((pillar) => ({
      ...pillar,
      score: null,
      status: "at_risk",
      note: NOT_SCORED_YET_LABEL,
    })),
    weakestPillar: null,
    hasCriticalPillar: false,
  };
}

export { scoreTier };

export type TrendPoint = { score: number; isEstimated: boolean };

/**
 * Builds an 8-point trend from real `client_score_history` rows (most recent
 * last). When there is less real history than 8 points, the earliest known
 * real score is repeated backward to fill the gap so the sparkline still
 * renders — those padded points are flagged `isEstimated: true` so the UI
 * can visibly mark them (e.g. dashed/lighter) instead of presenting them as
 * real history.
 */
export function buildTrend(
  history: { score: number; is_estimated: boolean }[],
  targetLength = 8,
): TrendPoint[] {
  if (history.length === 0) return [];
  const real = history.map((h) => ({ score: h.score, isEstimated: h.is_estimated }));
  if (real.length >= targetLength) return real.slice(-targetLength);
  const padCount = targetLength - real.length;
  const pad = Array.from({ length: padCount }, () => ({
    score: real[0].score,
    isEstimated: true,
  }));
  return [...pad, ...real];
}
