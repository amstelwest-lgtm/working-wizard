/**
 * InterventionPriorityPDF — Priority Intervention Plan report.
 * Renders top interventions sorted critical-first, then step_number asc.
 * Flows across 2-3 pages automatically.
 *
 * IMPORTANT: Only import via dynamic import() — never at the top level of an
 * SSR-rendered module.
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { InsightBox } from "@/components/pdf/insight-box";

// ── Types ──────────────────────────────────────────────────────────────────

export type Intervention = {
  ratio_key: string;
  ratio_name: string;
  health_tier: "critical" | "at_risk" | "healthy";
  step_number: number;
  step_title: string;
  step_description: string;
  timeframe: string;
  effort: string;
  impact: string;
  category: string;
};

export type InterventionPriorityPDFProps = {
  smeData: SmeData;
  interventions: Intervention[];
  accountantProfile: AccountantProfile;
};

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  titleSection: {
    marginBottom: 20,
  },
  reportTitle: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 5,
  },
  reportSubtitle: {
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: "#6b7280",
    marginBottom: 16,
  },
  summaryBar: {
    flexDirection: "row",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 24,
  },
  summaryChunk: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  summaryNum: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    marginBottom: 3,
  },
  summaryLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: "#ffffff",
    opacity: 0.85,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  stepsSection: {
    gap: 0,
  },
});

// ── Main component ─────────────────────────────────────────────────────────

export function InterventionPriorityPDF({
  smeData,
  interventions,
  accountantProfile,
}: InterventionPriorityPDFProps) {
  const accentColor = accountantProfile.accentColor || "#0f3460";

  // Sort: critical first, then at_risk, then by step_number asc
  const TIER_ORDER: Record<string, number> = { critical: 0, at_risk: 1, healthy: 2 };
  const sorted = [...interventions].sort((a, b) => {
    const tierDiff =
      (TIER_ORDER[a.health_tier] ?? 3) - (TIER_ORDER[b.health_tier] ?? 3);
    if (tierDiff !== 0) return tierDiff;
    return a.step_number - b.step_number;
  });

  const criticalCount = sorted.filter((i) => i.health_tier === "critical").length;
  const atRiskCount = sorted.filter((i) => i.health_tier === "at_risk").length;
  const totalCount = sorted.length;

  // Format month/year label from the period string
  const periodLabel = smeData.period;

  return (
    <PDFDocument
      title={`Priority Intervention Plan — ${smeData.name}`}
      subject="Priority Intervention Plan"
      smeData={smeData}
      accountantProfile={accountantProfile}
    >
      {/* Title block */}
      <View style={styles.titleSection}>
        <Text style={styles.reportTitle}>Priority Intervention Plan</Text>
        <Text style={styles.reportSubtitle}>
          Top actions for {smeData.name} — {periodLabel}
        </Text>

        {/* Summary bar */}
        <View style={styles.summaryBar}>
          <View style={[styles.summaryChunk, { backgroundColor: "#ef4444" }]}>
            <Text style={styles.summaryNum}>{criticalCount}</Text>
            <Text style={styles.summaryLabel}>Critical Actions</Text>
          </View>
          <View style={[styles.summaryChunk, { backgroundColor: "#f59e0b" }]}>
            <Text style={styles.summaryNum}>{atRiskCount}</Text>
            <Text style={styles.summaryLabel}>At-Risk Actions</Text>
          </View>
          <View style={[styles.summaryChunk, { backgroundColor: accentColor }]}>
            <Text style={styles.summaryNum}>{totalCount}</Text>
            <Text style={styles.summaryLabel}>Total Steps</Text>
          </View>
        </View>
      </View>

      {/* Intervention steps — react-pdf auto-wraps across pages */}
      <View style={styles.stepsSection}>
        {sorted.map((intervention, index) => (
          <InsightBox
            key={`${intervention.ratio_key}-${intervention.step_number}-${index}`}
            stepNumber={index + 1}
            ratioName={intervention.ratio_name}
            stepTitle={intervention.step_title}
            description={intervention.step_description}
            timeframe={intervention.timeframe}
            effort={intervention.effort}
            impact={intervention.impact}
            healthTier={intervention.health_tier}
            accentColor={accentColor}
          />
        ))}
      </View>
    </PDFDocument>
  );
}
