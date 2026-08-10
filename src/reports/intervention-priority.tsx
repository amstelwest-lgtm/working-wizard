/**
 * InterventionPriorityPDF — Intervention Priority Report, redesigned as a
 * prioritized action roadmap with severity-coded cards.
 *
 * SSR safety: Only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData, type ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { InsightBox } from "@/components/pdf/insight-box";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { C, resolveTheme } from "@/components/pdf/theme";
import { interventionNarrative } from "./narrative";
import type { ClientOperatingProfile } from "@/lib/client-profile";


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
  /** Owner operating profile — shapes narrative wording only. */
  operatingProfile?: ClientOperatingProfile | null;
  smeData: SmeData;
  interventions: Intervention[];
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
};

// ── Styles ─────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  waveDesc: { fontSize: 7.5, fontFamily: "Helvetica", color: C.muted, marginBottom: 8, lineHeight: 1.5 },
  empty: {
    borderRadius: 6,
    borderWidth: 0.75,
    borderColor: C.line,
    borderLeftWidth: 2.5,
    borderLeftColor: C.green,
    backgroundColor: C.greenSoft,
    padding: 14,
  },
  emptyText: { fontSize: 8.5, fontFamily: "Helvetica", color: C.body, lineHeight: 1.55 },
});

// ── Main component ─────────────────────────────────────────────────────────

export function InterventionPriorityPDF({
  smeData,
  interventions,
  accountantProfile,
  isDemo,
  reviewSignoff,
  operatingProfile,
}: InterventionPriorityPDFProps) {
  const theme = resolveTheme(accountantProfile);

  const critical = interventions.filter((x) => x.health_tier === "critical");
  const atRisk = interventions.filter((x) => x.health_tier === "at_risk");
  const rest = interventions.filter(
    (x) => x.health_tier !== "critical" && x.health_tier !== "at_risk",
  );

  const figures: HeadlineFigure[] = [
    { label: "Action Steps", value: `${interventions.length}` },
    {
      label: "Critical Priority",
      value: `${critical.length}`,
      direction: critical.length > 0 ? "down" : "flat",
      good: critical.length === 0,
      note: "start immediately",
    },
    {
      label: "Watch Priority",
      value: `${atRisk.length}`,
      good: atRisk.length === 0,
      note: "next 30–60 days",
    },
    {
      label: "Strengthen",
      value: `${rest.length}`,
      good: true,
      note: "protect what works",
    },
  ];

  const narrative = interventionNarrative({
    critical: critical.length,
    atRisk: atRisk.length,
    total: interventions.length,
  }, operatingProfile);

  let counter = 0;
  const renderCards = (items: Intervention[]) =>
    items.map((iv) => {
      counter += 1;
      return (
        <InsightBox
          key={`${iv.ratio_key}-${iv.step_number}-${counter}`}
          stepNumber={counter}
          ratioName={iv.ratio_name}
          stepTitle={iv.step_title}
          description={iv.step_description}
          timeframe={iv.timeframe}
          effort={iv.effort}
          impact={iv.impact}
          healthTier={iv.health_tier}
          accentColor={theme.accent}
        />
      );
    });

  return (
    <PDFDocument
      title={`Intervention Roadmap — ${smeData.name}`}
      subject="Intervention Priority Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
      reviewSignoff={reviewSignoff}
    >
      <ReportTitle
        kicker="Advisory Report 05"
        title="Intervention Roadmap"
        subtitle="The prioritized action plan — what to fix first, what it takes, and what it's worth"
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={narrative} />

      {interventions.length === 0 && (
        <View style={S.empty}>
          <Text style={S.emptyText}>
            No intervention steps are required at present — every tracked ratio is in healthy
            territory. Keep the current disciplines in place and revisit after the next period
            upload.
          </Text>
        </View>
      )}

      {critical.length > 0 && (
        <View>
          <SectionHeader title="Wave 1 — Act Now" color={C.red} />
          <Text style={S.waveDesc}>
            These steps address ratios in critical territory. Begin within the next two weeks —
            each carries outsized impact on business survival and stability.
          </Text>
          {renderCards(critical)}
        </View>
      )}

      {atRisk.length > 0 && (
        <View>
          <SectionHeader title="Wave 2 — Stabilise" color={C.amber} />
          <Text style={S.waveDesc}>
            These steps target ratios under pressure. Schedule them over the next 30–60 days, once
            Wave 1 is underway.
          </Text>
          {renderCards(atRisk)}
        </View>
      )}

      {rest.length > 0 && (
        <View>
          <SectionHeader title="Wave 3 — Strengthen" color={C.green} />
          <Text style={S.waveDesc}>
            Ratios here are healthy — these steps protect and extend the advantage.
          </Text>
          {renderCards(rest)}
        </View>
      )}
    </PDFDocument>
  );
}
