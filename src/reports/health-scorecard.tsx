/**
 * HealthScorecardPDF — Financial Health Scorecard report.
 * Exec summary, overall score, and pillar grid come first. DuPont and the
 * ratio detail continue in the same flow so a card that starts a page is
 * not left alone by a hard break. Cards stay wrap={false}.
 *
 * IMPORTANT: Only import via dynamic import() — never at the top level of an
 * SSR-rendered module.
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData, type ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { C, TIER_META } from "@/components/pdf/theme";
import { NOT_ENOUGH_DATA } from "@/lib/missing-metrics";
import { HEALTH_BAND_TABLE, healthBandLabel, scoreTier } from "@/lib/ratios";
import { pickPillarExtreme, scorecardCountCopy } from "@/lib/report-coherence";
import { HealthScoreGauge } from "@/components/pdf/health-score-gauge";
import { PillarBox, pillarLabel } from "@/components/pdf/pillar-box";
import { SectionHeader } from "@/components/pdf/section-header";
import { RatioRow } from "@/components/pdf/ratio-row";
import { ReportTitle } from "@/components/pdf/report-title";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { DuPontStrip } from "@/components/pdf/dupont";
import {
  computeOverallHealth,
  HEALTH_RATIO_COUNT,
  type HealthPillarId,
  type OverallHealth,
} from "@/lib/health-score";
import type { ClientOperatingProfile } from "@/lib/client-profile";
import { diagnoseDuPont, healthNarrative } from "./narrative";
import { spellLabor, ZA_MARKET, type ResolvedMarket } from "@/lib/market";
import { PDF_CARD_MIN_PRESENCE, ReportSection } from "@/lib/report-pdf-layout";
import { reportKicker } from "@/lib/report-catalog";

// ── Types ──────────────────────────────────────────────────────────────────

export type RatioResult = {
  ratio_key: string;
  ratio_name: string;
  pillar: "profit" | "assets" | "financing" | "cash";
  current_value: number;
  health_score: number;
  health_tier: "critical" | "at_risk" | "healthy";
  /** Missing inputs. Shown as Not scored and kept out of the pillar average. */
  unscored?: boolean;
  prior_period_value?: number;
  prior_period_score?: number;
  formatted_value: string;
  /** Annualised / part-month note, when the value column already includes it. */
  annotation?: string | null;
};

export type HealthScorecardPDFProps = {
  /** Owner operating profile — shapes narrative wording only. */
  operatingProfile?: ClientOperatingProfile | null;
  smeData: SmeData;
  ratioResults: RatioResult[];
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
  /** Fictional client (`clients.is_demo`). Live figures, SAMPLE stamp. */
  sample?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
  /** When known, blended into the cash pillar (same rule as dashboard / client header). */
  cashRunwayWeeks?: number | null;
  /**
   * Pillar and overall scores from `scorecardHealthFromFinancials` — the same
   * call Ratios and Overview use. When set, the headline does not re-average
   * the presented rows.
   */
  overallHealth?: OverallHealth | null;
  market?: ResolvedMarket;
};

// ── Constants ──────────────────────────────────────────────────────────────

const PILLARS = ["profit", "assets", "financing", "cash"] as const;

function tierDescription(tier: "healthy" | "at_risk" | "critical"): string {
  const band = healthBandLabel(tier);
  if (tier === "healthy") return `The overall band is ${band}.`;
  if (tier === "at_risk") return `The overall band is ${band}.`;
  return `The overall band is ${band}.`;
}

function avg(nums: number[]): number | null {
  const finite = nums.filter((n) => Number.isFinite(n));
  if (!finite.length) return null;
  return finite.reduce((s, n) => s + n, 0) / finite.length;
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scoreBand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    marginBottom: 18,
    paddingVertical: 6,
  },
  scoreLeft: { alignItems: "center", width: 150 },
  overallNumber: { fontSize: 54, fontFamily: "Helvetica-Bold", lineHeight: 1 },
  outOf: { fontSize: 7.5, fontFamily: "Helvetica", color: C.faint, marginTop: 2 },
  tierBadge: {
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    marginTop: 8,
  },
  tierBadgeText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.white,
    letterSpacing: 1,
  },
  scoreRight: { flex: 1 },
  gaugeRow: { marginBottom: 8 },
  gaugeScale: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  gaugeScaleText: { fontSize: 5.5, fontFamily: "Helvetica", color: C.faint },
  tierDesc: { fontSize: 8.5, fontFamily: "Helvetica", color: C.body, lineHeight: 1.5 },
  // Pillar grid
  pillarGridRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  pillarSection: { marginBottom: 10 },
});

// ── Main component ─────────────────────────────────────────────────────────

export function HealthScorecardPDF({
  smeData,
  ratioResults,
  accountantProfile,
  isDemo,
  sample,
  reviewSignoff,
  operatingProfile,
  cashRunwayWeeks,
  overallHealth,
  market,
}: HealthScorecardPDFProps) {
  const scoredForHealth = ratioResults.filter((r) => !r.unscored);
  const overall =
    overallHealth ??
    computeOverallHealth({
      scoredRatios: scoredForHealth.map((r) => ({
        name: r.ratio_name,
        score: r.health_score,
        pillar: r.pillar as HealthPillarId,
      })),
      cashRunwayWeeks,
    });
  const overallScore = overall.overall;
  const overallTier = overall.displayStatus;
  const overallColor = TIER_META[overallTier].color;

  const pillarData = PILLARS.map((pillar) => {
    const fromOverall = overall.pillars.find((p) => p.id === pillar);
    const ratios = ratioResults.filter((r) => r.pillar === pillar);
    const scored = ratios.filter((r) => !r.unscored);
    const score = fromOverall?.score ?? avg(scored.map((r) => r.health_score));
    const counts = {
      critical: scored.filter((r) => r.health_tier === "critical").length,
      at_risk: scored.filter((r) => r.health_tier === "at_risk").length,
      healthy: scored.filter((r) => r.health_tier === "healthy").length,
    };
    // Cash runway can push cash pillar critical without a ratio row
    if (pillar === "cash" && fromOverall?.status === "critical" && counts.critical === 0) {
      counts.critical = 1;
    }
    return { pillar, score, counts, ratios, note: fromOverall?.note ?? null };
  });

  // DuPont levers pulled from the ratio set (graceful when missing).
  // Accepts both camelCase and snake_case keys; derives missing levers where
  // arithmetic allows (netMargin = ROA ÷ asset turnover; ROE = product).
  const byKey = (...keys: string[]) =>
    ratioResults.find((r) => keys.includes(r.ratio_key))?.current_value ?? NaN;
  const assetTurnover = byKey("assetTurnover", "asset_turnover");
  const equityMultiplier = byKey("equityMultiplier", "equity_multiplier");
  let netMargin = byKey("netMargin", "net_margin");
  if (!Number.isFinite(netMargin)) {
    const roa = byKey("roa", "return_on_assets");
    if (Number.isFinite(roa) && Number.isFinite(assetTurnover) && assetTurnover !== 0) {
      netMargin = roa / assetTurnover;
    }
  }
  let roe = byKey("returnOnEquity", "roe_ratio", "return_on_equity");
  if (
    !Number.isFinite(roe) &&
    Number.isFinite(netMargin) &&
    Number.isFinite(assetTurnover) &&
    Number.isFinite(equityMultiplier)
  ) {
    roe = netMargin * assetTurnover * equityMultiplier;
  }
  const levers = { roe, netMargin, assetTurnover, equityMultiplier };
  const hasDuPont =
    Number.isFinite(levers.netMargin) &&
    Number.isFinite(levers.assetTurnover) &&
    Number.isFinite(levers.equityMultiplier);
  const dupont = diagnoseDuPont(levers);
  const roeRow = ratioResults.find((r) => r.ratio_name === "Return on Equity");

  // Executive summary figures — only pillars that actually have a score
  const scoredPillarData = pillarData.filter(
    (p): p is typeof p & { score: number } => p.score != null && Number.isFinite(p.score),
  );
  const pillarChoices = scoredPillarData.map((p) => ({
    id: p.pillar,
    label: pillarLabel(p.pillar),
    score: p.score,
  }));
  const bestPillar = pickPillarExtreme(pillarChoices, "strongest");
  const worstPillar = pickPillarExtreme(pillarChoices, "weakest");
  const priorAvg = scoredForHealth.some((r) => r.prior_period_score !== undefined)
    ? avg(scoredForHealth.map((r) => r.prior_period_score ?? r.health_score))
    : undefined;
  const counts = scorecardCountCopy(
    ratioResults.length > 0 ? ratioResults.length : HEALTH_RATIO_COUNT,
  );
  const figures: HeadlineFigure[] = [
    {
      label: "Overall Score",
      value: overallScore != null ? `${overallScore}` : "—",
      direction:
        priorAvg == null || overallScore == null
          ? undefined
          : overallScore > priorAvg + 1
            ? "up"
            : overallScore < priorAvg - 1
              ? "down"
              : "flat",
      good: priorAvg == null || overallScore == null ? undefined : overallScore >= priorAvg,
      note: "",
    },
    {
      label: "Strongest Pillar",
      value: bestPillar ? `${Math.round(bestPillar.score)}` : "—",
      good: true,
      direction: "up",
      note: bestPillar ? bestPillar.label : "no data",
    },
    {
      label: "Weakest Pillar",
      value: worstPillar ? `${Math.round(worstPillar.score)}` : "—",
      good: worstPillar ? scoreTier(worstPillar.score) === "healthy" : undefined,
      direction: worstPillar
        ? scoreTier(worstPillar.score) === "healthy"
          ? "up"
          : "down"
        : undefined,
      note: worstPillar ? worstPillar.label : "no data",
    },
    {
      label: "Ratios in Critical",
      value: `${scoredForHealth.filter((r) => r.health_tier === "critical").length}`,
      good: scoredForHealth.every((r) => r.health_tier !== "critical"),
      note: counts.tracked,
    },
  ];

  const narrative = healthNarrative(
    overallScore ?? Number.NaN,
    pillarChoices,
    dupont,
    operatingProfile,
    market ?? ZA_MARKET,
    overallTier,
    smeData.name,
  );

  return (
    <PDFDocument
      title={`Financial Health Scorecard — ${smeData.name}`}
      subject="Financial Health Scorecard"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
      sample={sample}
      draft={!isDemo && !sample && !reviewSignoff}
      reviewSignoff={reviewSignoff}
      market={market ?? ZA_MARKET}
    >
      {/* ── PAGE 1 ── */}
      <ReportTitle
        kicker={reportKicker("scorecard")}
        title="Financial Health Scorecard"
        subtitle={counts.subtitle}
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={narrative} />

      {/* Overall score band */}
      <View style={styles.scoreBand} wrap={false} minPresenceAhead={PDF_CARD_MIN_PRESENCE}>
        <View style={styles.scoreLeft}>
          <Text style={[styles.overallNumber, { color: "#0B5FFF" }]}>
            {overallScore != null ? overallScore : "—"}
          </Text>
          <Text style={styles.outOf}>OVERALL SCORE</Text>
          <View style={[styles.tierBadge, { backgroundColor: overallColor }]}>
            <Text style={styles.tierBadgeText}>{TIER_META[overallTier].label}</Text>
          </View>
        </View>
        <View style={styles.scoreRight}>
          <View style={styles.gaugeRow}>
            <HealthScoreGauge score={overallScore} height={9} />
          </View>
          <View style={styles.gaugeScale}>
            <Text style={styles.gaugeScaleText}>
              0 · {healthBandLabel("critical").toUpperCase()}
            </Text>
            <Text style={styles.gaugeScaleText}>
              {HEALTH_BAND_TABLE.watchMin} · {healthBandLabel("at_risk").toUpperCase()}
            </Text>
            <Text style={styles.gaugeScaleText}>
              {HEALTH_BAND_TABLE.healthyMin} · {healthBandLabel("healthy").toUpperCase()}
            </Text>
            <Text style={styles.gaugeScaleText}>100</Text>
          </View>
          <Text style={styles.tierDesc}>{tierDescription(overallTier)}</Text>
        </View>
      </View>

      {/* 2×2 pillar grid */}
      <View style={styles.pillarGridRow}>
        <PillarBox pillar="profit" score={pillarData[0].score} counts={pillarData[0].counts} note={pillarData[0].note} />
        <PillarBox pillar="assets" score={pillarData[1].score} counts={pillarData[1].counts} note={pillarData[1].note} />
      </View>
      <View style={styles.pillarGridRow}>
        <PillarBox pillar="financing" score={pillarData[2].score} counts={pillarData[2].counts} note={pillarData[2].note} />
        <PillarBox pillar="cash" score={pillarData[3].score} counts={pillarData[3].counts} note={pillarData[3].note} />
      </View>

      {/* DuPont pointer strip */}
      {hasDuPont && (
        <View style={{ marginTop: 6 }} wrap={false} minPresenceAhead={PDF_CARD_MIN_PRESENCE}>
          <DuPontStrip
            levers={levers}
            diagnosis={dupont}
            roeHeadline={
              roeRow?.unscored ? "n/a" : roeRow?.formatted_value?.split(" · ")[0]
            }
            roeNote={roeRow?.unscored ? roeRow.formatted_value : roeRow?.annotation}
          />
        </View>
      )}

      {pillarData.filter((pillar) => pillar.ratios.length > 0).map(({ pillar, score, ratios }) => {
        const rendered = ratios.map((r, i) => {
          const spelled = spellLabor(r.ratio_name, market ?? ZA_MARKET);
          const percent = r.formatted_value.split(" · ")[0] ?? r.formatted_value;
          const missingFigure =
            r.unscored &&
            (r.annotation === NOT_ENOUGH_DATA ||
              r.formatted_value === "—" ||
              r.formatted_value === NOT_ENOUGH_DATA);
          const ratioName = missingFigure
            ? spelled
            : r.unscored
              ? `${spelled} — ${r.formatted_value}`
              : r.annotation
                ? `${spelled} · ${r.annotation}`
                : spelled;
          return (
            <RatioRow
              key={r.ratio_key}
              ratioName={ratioName}
              formattedValue={
                missingFigure
                  ? "—"
                  : r.unscored && r.formatted_value.startsWith("n/a")
                    ? "n/a"
                    : percent
              }
              healthScore={r.health_score}
              healthTier={r.health_tier}
              unscored={r.unscored}
              statusLabel={missingFigure ? NOT_ENOUGH_DATA : undefined}
              priorScore={r.prior_period_score}
              isAlternate={i % 2 === 1}
            />
          );
        });
        return (
          <ReportSection
            key={pillar}
            style={styles.pillarSection}
            heading={<SectionHeader title={pillarLabel(pillar)} score={score ?? undefined} />}
            lead={rendered.slice(0, 2)}
          >
            {rendered.slice(2)}
          </ReportSection>
        );
      })}
    </PDFDocument>
  );
}
