/**
 * HealthScorecardPDF — Financial Health Scorecard report.
 * Fits on 2 A4 pages maximum.
 *
 * IMPORTANT: Only import via dynamic import() — never at the top level of an
 * SSR-rendered module.
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { HealthScoreGauge } from "@/components/pdf/health-score-gauge";
import { SectionHeader } from "@/components/pdf/section-header";
import { RatioRow } from "@/components/pdf/ratio-row";

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
};

// ── Constants ──────────────────────────────────────────────────────────────

const PILLARS = ["profit", "assets", "financing", "cash"] as const;

const PILLAR_LABEL: Record<string, string> = {
  profit: "Profit Drivers",
  assets: "Asset Productivity",
  financing: "Leverage & Finance",
  cash: "Cash Flow",
};

const PILLAR_COLOR: Record<string, string> = {
  profit: "#b45309",
  assets: "#1d4ed8",
  financing: "#7c3aed",
  cash: "#047857",
};

function tierInfo(score: number): { label: string; color: string; desc: string } {
  if (score >= 70)
    return {
      label: "HEALTHY",
      color: "#10b981",
      desc: "The business is performing well across most financial indicators.",
    };
  if (score >= 40)
    return {
      label: "AT RISK",
      color: "#f59e0b",
      desc: "Several areas need attention to prevent further deterioration.",
    };
  return {
    label: "CRITICAL",
    color: "#ef4444",
    desc: "Immediate action required — key metrics indicate significant financial stress.",
  };
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Page 1 — overall score
  scorePage: {
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 16,
  },
  overallLabel: {
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#6b7280",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  overallNumber: {
    fontSize: 68,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1,
    marginBottom: 10,
  },
  gaugeRow: {
    width: "80%",
    marginBottom: 12,
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  tierBadge: {
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tierBadgeText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 0.8,
  },
  tierDesc: {
    fontSize: 8.5,
    fontFamily: "Helvetica",
    color: "#6b7280",
    textAlign: "center",
  },
  // Pillar grid
  pillarGrid: {
    marginTop: 28,
    width: "100%",
  },
  pillarGridRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  pillarBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 14,
    backgroundColor: "#fafafa",
  },
  pillarTopBar: {
    height: 3,
    borderRadius: 2,
    marginBottom: 10,
  },
  pillarName: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  pillarScore: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },
  pillarGaugeRow: {
    marginBottom: 10,
  },
  pillarCountRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  countChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  countDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  countText: {
    fontSize: 7,
    fontFamily: "Helvetica",
    color: "#6b7280",
  },
  // Page 2 — pillar detail
  pillarSection: {
    marginBottom: 16,
  },
  divider: {
    height: 12,
  },
});

// ── Pillar box ─────────────────────────────────────────────────────────────

function PillarBox({
  pillar,
  score,
  counts,
  color,
}: {
  pillar: string;
  score: number;
  counts: { critical: number; at_risk: number; healthy: number };
  color: string;
}) {
  const rounded = Math.round(score);
  const { color: scoreColor } = tierInfo(rounded);

  return (
    <View style={styles.pillarBox}>
      <View style={[styles.pillarTopBar, { backgroundColor: color }]} />
      <Text style={styles.pillarName}>{PILLAR_LABEL[pillar]}</Text>
      <Text style={[styles.pillarScore, { color: scoreColor }]}>{rounded}</Text>
      <View style={styles.pillarGaugeRow}>
        <HealthScoreGauge score={score} height={5} />
      </View>
      <View style={styles.pillarCountRow}>
        {counts.critical > 0 && (
          <View style={styles.countChip}>
            <View style={[styles.countDot, { backgroundColor: "#ef4444" }]} />
            <Text style={styles.countText}>{counts.critical} critical</Text>
          </View>
        )}
        {counts.at_risk > 0 && (
          <View style={styles.countChip}>
            <View style={[styles.countDot, { backgroundColor: "#f59e0b" }]} />
            <Text style={styles.countText}>{counts.at_risk} at risk</Text>
          </View>
        )}
        {counts.healthy > 0 && (
          <View style={styles.countChip}>
            <View style={[styles.countDot, { backgroundColor: "#10b981" }]} />
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
}: HealthScorecardPDFProps) {
  const overallScore = Math.round(avg(ratioResults.map((r) => r.health_score || 0)));
  const overall = tierInfo(overallScore);
  const accentColor = accountantProfile.accentColor || "#0f3460";

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

  return (
    <PDFDocument
      title={`Financial Health Scorecard — ${smeData.name}`}
      subject="Financial Health Scorecard"
      smeData={smeData}
      accountantProfile={accountantProfile}
    >
      {/* ── PAGE 1: Summary ── */}
      <View style={styles.scorePage}>
        <Text style={styles.overallLabel}>Overall Financial Health Score</Text>

        <Text style={[styles.overallNumber, { color: overall.color }]}>
          {overallScore}
        </Text>

        <View style={styles.gaugeRow}>
          <HealthScoreGauge score={overallScore} height={10} />
        </View>

        <View style={styles.tierRow}>
          <View style={[styles.tierBadge, { backgroundColor: overall.color }]}>
            <Text style={styles.tierBadgeText}>{overall.label}</Text>
          </View>
        </View>

        <Text style={styles.tierDesc}>{overall.desc}</Text>
      </View>

      {/* 2×2 pillar grid */}
      <View style={styles.pillarGrid}>
        <View style={styles.pillarGridRow}>
          <PillarBox
            pillar="profit"
            score={pillarData[0].score}
            counts={pillarData[0].counts}
            color={PILLAR_COLOR.profit}
          />
          <PillarBox
            pillar="assets"
            score={pillarData[1].score}
            counts={pillarData[1].counts}
            color={PILLAR_COLOR.assets}
          />
        </View>
        <View style={styles.pillarGridRow}>
          <PillarBox
            pillar="financing"
            score={pillarData[2].score}
            counts={pillarData[2].counts}
            color={PILLAR_COLOR.financing}
          />
          <PillarBox
            pillar="cash"
            score={pillarData[3].score}
            counts={pillarData[3].counts}
            color={PILLAR_COLOR.cash}
          />
        </View>
      </View>

      {/* ── PAGE 2: Ratio detail ── */}
      <View break>
        {pillarData.map(({ pillar, score, ratios }, pi) => (
          <View key={pillar} style={styles.pillarSection}>
            {pi > 0 && <View style={styles.divider} />}
            <SectionHeader
              title={PILLAR_LABEL[pillar]}
              score={score}
              color={PILLAR_COLOR[pillar]}
            />
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
