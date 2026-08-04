/**
 * HealthScorecardPDF — Financial Health Scorecard report.
 * Page 1: exec summary, overall score, pillar grid, DuPont pointer strip.
 * Page 2: full ratio detail per pillar.
 *
 * IMPORTANT: Only import via dynamic import() — never at the top level of an
 * SSR-rendered module.
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { C, TIER_META, tierForScore, scoreColor } from "@/components/pdf/theme";
import { HealthScoreGauge } from "@/components/pdf/health-score-gauge";
import { SectionHeader } from "@/components/pdf/section-header";
import { RatioRow } from "@/components/pdf/ratio-row";
import { ReportTitle } from "@/components/pdf/report-title";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { DuPontStrip } from "@/components/pdf/dupont";
import { diagnoseDuPont, healthNarrative } from "./narrative";

// ── Types ──────────────────────────────────────────────────────────────────

export type RatioResult = {
  ratio_key: string;
  ratio_name: string;
  pillar: "profit" | "assets" | "financing" | "cash";
  current_value: number;
  health_score: number;
  health_tier: "critical" | "at_risk" | "healthy";
  prior_period_value?: number;
  prior_period_score?: number;
  formatted_value: string;
};

export type HealthScorecardPDFProps = {
  smeData: SmeData;
  ratioResults: RatioResult[];
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
};

// ── Constants ──────────────────────────────────────────────────────────────

const PILLARS = ["profit", "assets", "financing", "cash"] as const;

const PILLAR_LABEL: Record<string, string> = {
  profit: "Profit Drivers",
  assets: "Asset Productivity",
  financing: "Leverage & Finance",
  cash: "Cash Flow",
};

const TIER_DESC: Record<string, string> = {
  healthy: "The business is performing well across most financial indicators.",
  at_risk: "Several areas need attention to prevent further deterioration.",
  critical: "Immediate action required — key metrics indicate significant financial stress.",
};

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
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
  pillarBox: {
    flex: 1,
    borderWidth: 0.75,
    borderColor: C.line,
    borderRadius: 6,
    paddingHorizontal: 13,
    paddingTop: 11,
    paddingBottom: 12,
    backgroundColor: C.white,
  },
  pillarName: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 5,
  },
  pillarScoreRow: { flexDirection: "row", alignItems: "baseline", gap: 3, marginBottom: 7 },
  pillarScore: { fontSize: 22, fontFamily: "Helvetica-Bold" },
  pillarOutOf: { fontSize: 6.5, fontFamily: "Helvetica", color: C.faint },
  pillarGaugeRow: { marginBottom: 8 },
  pillarCountRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  countChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  countDot: { width: 5, height: 5, borderRadius: 2.5 },
  countText: { fontSize: 6.5, fontFamily: "Helvetica", color: C.muted },
  pillarSection: { marginBottom: 10 },
});

// ── Pillar box ─────────────────────────────────────────────────────────────

function PillarBox({
  pillar,
  score,
  counts,
}: {
  pillar: string;
  score: number;
  counts: { critical: number; at_risk: number; healthy: number };
}) {
  const rounded = Math.round(score);

  return (
    <View style={styles.pillarBox}>
      <Text style={styles.pillarName}>{PILLAR_LABEL[pillar]}</Text>
      <View style={styles.pillarScoreRow}>
        <Text style={[styles.pillarScore, { color: scoreColor(rounded) }]}>{rounded}</Text>
        <Text style={styles.pillarOutOf}>/ 100</Text>
      </View>
      <View style={styles.pillarGaugeRow}>
        <HealthScoreGauge score={score} height={5} />
      </View>
      <View style={styles.pillarCountRow}>
        {counts.critical > 0 && (
          <View style={styles.countChip}>
            <View style={[styles.countDot, { backgroundColor: C.red }]} />
            <Text style={styles.countText}>{counts.critical} critical</Text>
          </View>
        )}
        {counts.at_risk > 0 && (
          <View style={styles.countChip}>
            <View style={[styles.countDot, { backgroundColor: C.amber }]} />
            <Text style={styles.countText}>{counts.at_risk} watch</Text>
          </View>
        )}
        {counts.healthy > 0 && (
          <View style={styles.countChip}>
            <View style={[styles.countDot, { backgroundColor: C.green }]} />
            <Text style={styles.countText}>{counts.healthy} healthy</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function HealthScorecardPDF({
  smeData,
  ratioResults,
  accountantProfile,
  isDemo,
}: HealthScorecardPDFProps) {
  const overallScore = Math.round(avg(ratioResults.map((r) => r.health_score || 0)));
  const overallTier = tierForScore(overallScore);
  const overallColor = TIER_META[overallTier].color;

  const pillarData = PILLARS.map((pillar) => {
    const ratios = ratioResults.filter((r) => r.pillar === pillar);
    const score = avg(ratios.map((r) => r.health_score || 0));
    const counts = {
      critical: ratios.filter((r) => r.health_tier === "critical").length,
      at_risk: ratios.filter((r) => r.health_tier === "at_risk").length,
      healthy: ratios.filter((r) => r.health_tier === "healthy").length,
    };
    return { pillar, score, counts, ratios };
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

  // Executive summary figures
  const worstPillar = [...pillarData].sort((a, b) => a.score - b.score)[0];
  const bestPillar = [...pillarData].sort((a, b) => b.score - a.score)[0];
  const priorAvg = ratioResults.some((r) => r.prior_period_score !== undefined)
    ? avg(ratioResults.map((r) => r.prior_period_score ?? r.health_score))
    : undefined;
  const figures: HeadlineFigure[] = [
    {
      label: "Overall Score",
      value: `${overallScore}`,
      direction:
        priorAvg === undefined
          ? undefined
          : overallScore > priorAvg + 1
            ? "up"
            : overallScore < priorAvg - 1
              ? "down"
              : "flat",
      good: priorAvg === undefined ? undefined : overallScore >= priorAvg,
      note: "out of 100",
    },
    {
      label: "Strongest Pillar",
      value: `${Math.round(bestPillar.score)}`,
      good: true,
      direction: "up",
      note: PILLAR_LABEL[bestPillar.pillar],
    },
    {
      label: "Weakest Pillar",
      value: `${Math.round(worstPillar.score)}`,
      good: tierForScore(worstPillar.score) === "healthy",
      direction: tierForScore(worstPillar.score) === "healthy" ? "up" : "down",
      note: PILLAR_LABEL[worstPillar.pillar],
    },
    {
      label: "Ratios in Critical",
      value: `${ratioResults.filter((r) => r.health_tier === "critical").length}`,
      good: ratioResults.every((r) => r.health_tier !== "critical"),
      note: `of ${ratioResults.length} tracked`,
    },
  ];

  const narrative = healthNarrative(
    overallScore,
    pillarData.map((p) => ({ label: PILLAR_LABEL[p.pillar], score: p.score })),
    dupont,
  );

  return (
    <PDFDocument
      title={`Financial Health Scorecard — ${smeData.name}`}
      subject="Financial Health Scorecard"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
    >
      {/* ── PAGE 1 ── */}
      <ReportTitle
        kicker="Advisory Report 01"
        title="Financial Health Scorecard"
        subtitle="One score, four pillars, fourteen ratios — the state of the business at a glance"
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={narrative} />

      {/* Overall score band */}
      <View style={styles.scoreBand}>
        <View style={styles.scoreLeft}>
          <Text style={[styles.overallNumber, { color: overallColor }]}>{overallScore}</Text>
          <Text style={styles.outOf}>OVERALL SCORE / 100</Text>
          <View style={[styles.tierBadge, { backgroundColor: overallColor }]}>
            <Text style={styles.tierBadgeText}>{TIER_META[overallTier].label}</Text>
          </View>
        </View>
        <View style={styles.scoreRight}>
          <View style={styles.gaugeRow}>
            <HealthScoreGauge score={overallScore} height={9} />
          </View>
          <View style={styles.gaugeScale}>
            <Text style={styles.gaugeScaleText}>0 · CRITICAL</Text>
            <Text style={styles.gaugeScaleText}>40 · WATCH</Text>
            <Text style={styles.gaugeScaleText}>65 · HEALTHY</Text>
            <Text style={styles.gaugeScaleText}>100</Text>
          </View>
          <Text style={styles.tierDesc}>{TIER_DESC[overallTier]}</Text>
        </View>
      </View>

      {/* 2×2 pillar grid */}
      <View style={styles.pillarGridRow}>
        <PillarBox pillar="profit" score={pillarData[0].score} counts={pillarData[0].counts} />
        <PillarBox pillar="assets" score={pillarData[1].score} counts={pillarData[1].counts} />
      </View>
      <View style={styles.pillarGridRow}>
        <PillarBox pillar="financing" score={pillarData[2].score} counts={pillarData[2].counts} />
        <PillarBox pillar="cash" score={pillarData[3].score} counts={pillarData[3].counts} />
      </View>

      {/* DuPont pointer strip */}
      {hasDuPont && (
        <View style={{ marginTop: 6 }}>
          <DuPontStrip levers={levers} diagnosis={dupont} />
        </View>
      )}

      {/* ── PAGE 2: Ratio detail ── */}
      <View break>
        {pillarData.map(({ pillar, score, ratios }) => (
          <View key={pillar} style={styles.pillarSection}>
            <SectionHeader title={PILLAR_LABEL[pillar]} score={score} />
            {ratios.map((r, i) => (
              <RatioRow
                key={r.ratio_key}
                ratioName={r.ratio_name}
                formattedValue={r.formatted_value}
                healthScore={r.health_score}
                healthTier={r.health_tier}
                priorScore={r.prior_period_score}
                isAlternate={i % 2 === 1}
              />
            ))}
          </View>
        ))}
      </View>
    </PDFDocument>
  );
}
