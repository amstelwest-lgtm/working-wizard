/**
 * Auto-generated executive-summary narratives driven by computed ratios and
 * health tiers. Pure functions — no react-pdf imports, safe anywhere.
 */

import { fmtPct, fmtRandCompact } from "@/components/pdf/theme";
import type { ClientOperatingProfile } from "@/lib/client-profile";
import { formatMoney, formatMoneyUnit, spellForMarket, spellLabor, ZA_MARKET, type ResolvedMarket } from "@/lib/market";
import { reportProfileCoda, type ReportNarrativeKind } from "@/lib/profile-signals";
import { scoreRatio } from "@/lib/health-score";
import { healthBandLabel, scoreTier, type HealthTier } from "@/lib/ratios";
import {
  cashCycleStory,
  leverBand,
  NO_HISTORY_YET,
  pickPillarExtreme,
  priorMarginsDiffer,
  ROE_TOO_SMALL,
  type ScoredPillar,
} from "@/lib/report-coherence";

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

const LEVER_RATIO: Record<"margin" | "turnover" | "leverage", { name: string; label: string }> = {
  margin: { name: "Net Margin", label: "Net Profit Margin" },
  turnover: { name: "Asset Turnover", label: "Asset Turnover" },
  leverage: { name: "Equity Multiplier", label: "Equity Multiplier" },
};

const TIER_RANK: Record<HealthTier, number> = { healthy: 0, at_risk: 1, critical: 2 };

/**
 * Which DuPont lever is weakest, using `scoreRatio` and the shared band table.
 * "All three healthy" is only true when every lever's band is Healthy.
 */
export function diagnoseDuPont(l: DuPontLevers): DuPontDiagnosis {
  const values = {
    margin: l.netMargin,
    turnover: l.assetTurnover,
    leverage: l.equityMultiplier,
  };
  const ranked = (Object.keys(LEVER_RATIO) as Array<keyof typeof LEVER_RATIO>)
    .map((lever) => {
      const spec = LEVER_RATIO[lever];
      const value = values[lever];
      const tier = leverBand(spec.name, value);
      return { lever, label: spec.label, value, tier };
    })
    .filter((row) => row.tier != null);
  if (!ranked.length) {
    return {
      weakLever: null,
      weakLeverLabel: "",
      sentence: "The ROE levers cannot be scored from the figures on file.",
    };
  }
  if (ranked.length === 3 && ranked.every((row) => row.tier === "healthy")) {
    return {
      weakLever: null,
      weakLeverLabel: "",
      sentence:
        "All three ROE levers — margin, asset efficiency, and leverage — are in the Healthy band.",
    };
  }
  ranked.sort((a, b) => TIER_RANK[b.tier!] - TIER_RANK[a.tier!]);
  const worst = ranked[0];
  const band = healthBandLabel(worst.tier!);
  const detail =
    worst.lever === "margin"
      ? `net margin ${fmtPct(worst.value)}`
      : worst.lever === "turnover"
        ? `turnover ${worst.value.toFixed(2)}×`
        : `equity multiplier ${worst.value.toFixed(2)}×`;
  return {
    weakLever: worst.lever,
    weakLeverLabel: worst.label,
    sentence: `Of the three ROE levers, ${worst.label.toLowerCase()} is ${band} (${detail}).`,
  };
}

// ── Per-report narratives ──────────────────────────────────────────────────

export function healthNarrative(
  overallScore: number,
  pillars: ScoredPillar[],
  dupont: DuPontDiagnosis,
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
  /** Display band from `computeOverallHealth`. The raw score must not pick a different band. */
  overallTier?: HealthTier | null,
): string {
  const strongest = pickPillarExtreme(pillars, "strongest");
  const weakest = pickPillarExtreme(pillars, "weakest");
  const tier = overallTier ?? (Number.isFinite(overallScore) ? scoreTier(overallScore) : null);
  if (!weakest || !strongest || !tier || !Number.isFinite(overallScore)) {
    return withCoda(
      "Not enough scored ratios yet to write a health narrative — add the missing figures first.",
      profile,
      "health",
      market,
    );
  }
  const overallBand = healthBandLabel(tier);
  const weakBand = healthBandLabel(scoreTier(weakest.score));
  const base =
    `At ${Math.round(overallScore)}/100 the overall band is ${overallBand}. ` +
    `${strongest.label} is the strongest pillar (${Math.round(strongest.score)}), ` +
    `while ${weakest.label} is ${weakBand} at ${Math.round(weakest.score)}. ` +
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
    d.priorNetMargin !== undefined && priorMarginsDiffer(d.net_margin_pct, d.priorNetMargin)
      ? d.net_margin_pct > d.priorNetMargin
        ? ` Net margin improved from ${fmtPct(d.priorNetMargin)} last period.`
        : ` Net margin slipped from ${fmtPct(d.priorNetMargin)} last period — the bridge below shows where the leakage sits.`
      : "";
  const marginTier = scoreTier(scoreRatio("Net Margin", d.net_margin_pct));
  const marginBand = healthBandLabel(marginTier);
  const verdict = `net margin in the ${marginBand} band`;
  const unit100 = formatMoney(100, market);
  const keptUnit = formatMoney(kept, market, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  const base =
    `Of every ${unit100} earned, ${keptUnit} reaches the bottom line — ${verdict}. ` +
    `Gross margin stands at ${fmtPct(d.gross_margin_pct)} on revenue of ${fmtRandCompact(d.revenue, market)}.` +
    trendBit;
  return withCoda(base, profile, "profit", market);
}

export function cashForecastNarrative(
  d: {
    runwayWeeks: number | null;
    /** True when the business is not burning cash. Never phrase that as 0 weeks. */
    cashGenerative?: boolean;
    minBalance: number;
    threshold: number;
    /** Count of weeks whose closing is under the minimum. */
    weeksBelow: number;
    /** 1-based week of the first closing under the minimum. */
    firstBreachWeek?: number | null;
    /** Opening itself is under the floor. Closings may still clear it. */
    opensBelow?: boolean;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const floor = fmtRandCompact(d.threshold, market);
  const trough = fmtRandCompact(d.minBalance, market);
  const closingDip = d.weeksBelow > 0 && d.firstBreachWeek != null;
  const openingUnderFloor =
    !closingDip &&
    (d.opensBelow === true || (d.opensBelow !== false && d.minBalance < d.threshold));
  const runwayBit = openingUnderFloor
    ? `The opening balance is under the ${floor} minimum`
    : d.cashGenerative
      ? `The business is cash generative, so runway is not counted down to zero`
      : d.runwayWeeks == null
        ? `Runway cannot be read from the figures yet`
        : d.runwayWeeks >= 13
          ? `Projected runway covers the full 13-week horizon`
          : `Projected runway is ${d.runwayWeeks} week${d.runwayWeeks === 1 ? "" : "s"}`;
  const lowBit = openingUnderFloor
    ? ` The lowest projected balance is ${trough}, below the ${floor} minimum.`
    : closingDip
      ? ` The balance first dips below the ${floor} minimum in week ${d.firstBreachWeek} and sits under that line for ${d.weeksBelow} week${d.weeksBelow === 1 ? "" : "s"}, bottoming out at ${trough}.`
      : ` The lowest projected balance is ${trough}, above the ${floor} minimum across the horizon.`;
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
  const story = cashCycleStory({
    ccc: d.ccc,
    dailyRevenue: d.dailyRevenue,
    formatMoney: (n) => fmtRandCompact(n, market),
    formatUnit: (n) => formatMoneyUnit(n, market),
  });
  const trend =
    !story.supplierFunded && d.cccPrior !== undefined
      ? d.ccc <= d.cccPrior
        ? ` ${d.cccPrior - d.ccc} days faster than last period.`
        : ` ${d.ccc - d.cccPrior} days slower than last period.`
      : "";
  return withCoda(`${story.sentence}${trend}`, profile, "cycle", market);
}

export function leverageNarrative(
  d: {
    /** Assets ÷ equity. The same figure the ratio row prints. */
    equityMultiplier: number;
    debtToEquity: number | null;
    totalDebt: number;
    totalEquity: number;
    debtCaptured: boolean;
    /** True when debt-to-equity is total liabilities ÷ equity, not the facility schedule. */
    debtFromLiabilities?: boolean;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const em = Number.isFinite(d.equityMultiplier)
    ? `${d.equityMultiplier.toFixed(2)}×`
    : "n/a";
  const emBand = Number.isFinite(d.equityMultiplier)
    ? healthBandLabel(scoreTier(scoreRatio("Equity Multiplier", d.equityMultiplier)))
    : null;
  const multiplierBit = emBand
    ? `The equity multiplier is ${em} (assets ÷ equity), ${emBand}.`
    : `The equity multiplier is ${em}.`;
  const liabilityDe =
    d.debtFromLiabilities && d.debtToEquity != null && Number.isFinite(d.debtToEquity)
      ? ` Debt-to-equity is ${d.debtToEquity.toFixed(2)}× on extracted total liabilities${
          d.debtCaptured ? "." : ". Interest-bearing facilities are not on file."
        }`
      : null;
  const debtBit = liabilityDe
    ? liabilityDe
    : !d.debtCaptured
      ? " No debt facilities are on file, and total liabilities were not extracted, so debt-to-equity is not scored."
      : d.totalDebt <= 0
        ? ` No debt is recorded against ${fmtRandCompact(d.totalEquity, market)} of equity.`
        : ` Debt is ${fmtRandCompact(d.totalDebt, market)} against ${fmtRandCompact(d.totalEquity, market)} of equity (${(d.debtToEquity ?? 0).toFixed(2)}× debt-to-equity, ${healthBandLabel(scoreTier(scoreRatio("Debt-to-Equity", d.debtToEquity ?? NaN)))}).`;
  return withCoda(multiplierBit + debtBit, profile, "leverage", market);
}

export function laborNarrative(
  d: {
    revenuePerEmployee: number;
    gpPerLaborRand: number;
    /** Null when prior revenue or inflation is missing. Zero is a real result. */
    realGrowth: number | null;
    headcountKnown?: boolean;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const unit1 = formatMoneyUnit(1, market);
  const headcountKnown = d.headcountKnown !== false && Number.isFinite(d.revenuePerEmployee);
  const gpKnown = Number.isFinite(d.gpPerLaborRand) && d.gpPerLaborRand > 0;
  const gpBand = gpKnown
    ? healthBandLabel(scoreTier(scoreRatio("Gross Profit / Labor", d.gpPerLaborRand)))
    : null;
  const rpeBit = headcountKnown
    ? `Revenue per employee stands at ${fmtRandCompact(d.revenuePerEmployee, market)}.`
    : `Revenue per employee is not scored — headcount is not on the file.`;
  const gpBit = gpKnown
    ? `Each ${unit1} of wages generates ${fmtRandCompact(d.gpPerLaborRand, market)} of gross profit — Gross Profit / Labor is ${gpBand}.`
    : `Gross profit per ${unit1} of wages is not scored until labor cost and gross profit are both on the file.`;
  const growthBit =
    d.realGrowth == null || !Number.isFinite(d.realGrowth)
      ? ""
      : d.realGrowth > 0
        ? ` Revenue is outpacing inflation by ${fmtPct(d.realGrowth)} in real terms.`
        : ` Revenue growth is trailing inflation by ${fmtPct(Math.abs(d.realGrowth))} — pricing needs attention.`;
  return spellLabor(withCoda(`${rpeBit} ${gpBit}${growthBit}`, profile, "labor", market), market);
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
      `${NO_HISTORY_YET}. Upload a prior period before ratio movement can be read.`,
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
    above: number;
    below: number;
    at: number;
    total: number;
    industryName: string;
  },
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
): string {
  const medianLabel = market.copyPack === "us" ? "global SME bands" : "the sector median";
  const atBit = d.at > 0 ? `, and ${d.at} sit on it` : "";
  const base = `Against ${d.industryName} peers, ${d.above} of ${d.total} ratios sit above ${medianLabel} and ${d.below} sit below${atBit}.`;
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
    return spellForMarket(
      withCoda(
        "No intervention steps are required at present — all tracked ratios are healthy.",
        profile,
        "intervention",
        market,
      ),
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
  return spellForMarket(withCoda(base, profile, "intervention", market), market);
}

export function assetNarrative(
  l: DuPontLevers,
  dupont: DuPontDiagnosis,
  profile?: NarrativeProfile,
  market: MoneyMarket = ZA_MARKET,
  roe?: { text: string; unscored: boolean },
): string {
  const roeTier = roe?.unscored ? null : leverBand("Return on Equity", l.roe);
  const roeBit = roe?.unscored
    ? `${roe.text.replace(/\.$/, "")}.`
    : roeTier
      ? `Return on equity stands at ${roe?.text ?? fmtPct(l.roe)} — ${healthBandLabel(roeTier)}.`
      : roe?.text
        ? `Return on equity stands at ${roe.text}.`
        : `${ROE_TOO_SMALL}.`;
  return withCoda(
    `${roeBit} ${dupont.sentence} The decomposition below shows exactly which lever to work.`,
    profile,
    "assets",
    market,
  );
}
