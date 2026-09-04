/**
 * Auto-generated executive-summary narratives driven by computed ratios and
 * health tiers. Pure functions — no react-pdf imports, safe anywhere.
 */

import { fmtPct, fmtRandCompact, tierForScore } from "@/components/pdf/theme";
import type { ClientOperatingProfile } from "@/lib/client-profile";
import { currencySymbol, formatMoneyUnit, ZA_MARKET, type ResolvedMarket } from "@/lib/market";
import { reportProfileCoda, type ReportNarrativeKind } from "@/lib/profile-signals";

type MoneyMarket = Pick<ResolvedMarket, "currency" | "locale" | "copyPack">;

export type NarrativeProfile = ClientOperatingProfile | null | undefined;

function withCoda(
  base: string,
  profile: NarrativeProfile,
  kind: ReportNarrativeKind,
  market: MoneyMarket = ZA_MARKET,
): string {
  const coda = reportProfileCoda(profile, kind, market);
  return coda ? `${base} ${coda}` : base;
}

export type DuPontLevers = {
  roe: number;
  netMargin: number;
  assetTurnover: number;
  equityMultiplier: number;
};

export type DuPontDiagnosis = {
  /** Which lever is dragging ROE. */
  weakLever: "margin" | "turnover" | "leverage" | null;
  weakLeverLabel: string;
  sentence: string;
};

/**
 * Diagnose which DuPont lever is dragging ROE.
 * Benchmarks: net margin healthy ≥ 10%, asset turnover healthy ≥ 1.0×,
 * equity multiplier comfortable ≤ 2.5× (higher = leverage risk).
 */
export function diagnoseDuPont(l: DuPontLevers): DuPontDiagnosis {
  const gaps: { lever: "margin" | "turnover" | "leverage"; label: string; gap: number }[] = [];
  if (Number.isFinite(l.netMargin)) {
    gaps.push({
      lever: "margin",
      label: "Net Profit Margin",
      gap: Math.max(0, (0.1 - l.netMargin) / 0.1),
    });
  }
  if (Number.isFinite(l.assetTurnover)) {
    gaps.push({
      lever: "turnover",
      label: "Asset Turnover",
      gap: Math.max(0, (1.0 - l.assetTurnover) / 1.0),
    });
  }
  if (Number.isFinite(l.equityMultiplier)) {
    gaps.push({
      lever: "leverage",
      label: "Equity Multiplier",
      gap: Math.max(0, (l.equityMultiplier - 2.5) / 2.5),
    });
  }
  gaps.sort((a, b) => b.gap - a.gap);
  const worst = gaps[0];
  if (!worst || worst.gap <= 0.05) {
    return {
      weakLever: null,
      weakLeverLabel: "",
      sentence:
        "All three ROE levers — margin, asset efficiency, and leverage — are in balanced, healthy territory.",
    };
  }
  const explain: Record<string, string> = {
    margin: `thin profitability (net margin ${fmtPct(l.netMargin)}) is the main drag on shareholder returns`,
    turnover: `sluggish asset efficiency (turnover ${l.assetTurnover.toFixed(2)}×) is the main drag on shareholder returns`,
    leverage: `elevated leverage (equity multiplier ${l.equityMultiplier.toFixed(2)}×) is inflating risk rather than returns`,
  };
  return {
    weakLever: worst.lever,
    weakLeverLabel: worst.label,
    sentence: `Of the three ROE levers, ${explain[worst.lever]}.`,
  };
}

// ── Per-report narratives ──────────────────────────────────────────────────

const TIER_PHRASE = {
  healthy: "in healthy territory",
  at_risk: "under pressure and worth watching",
  critical: "in critical territory and needs immediate attention",
} as const;

export function healthNarrative(
  overallScore: number,
  pillars: { label: string; score: number }[],
  dupont: DuPontDiagnosis,
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const sorted = [...pillars].filter((p) => Number.isFinite(p.score)).sort((a, b) => a.score - b.score);
  const weakest = sorted[0];
  const strongest = sorted[sorted.length - 1];
  if (!weakest || !strongest || !Number.isFinite(overallScore)) {
    return withCoda(
      "Not enough scored ratios yet to write a health narrative — add the missing figures first.",
      profile,
      "health",
      market,
    );
  }
  const tier = tierForScore(overallScore);
  const opening =
    tier === "healthy"
      ? `At ${Math.round(overallScore)}/100, the business is fundamentally sound.`
      : tier === "at_risk"
        ? `At ${Math.round(overallScore)}/100, the business is stable but showing strain.`
        : `At ${Math.round(overallScore)}/100, key indicators point to significant financial stress.`;
  const base =
    `${opening} ${strongest.label} is the strongest pillar (${Math.round(strongest.score)}), ` +
    `while ${weakest.label} is ${TIER_PHRASE[tierForScore(weakest.score)]} at ${Math.round(weakest.score)}. ` +
    dupont.sentence;
  return withCoda(base, profile, "health", market);
}

export function profitabilityNarrative(
  d: {
    revenue: number;
    net_profit: number;
    gross_margin_pct: number;
    net_margin_pct: number;
    priorNetMargin?: number;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const kept = d.net_margin_pct * 100;
  const trendBit =
    d.priorNetMargin !== undefined
      ? d.net_margin_pct >= d.priorNetMargin
        ? ` Net margin improved from ${fmtPct(d.priorNetMargin)} last period.`
        : ` Net margin slipped from ${fmtPct(d.priorNetMargin)} last period — the bridge below shows where the leakage sits.`
      : "";
  const verdict =
    kept >= 10
      ? "a strong conversion of sales into profit"
      : kept >= 5
        ? "an adequate but improvable conversion of sales into profit"
        : "a thin conversion that leaves little buffer for shocks";
  const sym = currencySymbol(market);
  const unit100 = `${sym}100`;
  const keptUnit = `${sym}${kept.toFixed(2)}`;
  const base =
    `Of every ${unit100} earned, ${keptUnit} reaches the bottom line — ${verdict}. ` +
    `Gross margin stands at ${fmtPct(d.gross_margin_pct)} on revenue of ${fmtRandCompact(d.revenue, market)}.` +
    trendBit;
  return withCoda(base, profile, "profit", market);
}

export function cashForecastNarrative(
  d: {
    runwayWeeks: number;
    minBalance: number;
    threshold: number;
    weeksBelow: number;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const runwayBit =
    d.runwayWeeks >= 13
      ? `Cash remains above the danger threshold across the full 13-week horizon`
      : `Projected runway is ${d.runwayWeeks} weeks`;
  const lowBit =
    d.weeksBelow > 0
      ? ` The balance dips below the ${fmtRandCompact(d.threshold, market)} minimum in ${d.weeksBelow} week${d.weeksBelow > 1 ? "s" : ""}, bottoming out at ${fmtRandCompact(d.minBalance, market)} — the shaded danger zone on the chart marks where action is needed.`
      : ` The lowest projected balance is ${fmtRandCompact(d.minBalance, market)}, comfortably above the ${fmtRandCompact(d.threshold, market)} minimum.`;
  return withCoda(`${runwayBit}.${lowBit}`, profile, "forecast", market);
}

export function cashCycleNarrative(
  d: {
    ccc: number;
    cccPrior?: number;
    cashTrapped: number;
    dailyRevenue: number;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const trend =
    d.cccPrior !== undefined
      ? d.ccc <= d.cccPrior
        ? ` — ${d.cccPrior - d.ccc} days faster than last period`
        : ` — ${d.ccc - d.cccPrior} days slower than last period`
      : "";
  const verdict =
    d.ccc <= 45
      ? "an efficient cycle"
      : d.ccc <= 75
        ? "a moderate cycle with room to tighten"
        : "a slow cycle that is starving the business of cash";
  const unit1 = formatMoneyUnit(1, market);
  const base =
    `It takes ${d.ccc} days for ${unit1} spent to return as cash${trend} — ${verdict}. ` +
    `${fmtRandCompact(d.cashTrapped, market)} is currently trapped in working capital; every 1-day improvement releases roughly ${fmtRandCompact(d.dailyRevenue, market)}.`;
  return withCoda(base, profile, "cycle", market);
}

export function leverageNarrative(
  d: {
    debtToEquity: number;
    totalDebt: number;
    totalEquity: number;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const verdict =
    d.debtToEquity <= 1
      ? "a conservative structure with headroom to borrow if growth requires it"
      : d.debtToEquity <= 2
        ? "a balanced structure, though further borrowing should be weighed carefully"
        : "a leveraged structure where debt reduction should take priority";
  const base =
    `The business carries ${fmtRandCompact(d.totalDebt, market)} of debt against ${fmtRandCompact(d.totalEquity, market)} of equity ` +
    `(${d.debtToEquity.toFixed(2)}× debt-to-equity) — ${verdict}.`;
  return withCoda(base, profile, "leverage", market);
}

export function laborNarrative(
  d: {
    revenuePerEmployee: number;
    gpPerLaborRand: number;
    realGrowth: number;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const unit1 = formatMoneyUnit(1, market);
  const gpUnit = `${currencySymbol(market)}${d.gpPerLaborRand.toFixed(2)}`;
  const floorUnit = `${currencySymbol(market)}0.50`;
  const gpBit =
    d.gpPerLaborRand >= 0.5
      ? `Each ${unit1} of wages generates ${gpUnit} of gross profit — a productive team.`
      : `Each ${unit1} of wages generates only ${gpUnit} of gross profit, below the ${floorUnit} comfort level.`;
  const growthBit =
    d.realGrowth > 0
      ? ` Revenue is outpacing inflation by ${fmtPct(d.realGrowth)} in real terms.`
      : ` Revenue growth is trailing inflation by ${fmtPct(Math.abs(d.realGrowth))} — pricing needs attention.`;
  return withCoda(
    `Revenue per employee stands at ${fmtRandCompact(d.revenuePerEmployee, market)}. ${gpBit}${growthBit}`,
    profile,
    "labor",
    market,
  );
}

export function movementNarrative(
  counts: {
    improving: number;
    decliningAll: number;
    decliningMost: number;
    total: number;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const declining = counts.decliningAll + counts.decliningMost;
  if (counts.total === 0) {
    return withCoda(
      "No ratio history is available yet — upload further periods to unlock trend analysis.",
      profile,
      "movement",
      market,
    );
  }
  const opening = `${counts.improving} of ${counts.total} tracked ratios are improving`;
  const declineBit =
    declining > 0
      ? `, while ${declining} show${declining === 1 ? "s" : ""} a sustained decline${counts.decliningAll > 0 ? ` (${counts.decliningAll} deteriorating across every period on record)` : ""}. The highlighted rows below deserve first attention.`
      : `, with no ratio in sustained decline — momentum is on the business's side.`;
  return withCoda(opening + declineBit, profile, "movement", market);
}

export function benchmarkNarrative(
  d: {
    topQ: number;
    above: number;
    below: number;
    total: number;
    industryName: string;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const aboveOrTop = d.topQ + d.above;
  const standing =
    aboveOrTop >= d.total * 0.7
      ? "an upper-tier performer in its sector"
      : aboveOrTop >= d.total * 0.4
        ? "a mid-pack performer with clear areas to close on the leaders"
        : "trailing its sector on most measures — the gaps below map the catch-up agenda";
  const medianLabel = market.copyPack === "us" ? "global SME bands" : "the sector median";
  const base =
    `Against ${d.industryName} peers, ${aboveOrTop} of ${d.total} ratios sit at or above ${medianLabel}` +
    `${d.topQ > 0 ? ` and ${d.topQ} reach${d.topQ === 1 ? "es" : ""} the top quartile` : ""}, making the business ${standing}.`;
  return withCoda(base, profile, "benchmark", market);
}

export function interventionNarrative(
  d: {
    critical: number;
    atRisk: number;
    total: number;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  if (d.total === 0) {
    return withCoda(
      "No intervention steps are required at present — all tracked ratios are healthy.",
      profile,
      "intervention",
      market,
    );
  }
  const urgency =
    d.critical > 0
      ? `${d.critical} step${d.critical > 1 ? "s" : ""} address${d.critical === 1 ? "es" : ""} critical ratios and should start immediately`
      : "no ratio is in critical territory, so this plan is about prevention rather than rescue";
  const base =
    `This roadmap prioritises ${d.total} action step${d.total > 1 ? "s" : ""} by severity and impact: ${urgency}` +
    `${d.atRisk > 0 ? `, with ${d.atRisk} further step${d.atRisk > 1 ? "s" : ""} targeting at-risk measures` : ""}.`;
  return withCoda(base, profile, "intervention", market);
}

export function assetNarrative(
  l: DuPontLevers,
  dupont: DuPontDiagnosis,
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const roeBit = Number.isFinite(l.roe)
    ? `Return on equity stands at ${fmtPct(l.roe)}${l.roe >= 0.15 ? " — a strong return on the owners' capital" : l.roe >= 0.08 ? " — a moderate return with room to build" : " — below what the owners' capital should earn"}.`
    : "Return on equity is not meaningful this period (negative or nil equity base).";
  return withCoda(
    `${roeBit} ${dupont.sentence} The decomposition below shows exactly which lever to work.`,
    profile,
    "assets",
    market,
  );
}
