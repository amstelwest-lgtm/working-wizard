/**
 * AssetProductivityPDF — Asset Productivity Report.
 * Page 1: DuPont decomposition tree + 5 asset ratio rows.
 * Page 2: Capex vs Depreciation trend bars.
 *
 * SSR safety: Only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { MetricBox } from "@/components/pdf/metric-box";
import { RatioRow } from "@/components/pdf/ratio-row";

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
    fixedCapitalUtilization: number;
    assetReinvestmentRatio: number;
    capexIntensity: number;
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
  smeData: SmeData;
  data: AssetProductivityData;
  accountantProfile: AccountantProfile;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function pctStr(v: number) { return `${(v * 100).toFixed(1)}%`; }
function scoreTier(s: number): "critical" | "at_risk" | "healthy" {
  return s >= 70 ? "healthy" : s >= 40 ? "at_risk" : "critical";
}

const TIER_COLOR: Record<string, string> = { healthy: "#10b981", at_risk: "#f59e0b", critical: "#ef4444" };

// ── Styles ─────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 4 },
  subtitle: { fontSize: 9, color: "#6b7280", fontFamily: "Helvetica", marginBottom: 16 },
  sectionTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, marginTop: 14, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  metricsRow: { flexDirection: "row", gap: 10, marginBottom: 18 },
  // DuPont
  dupontWrapper: { marginBottom: 20 },
  dupontTop: { alignItems: "center", marginBottom: 12 },
  dupontRoeBox: { borderRadius: 8, paddingHorizontal: 24, paddingVertical: 12, alignItems: "center" },
  dupontRoeLabel: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#ffffff", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 },
  dupontRoeValue: { fontSize: 26, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  dupontRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  dupontOp: { fontSize: 18, color: "#9ca3af", fontFamily: "Helvetica", marginTop: 10 },
  dupontEqSign: { fontSize: 18, color: "#374151", fontFamily: "Helvetica", marginTop: 10, marginHorizontal: 4 },
  dupontBox: { flex: 1, borderRadius: 6, borderWidth: 1, borderColor: "#e5e7eb", padding: 10, alignItems: "center", backgroundColor: "#ffffff" },
  dupontBoxLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 },
  dupontBoxValue: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  dupontBoxSub: { fontSize: 6.5, fontFamily: "Helvetica", color: "#6b7280" },
  dupontBoxScore: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#ffffff", borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2, marginTop: 4 },
  // Explanation
  explainBox: { backgroundColor: "#f9fafb", borderRadius: 6, borderWidth: 1, borderColor: "#e5e7eb", padding: 12, marginBottom: 14 },
  explainText: { fontSize: 8, color: "#6b7280", fontFamily: "Helvetica", lineHeight: 1.5 },
  // Capex chart
  chartContainer: { position: "relative", backgroundColor: "#f9fafb", borderRadius: 6 },
  bar: { position: "absolute", borderRadius: 2 },
  barLabel: { position: "absolute", fontSize: 6.5, textAlign: "center", fontFamily: "Helvetica", color: "#6b7280" },
  legend: { flexDirection: "row", gap: 16, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendText: { fontSize: 7, color: "#6b7280", fontFamily: "Helvetica" },
});

// ── DuPont tree ────────────────────────────────────────────────────────────

function DuPontTree({ data, accentColor }: { data: AssetProductivityData; accentColor: string }) {
  const hs = data.health_scores;
  const roeColor = data.roe >= 0.15 ? "#10b981" : data.roe >= 0.08 ? "#f59e0b" : "#ef4444";
  const nmTier = scoreTier(data.health_scores.roa);
  const atTier = scoreTier(hs.assetTurnover);
  const emScore = Math.min(100, Math.max(0, 80 - (data.equity_multiplier - 2) * 10));
  const emTier = scoreTier(emScore);

  const boxes = [
    { label: "Net Profit Margin", value: pctStr(data.net_margin), tier: nmTier, sub: "Profitability" },
    { label: "Asset Turnover", value: `${data.asset_turnover.toFixed(2)}×`, tier: atTier, sub: "Efficiency" },
    { label: "Equity Multiplier", value: `${data.equity_multiplier.toFixed(2)}×`, tier: emTier, sub: "Leverage" },
  ];

  return (
    <View style={S.dupontWrapper}>
      {/* ROE result box */}
      <View style={S.dupontTop}>
        <View style={[S.dupontRoeBox, { backgroundColor: roeColor }]}>
          <Text style={S.dupontRoeLabel}>Return on Equity (ROE)</Text>
          <Text style={S.dupontRoeValue}>{pctStr(data.roe)}</Text>
        </View>
      </View>

      {/* Factor row */}
      <View style={S.dupontRow}>
        {boxes.map((box, i) => {
          const color = TIER_COLOR[box.tier];
          return (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
              {i > 0 && <Text style={S.dupontOp}>×</Text>}
              <View style={[S.dupontBox, { flex: 1, marginLeft: i > 0 ? 6 : 0 }]}>
                <Text style={S.dupontBoxLabel}>{box.label}</Text>
                <Text style={[S.dupontBoxValue, { color }]}>{box.value}</Text>
                <Text style={S.dupontBoxSub}>{box.sub}</Text>
                <View style={[S.dupontBoxScore, { backgroundColor: color }]}>
                  <Text style={{ color: "#fff", fontSize: 7, fontFamily: "Helvetica-Bold" }}>{box.tier.replace("_", " ").toUpperCase()}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      <View style={[S.explainBox, { marginTop: 12 }]}>
        <Text style={S.explainText}>
          ROE = Net Profit Margin × Asset Turnover × Equity Multiplier. A healthy ROE requires balance across all three: strong margins, efficient asset use, and appropriate (not excessive) leverage. Improving asset turnover by 0.1× at current margins would add {pctStr(data.net_margin * 0.1 * data.equity_multiplier)} to ROE.
        </Text>
      </View>
    </View>
  );
}

// ── Capex vs Depreciation chart ────────────────────────────────────────────

const CX_CHART_W = 515;
const CX_CHART_H = 110;
const CX_LABEL_H = 22;

function CapexChart({ periods, accentColor }: { periods: CapexPeriod[]; accentColor: string }) {
  const n = periods.length;
  const maxVal = Math.max(...periods.flatMap((p) => [p.capex, p.depreciation]), 1);
  const slot = CX_CHART_W / n;
  const barW = (slot - 10) / 2; // two bars per slot
  const totalH = CX_CHART_H + CX_LABEL_H;

  return (
    <View>
      <Text style={S.sectionTitle}>Capex vs Depreciation Trend</Text>
      <View style={[S.chartContainer, { height: totalH }]}>
        {[0.25, 0.5, 0.75].map((p, i) => (
          <View key={i} style={{ position: "absolute", left: 0, right: 0, bottom: CX_LABEL_H + p * CX_CHART_H, height: 0.5, backgroundColor: "#e5e7eb" }} />
        ))}
        {periods.map((period, i) => {
          const capexH = Math.max(2, (period.capex / maxVal) * CX_CHART_H);
          const depH = Math.max(2, (period.depreciation / maxVal) * CX_CHART_H);
          const slotLeft = i * slot + 5;
          return (
            <View key={i}>
              <View style={[S.bar, { bottom: CX_LABEL_H, left: slotLeft, width: barW, height: capexH, backgroundColor: accentColor }]} />
              <View style={[S.bar, { bottom: CX_LABEL_H, left: slotLeft + barW + 3, width: barW, height: depH, backgroundColor: "#f59e0b" }]} />
              <Text style={[S.barLabel, { bottom: 3, left: i * slot, width: slot }]}>{period.label}</Text>
            </View>
          );
        })}
      </View>
      <View style={S.legend}>
        <View style={S.legendItem}><View style={[S.legendDot, { backgroundColor: accentColor }]} /><Text style={S.legendText}>Capital Expenditure</Text></View>
        <View style={S.legendItem}><View style={[S.legendDot, { backgroundColor: "#f59e0b" }]} /><Text style={S.legendText}>Depreciation</Text></View>
      </View>
      <View style={[S.explainBox, { marginTop: 12 }]}>
        <Text style={S.explainText}>
          When Capex consistently exceeds Depreciation, the asset base is growing. A reinvestment ratio above 1.0× indicates net asset investment. Watch for periods where Capex falls sharply below Depreciation — this can signal underinvestment that erodes future productive capacity.
        </Text>
      </View>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function AssetProductivityPDF({ smeData, data, accountantProfile }: AssetProductivityPDFProps) {
  const accent = accountantProfile.accentColor || "#0f3460";
  const hs = data.health_scores;
  const ratioRows = [
    { name: "Asset Turnover", value: data.ratios.assetTurnover.value, score: hs.assetTurnover },
    { name: "Return on Assets (ROA)", value: data.ratios.roa.value, score: hs.roa },
    { name: "Fixed Capital Utilization", value: data.ratios.fixedCapitalUtilization.value, score: hs.fixedCapitalUtilization },
    { name: "Asset Reinvestment Ratio", value: data.ratios.assetReinvestmentRatio.value, score: hs.assetReinvestmentRatio },
    { name: "Capex Intensity", value: data.ratios.capexIntensity.value, score: hs.capexIntensity },
  ];

  return (
    <PDFDocument title={`Asset Productivity — ${smeData.name}`} subject="Asset Productivity Report" smeData={smeData} accountantProfile={accountantProfile}>
      {/* ── PAGE 1 ── */}
      <Text style={S.title}>Asset Productivity Report</Text>
      <Text style={S.subtitle}>DuPont analysis, capital efficiency, and reinvestment patterns</Text>

      <View style={S.metricsRow}>
        <MetricBox label="Return on Equity" value={pctStr(data.roe)} accentColor={data.roe >= 0.15 ? "#10b981" : "#f59e0b"} />
        <MetricBox label="Asset Turnover" value={`${data.asset_turnover.toFixed(2)}×`} accentColor={accent} />
        <MetricBox label="Return on Assets" value={data.ratios.roa.value} accentColor={accent} />
      </View>

      <Text style={S.sectionTitle}>DuPont Decomposition — ROE Driver Analysis</Text>
      <DuPontTree data={data} accentColor={accent} />

      <Text style={[S.sectionTitle, { marginTop: 4 }]}>Asset Ratio Analysis</Text>
      {ratioRows.map((r, i) => (
        <RatioRow key={r.name} ratioName={r.name} formattedValue={r.value} healthScore={r.score} healthTier={scoreTier(r.score)} isAlternate={i % 2 === 1} />
      ))}

      {/* ── PAGE 2 ── */}
      <View break>
        <CapexChart periods={data.capex_periods} accentColor={accent} />
      </View>
    </PDFDocument>
  );
}
