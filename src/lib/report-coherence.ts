/**
 * Report-layer coherence. Waterfall priors, the equity roll-forward, cash-cycle
 * copy, scorecard counts, pillar ties, and return labels all live here so the
 * PDF components and the narratives cannot drift.
 *
 * Bands and ratio definitions stay in `ratios.ts`. This module does not invent
 * a second cutoff table.
 */

import { scoreRatio } from "@/lib/health-score";
import {
  equityMultiplierRatio,
  healthBandLabel,
  interestBurdenRatio,
  ocfToEbitdaRatio,
  roeIsMeaningful,
  scoreTier,
  taxBurdenRatio,
  type HealthTier,
} from "@/lib/ratios";

export const NO_PRIOR_PERIOD = "No prior period";
export const NO_HISTORY_YET = "No history yet";
export const NOT_SCORED = "Not scored";
export const ROE_TOO_SMALL = "n/a — equity too small to be meaningful";

/** Pillar order used when two pillars share a score. Earlier wins. */
export const PILLAR_TIE_ORDER = ["profit", "assets", "financing", "cash"] as const;

export type PillarId = (typeof PILLAR_TIE_ORDER)[number];

const PILLAR_RANK = new Map<string, number>(PILLAR_TIE_ORDER.map((id, i) => [id, i]));

export type ScoredPillar = { id?: string; label: string; score: number };

function pillarRank(p: ScoredPillar): number {
  if (p.id && PILLAR_RANK.has(p.id)) return PILLAR_RANK.get(p.id)!;
  return PILLAR_TIE_ORDER.length;
}

/**
 * Highest score is strongest; lowest is weakest.
 * A tie goes to the earlier pillar in `PILLAR_TIE_ORDER` (profit, then assets,
 * then financing, then cash) so the headline box and the narrative name the
 * same pillar.
 */
export function pickPillarExtreme(
  pillars: readonly ScoredPillar[],
  which: "strongest" | "weakest",
): ScoredPillar | null {
  const scored = pillars.filter((p) => Number.isFinite(p.score));
  if (!scored.length) return null;
  const sorted = [...scored].sort((a, b) => {
    if (a.score !== b.score) return which === "strongest" ? b.score - a.score : a.score - b.score;
    return pillarRank(a) - pillarRank(b);
  });
  return sorted[0] ?? null;
}

/** Subtitle and "of N tracked" both print this count — the rows on the scorecard. */
export function scorecardCountCopy(count: number): { subtitle: string; tracked: string } {
  const n = Math.max(0, Math.round(count));
  const word = n === 1 ? "ratio" : "ratios";
  return {
    subtitle: `One score, four pillars, ${n} ${word} — the state of the business at a glance`,
    tracked: `of ${n} tracked`,
  };
}

export type PeriodFigures = {
  revenue?: number | null;
  netIncome?: number | null;
  equity?: number | null;
};

function finiteOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(a) * 0.001);
}

/**
 * A snapshot is not a prior period when it is the current statement, or when
 * its revenue and profit are a copy of the current file.
 */
export function priorFiguresAreCopy(
  current: PeriodFigures | null | undefined,
  prior: PeriodFigures | null | undefined,
): boolean {
  if (!current || !prior) return false;
  const pairs: Array<[number | null, number | null]> = [
    [finiteOrNull(current.revenue), finiteOrNull(prior.revenue)],
    [finiteOrNull(current.netIncome), finiteOrNull(prior.netIncome)],
  ];
  const comparable = pairs.filter((p): p is [number, number] => p[0] != null && p[1] != null);
  if (comparable.length < 2) return false;
  return comparable.every(([a, b]) => closeEnough(a, b));
}

export function priorMarginsDiffer(current: number, prior: number): boolean {
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return false;
  return Math.abs(current - prior) > 0.0005;
}

export type EquityRollForward = {
  hasPrior: boolean;
  opening: number | null;
  profit: number;
  drawings: number;
  /** Plug so closing = opening + profit − drawings + other. Zero when there is no prior. */
  other: number;
  closing: number;
  /** Closing − opening. Null when opening is unknown — never a fake +0. */
  movement: number | null;
  retained: number;
};

/**
 * Opening + period profit − drawings ± other movements = closing.
 * When no distinct prior equity exists, opening stays unknown. Callers must
 * not copy closing into opening.
 */
export function equityRollForward(input: {
  closingEquity: number;
  periodProfit: number;
  drawings: number;
  priorEquity: number | null;
}): EquityRollForward {
  const profit = Number.isFinite(input.periodProfit) ? input.periodProfit : 0;
  const drawings = Number.isFinite(input.drawings) ? input.drawings : 0;
  const closing = Number.isFinite(input.closingEquity) ? input.closingEquity : 0;
  const retained = profit - drawings;
  const prior = input.priorEquity;
  if (prior == null || !Number.isFinite(prior)) {
    return {
      hasPrior: false,
      opening: null,
      profit,
      drawings,
      other: 0,
      closing,
      movement: null,
      retained,
    };
  }
  const other = closing - (prior + profit - drawings);
  return {
    hasPrior: true,
    opening: prior,
    profit,
    drawings,
    other,
    closing,
    movement: closing - prior,
    retained,
  };
}

export type CashCycleStory = {
  supplierFunded: boolean;
  /** Prose before any profile coda. */
  sentence: string;
  /** Headline for cash trapped. Null means do not quote a release figure. */
  dayRelease: number | null;
  trapped: number;
};

/**
 * Negative cycle: suppliers fund the business. There is no financing gap, so
 * the "cash trapped" and "each day saved releases" lines must not invent a
 * positive release against a zero trapped balance.
 */
export function cashCycleStory(input: {
  ccc: number;
  /** Annual revenue ÷ 365. Used only when the cycle is positive. */
  dailyRevenue: number;
  formatMoney: (n: number) => string;
  formatUnit: (n: number) => string;
}): CashCycleStory {
  const ccc = Number.isFinite(input.ccc) ? input.ccc : 0;
  const daily = Number.isFinite(input.dailyRevenue) ? Math.max(0, input.dailyRevenue) : 0;
  if (ccc < 0) {
    const days = Math.abs(Math.round(ccc));
    const tier = scoreTier(scoreRatio("Working Capital Days", ccc));
    const band = healthBandLabel(tier);
    const extreme =
      tier === "critical"
        ? ` That is beyond normal terms — the band is ${band}, and those supplier terms are a risk if they tighten.`
        : ` The cycle is ${band}.`;
    return {
      supplierFunded: true,
      trapped: 0,
      dayRelease: null,
      sentence:
        `Suppliers fund this business: cash comes back ${days} days before suppliers are paid, ` +
        `so there is no financing gap and no cash trapped in the cycle.${extreme}`,
    };
  }
  const trapped = daily * ccc;
  const rounded = Math.round(ccc);
  const tier = scoreTier(scoreRatio("Working Capital Days", ccc));
  const band = healthBandLabel(tier);
  const unit1 = input.formatUnit(1);
  return {
    supplierFunded: false,
    trapped,
    dayRelease: ccc > 0 ? daily : null,
    sentence:
      `It takes ${rounded} days for ${unit1} spent to return as cash — the cycle is ${band}. ` +
      `${input.formatMoney(trapped)} is trapped in working capital` +
      (ccc > 0 ? `; each day saved releases ${input.formatMoney(daily)}.` : "."),
  };
}

export type ReturnPresentation = {
  /** Shown in the ratio value column. */
  text: string;
  /** Short figure for a headline box: the percent, or "n/a". */
  headline: string;
  /** Null when the figure must not be scored. */
  scoredValue: number | null;
  note: string | null;
  unscored: boolean;
};

/**
 * Label a flow return that `computeRatios` has already annualised.
 * Tiny equity is not scored. A short or part month says so in the label.
 */
export function presentReturn(input: {
  ratioName: "Return on Equity" | "Return on Assets";
  /** Annualised ratio from `computeRatios` (0.363 = 363%). */
  value: number;
  equity?: number | null;
  currency?: string | null;
  periodMonths?: number | null;
  partMonth?: boolean;
}): ReturnPresentation {
  const months = input.periodMonths != null && input.periodMonths > 0 ? input.periodMonths : 12;
  const bits: string[] = [];
  if (input.partMonth) bits.push("part-month");
  if (months < 12) bits.push("annualised");
  const note = bits.length ? bits.join(", ") : null;

  if (input.ratioName === "Return on Equity") {
    const equity = input.equity;
    if (equity == null || !roeIsMeaningful(equity, input.currency)) {
      return { text: ROE_TOO_SMALL, headline: "n/a", scoredValue: null, note: null, unscored: true };
    }
  }
  if (!Number.isFinite(input.value)) {
    return { text: "—", headline: "—", scoredValue: null, note, unscored: true };
  }
  const pct = `${(input.value * 100).toFixed(1)}%`;
  return {
    text: note ? `${pct} · ${note}` : pct,
    headline: pct,
    scoredValue: input.value,
    note,
    unscored: false,
  };
}

export type MovementVerdict = "improving" | "stable" | "declining_most" | "declining_all" | "no_history";

export function movementVerdict(input: {
  current: number;
  three_months: number | null;
  six_months: number | null;
  twelve_months: number | null;
  lower_is_better?: boolean;
}): MovementVerdict {
  const series = [input.twelve_months, input.six_months, input.three_months, input.current].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (series.length < 2) return "no_history";
  const dirGood = (a: number, b: number) => (input.lower_is_better ? b < a : b > a);
  let good = 0;
  let bad = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i] === series[i - 1]) continue;
    if (dirGood(series[i - 1], series[i])) good++;
    else bad++;
  }
  if (bad === 0 && good > 0) return "improving";
  if (good === 0 && bad >= 2) return "declining_all";
  if (bad > good) return "declining_most";
  return "stable";
}

export const MOVEMENT_VERDICT_LABEL: Record<MovementVerdict, string> = {
  improving: "IMPROVING",
  stable: "STABLE",
  declining_most: "SLIPPING",
  declining_all: "DECLINING",
  no_history: "n/a",
};

/** Band for a DuPont lever. Null when the value cannot be scored. */
export function leverBand(ratioName: string, value: number): HealthTier | null {
  if (!Number.isFinite(value)) return null;
  const score = scoreRatio(ratioName, value);
  if (!Number.isFinite(score)) return null;
  return scoreTier(score);
}

export function burdenDisplay(kind: "interest" | "tax", ebit: number, ebt: number, netIncome: number): number {
  return kind === "interest" ? interestBurdenRatio(ebit, ebt) : taxBurdenRatio(ebt, netIncome);
}

/**
 * Ratios that stay on the scorecard when the input is missing. A blank cash
 * flow is "Not scored", never 0.00×. Everything else is omitted until it exists.
 */
const LIST_WHEN_MISSING = new Set([
  "OCF / EBITDA",
  "Interest Burden",
  "Tax Burden",
  "Equity Multiplier",
  "Return on Equity",
  "Return on Assets",
]);

export type ScorecardPresentation = {
  include: boolean;
  text: string | null;
  headline: string | null;
  scoredValue: number | null;
  note: string | null;
  unscored: boolean;
};

/** One presentation for the scorecard row, the DuPont strip, and the asset report. */
export function presentScorecardRatio(input: {
  name: string;
  value: number;
  equity?: number | null;
  currency?: string | null;
  periodMonths?: number | null;
  partMonth?: boolean;
}): ScorecardPresentation {
  if (input.name === "Return on Equity" || input.name === "Return on Assets") {
    const presented = presentReturn({
      ratioName: input.name,
      value: input.value,
      equity: input.equity,
      currency: input.currency,
      periodMonths: input.periodMonths,
      partMonth: input.partMonth,
    });
    return {
      include: true,
      text: presented.text,
      headline: presented.headline,
      scoredValue: presented.scoredValue,
      note: presented.note,
      unscored: presented.unscored,
    };
  }
  if (!Number.isFinite(input.value)) {
    if (!LIST_WHEN_MISSING.has(input.name)) {
      return { include: false, text: null, headline: null, scoredValue: null, note: null, unscored: true };
    }
    return { include: true, text: "—", headline: "—", scoredValue: null, note: null, unscored: true };
  }
  return {
    include: true,
    text: null,
    headline: null,
    scoredValue: input.value,
    note: null,
    unscored: false,
  };
}

export { equityMultiplierRatio, ocfToEbitdaRatio, healthBandLabel };
