/**
 * AssetProductivityPDF — Asset Productivity Report.
 * Page 1: exec summary + flagship DuPont decomposition diagram with
 * weak-lever callout + asset ratio rows.
 * Page 2: Capex vs Depreciation trend.
 *
 * SSR safety: Only import via dynamic import().
 */

import { Fragment } from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData, type ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { scoreTier } from "@/lib/ratios";
import { C, fmtPct, resolveTheme } from "@/components/pdf/theme";
import { MetricBox } from "@/components/pdf/metric-box";
import { RatioRow } from "@/components/pdf/ratio-row";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { DuPontDiagram } from "@/components/pdf/dupont";
import { assetNarrative, diagnoseDuPont } from "./narrative";
import type { ClientOperatingProfile } from "@/lib/client-profile";


// ── Types ──────────────────────────────────────────────────────────────────

export type CapexPeriod = {
  label: string;
  capex: number;
  depreciation: number;
};

export type AssetProductivityData = {
  roe: number;
  net_margin: number;
  asset_turnover: number;
  equity_multiplier: number;
  capex_periods: CapexPeriod[];
  health_scores: {
    assetTurnover: number;
    roa: number;
    /** Null when fixed assets / capex inputs are missing — never invent. */
    fixedCapitalUtilization: number | null;
    assetReinvestmentRatio: number | null;
    capexIntensity: number | null;
  };
  ratios: {
    assetTurnover: { value: string };
    roa: { value: string };
    fixedCapitalUtilization: { value: string };
    assetReinvestmentRatio: { value: string };
    capexIntensity: { value: string };
  };
};

export type AssetProductivityPDFProps = {
  /** Owner operating profile — shapes narrative wording only. */
  operatingProfile?: ClientOperatingProfile | null;
  smeData: SmeData;
  data: AssetProductivityData;
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
};

// ── Styles ─────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  metricsRow: { flexDirection: "row", gap: 10, marginBottom: 6 },
  chartContainer: { position: "relative", backgroundColor: C.soft, borderRadius: 5 },
  bar: { position: "absolute", borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  barLabel: { position: "absolute", fontSize: 6.5, textAlign: "center", fontFamily: "Helvetica", color: C.muted },
  legend: { flexDirection: "row", gap: 16, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendText: { fontSize: 7, color: C.muted, fontFamily: "Helvetica" },
  explainBox: {
    backgroundColor: C.soft,
    borderRadius: 5,
    borderWidth: 0.75,
    borderColor: C.line,
    padding: 12,
    marginTop: 12,
  },
  explainText: { fontSize: 8, color: C.body, fontFamily: "Helvetica", lineHeight: 1.55 },
  emptyChart: {
    backgroundColor: C.soft,
    borderRadius: 5,
    borderWidth: 0.75,
    borderColor: C.line,
    padding: 18,
    alignItems: "center",
  },
  emptyText: { fontSize: 8, color: C.muted, fontFamily: "Helvetica", textAlign: "center", lineHeight: 1.5 },
});

// ── Capex vs Depreciation chart ────────────────────────────────────────────

const CX_CHART_W = 515;
const CX_CHART_H = 110;
const CX_LABEL_H = 22;

function CapexChart({ periods, accent }: { periods: CapexPeriod[]; accent: string }) {
  if (periods.length === 0) {
    return (
      <View style={S.emptyChart}>
        <Text style={S.emptyText}>
          Capex and depreciation history will appear here once investment figures are captured
          for at least one period.
        </Text>
      </View>
    );
  }

  const n = periods.length;
  const maxVal = Math.max(...periods.flatMap((p) => [p.capex, p.depreciation]), 1);
  const slot = CX_CHART_W / n;
  const barW = (slot - 10) / 2;
  const totalH = CX_CHART_H + CX_LABEL_H;

  return (
    <View>
      <View style={[S.chartContainer, { height: totalH }]}>
        {[0.25, 0.5, 0.75].map((p, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: CX_LABEL_H + p * CX_CHART_H,
              height: 0.5,
              backgroundColor: C.line,
            }}
          />
        ))}
        {periods.map((period, i) => {
          const capexH = Math.max(2, (period.capex / maxVal) * CX_CHART_H);
          const depH = Math.max(2, (period.depreciation / maxVal) * CX_CHART_H);
          const slotLeft = i * slot + 5;
          return (
            <Fragment key={i}>
              <View style={[S.bar, { bottom: CX_LABEL_H, left: slotLeft, width: barW, height: capexH, backgroundColor: accent }]} />
              <View style={[S.bar, { bottom: CX_LABEL_H, left: slotLeft + barW + 3, width: barW, height: depH, backgroundColor: C.blueLight }]} />
              <Text style={[S.barLabel, { bottom: 3, left: i * slot, width: slot }]}>{period.label}</Text>
            </Fragment>
          );
        })}
      </View>
      <View style={S.legend}>
        <View style={S.legendItem}>
          <View style={[S.legendDot, { backgroundColor: accent }]} />
          <Text style={S.legendText}>Capital Expenditure</Text>
        </View>
        <View style={S.legendItem}>
          <View style={[S.legendDot, { backgroundColor: C.blueLight }]} />
          <Text style={S.legendText}>Depreciation</Text>
        </View>
      </View>
      <View style={S.explainBox}>
        <Text style={S.explainText}>
          When Capex consistently exceeds Depreciation, the asset base is growing. A reinvestment
          ratio above 1.0× indicates net asset investment. Watch for periods where Capex falls
          sharply below Depreciation — this can signal underinvestment that erodes future
          productive capacity.
        </Text>
      </View>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function AssetProductivityPDF({
  smeData,
  data,
  accountantProfile,
  isDemo,
  reviewSignoff,
  operatingProfile,
}: AssetProductivityPDFProps) {
  const theme = resolveTheme(accountantProfile);
  const hs = data.health_scores;

  const levers = {
    roe: data.roe,
    netMargin: data.net_margin,
    assetTurnover: data.asset_turnover,
    equityMultiplier: data.equity_multiplier,
  };
  const dupont = diagnoseDuPont(levers);

  const ratioRows = [
    { name: "Asset Turnover", value: data.ratios.assetTurnover.value, score: hs.assetTurnover },
    { name: "Return on Assets (ROA)", value: data.ratios.roa.value, score: hs.roa },
    {
      name: "Fixed Capital Utilization",
      value: data.ratios.fixedCapitalUtilization.value,
      score: hs.fixedCapitalUtilization,
    },
    {
      name: "Asset Reinvestment Ratio",
      value: data.ratios.assetReinvestmentRatio.value,
      score: hs.assetReinvestmentRatio,
    },
    {
      name: "Capex Intensity",
      value: data.ratios.capexIntensity.value,
      score: hs.capexIntensity,
    },
  ].filter((r) => r.score != null) as Array<{ name: string; value: string; score: number }>;

  const figures: HeadlineFigure[] = [
    {
      label: "Return on Equity",
      value: Number.isFinite(data.roe) ? fmtPct(data.roe) : "n/m",
      good: Number.isFinite(data.roe) ? data.roe >= 0.15 : undefined,
      direction: Number.isFinite(data.roe) ? (data.roe >= 0.15 ? "up" : "down") : undefined,
    },
    {
      label: "Net Margin",
      value: fmtPct(data.net_margin),
      good: data.net_margin >= 0.1,
    },
    {
      label: "Asset Turnover",
      value: `${data.asset_turnover.toFixed(2)}×`,
      good: data.asset_turnover >= 1,
    },
    {
      label: "Equity Multiplier",
      value: `${data.equity_multiplier.toFixed(2)}×`,
      good: data.equity_multiplier <= 2.5,
      note: "leverage",
    },
  ];

  return (
    <PDFDocument
      title={`Asset Productivity — ${smeData.name}`}
      subject="Asset Productivity Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
      reviewSignoff={reviewSignoff}
    >
      {/* ── PAGE 1 ── */}
      <ReportTitle
        kicker="Advisory Report 07"
        title="Asset Productivity"
        subtitle="DuPont decomposition, capital efficiency, and reinvestment patterns"
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={assetNarrative(levers, dupont, operatingProfile)} />

      <SectionHeader title="DuPont Decomposition — ROE Driver Analysis" color={theme.accent} />
      <DuPontDiagram levers={levers} diagnosis={dupont} />

      <SectionHeader title="Asset Ratio Analysis" color={theme.accent} />
      {ratioRows.map((r, i) => (
        <RatioRow
          key={r.name}
          ratioName={r.name}
          formattedValue={r.value}
          healthScore={r.score}
          healthTier={scoreTier(r.score)}
          isAlternate={i % 2 === 1}
        />
      ))}

      {/* ── PAGE 2 ── */}
      <View break>
        <SectionHeader title="Capex vs Depreciation Trend" color={theme.accent} />
        <CapexChart periods={data.capex_periods} accent={theme.accent} />
      </View>
    </PDFDocument>
  );
}
