/**
 * LaborProductivityPDF — Labour Productivity Report.
 * Page 1: Metrics + revenue-per-employee trend + GP-per-labor visual.
 * Page 2: Growth vs inflation comparison + 3 ratio rows.
 *
 * SSR safety: Only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { scoreTier } from "@/lib/ratios";
import { MetricBox } from "@/components/pdf/metric-box";
import { RatioRow } from "@/components/pdf/ratio-row";

// ── Types ──────────────────────────────────────────────────────────────────

export type LaborPeriod = {
  label: string;
  revenue: number;
  employees: number;
  labor_cost: number;
};

export type LaborProductivityData = {
  employee_count: number;
  total_labor_cost: number;
  total_revenue: number;
  total_gp: number;
  revenue_per_employee: number;
  rpe_prior: number;
  gp_per_labor_rand: number;
  revenue_growth: number;
  inflation_rate: number;
  periods: LaborPeriod[];
  health_scores: {
    gpToLabor: number;
    salesPerEmployee: number;
    revenueGrowth: number;
  };
};

export type LaborProductivityPDFProps = {
  smeData: SmeData;
  data: LaborProductivityData;
  accountantProfile: AccountantProfile;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRand(v: number): string {
  const abs = Math.abs(Math.round(v));
  return (v < 0 ? "-R " : "R ") + abs.toLocaleString("en-ZA");
}

function pctStr(v: number) { return `${(v * 100).toFixed(1)}%`; }
// ── Styles ─────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 4 },
  subtitle: { fontSize: 9, color: "#6b7280", fontFamily: "Helvetica", marginBottom: 16 },
  sectionTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  metricsRow: { flexDirection: "row", gap: 10, marginBottom: 18 },
  // Bar chart
  chartContainer: { position: "relative", backgroundColor: "#f9fafb", borderRadius: 6 },
  bar: { position: "absolute", borderRadius: 3 },
  barLabel: { position: "absolute", fontSize: 6.5, textAlign: "center", fontFamily: "Helvetica", color: "#6b7280" },
  barValueLabel: { position: "absolute", fontSize: 6, textAlign: "center", fontFamily: "Helvetica", color: "#374151" },
  // GP per labor
  gpRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  gpLabel: { width: 130, fontSize: 8, fontFamily: "Helvetica", color: "#374151" },
  gpTrack: { flex: 1, height: 18, backgroundColor: "#f3f4f6", borderRadius: 4, overflow: "hidden" },
  gpFill: { height: 18, borderRadius: 4 },
  gpValue: { width: 50, fontSize: 8.5, fontFamily: "Helvetica-Bold", color: "#111827", textAlign: "right" },
  // Growth comparison
  growthRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  growthLabel: { width: 140, fontSize: 8.5, fontFamily: "Helvetica", color: "#374151" },
  growthTrack: { flex: 1, height: 20, backgroundColor: "#f3f4f6", borderRadius: 4, overflow: "hidden" },
  growthFill: { height: 20, borderRadius: 4 },
  growthPct: { width: 44, fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "right" },
  // Insight box
  insightBox: { backgroundColor: "#f9fafb", borderRadius: 6, borderWidth: 1, borderColor: "#e5e7eb", padding: 12, marginTop: 16, marginBottom: 16 },
  insightText: { fontSize: 8, color: "#6b7280", fontFamily: "Helvetica", lineHeight: 1.5 },
  insightHighlight: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 4 },
});

// ── Revenue per employee bar chart ─────────────────────────────────────────

const RPE_W = 515;
const RPE_H = 100;
const RPE_LABEL_H = 22;

function RevenuePerEmployeeChart({ periods, accentColor }: { periods: LaborPeriod[]; accentColor: string }) {
  const rpeValues = periods.map((p) => (p.employees > 0 ? p.revenue / p.employees : 0));
  const maxVal = Math.max(...rpeValues, 1);
  const n = periods.length;
  const slot = RPE_W / n;
  const barW = slot - 12;
  const totalH = RPE_H + RPE_LABEL_H;

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={S.sectionTitle}>Revenue per Employee (Trend)</Text>
      <View style={[S.chartContainer, { height: totalH }]}>
        {[0.25, 0.5, 0.75].map((p, i) => (
          <View key={i} style={{ position: "absolute", left: 0, right: 0, bottom: RPE_LABEL_H + p * RPE_H, height: 0.5, backgroundColor: "#e5e7eb" }} />
        ))}
        {periods.map((period, i) => {
          const rpe = rpeValues[i];
          const barH = Math.max(4, (rpe / maxVal) * RPE_H);
          const left = i * slot + 6;
          return (
            <View key={i}>
              <View style={[S.bar, { bottom: RPE_LABEL_H, left, width: barW, height: barH, backgroundColor: accentColor }]} />
              <Text style={[S.barValueLabel, { bottom: RPE_LABEL_H + barH + 2, left, width: barW }]}>
                {Math.round(rpe / 1000)}k
              </Text>
              <Text style={[S.barLabel, { bottom: 3, left: i * slot, width: slot }]}>{period.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── GP per R1 of labor horizontal visual ───────────────────────────────────

function GpPerLaborVisual({ gp, laborCost, accentColor }: { gp: number; laborCost: number; accentColor: string }) {
  const gpPerRand = laborCost > 0 ? gp / laborCost : 0;
  const clampPct = Math.max(0, Math.min(1, gpPerRand));
  const color = gpPerRand >= 0.5 ? "#10b981" : gpPerRand >= 0.3 ? "#f59e0b" : "#ef4444";

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={S.sectionTitle}>Gross Profit per R1 of Labour Cost</Text>
      <View style={S.gpRow}>
        <Text style={S.gpLabel}>GP earned per R1 of wages</Text>
        <View style={S.gpTrack}>
          <View style={[S.gpFill, { width: `${(clampPct * 100).toFixed(0)}%`, backgroundColor: color }]} />
        </View>
        <Text style={[S.gpValue, { color }]}>R{gpPerRand.toFixed(2)}</Text>
      </View>
      <View style={S.gpRow}>
        <Text style={S.gpLabel}>Total Gross Profit</Text>
        <View style={S.gpTrack}>
          <View style={[S.gpFill, { width: "100%", backgroundColor: "#e5e7eb" }]} />
        </View>
        <Text style={[S.gpValue, { color: "#374151" }]}>{formatRand(gp)}</Text>
      </View>
      <View style={S.gpRow}>
        <Text style={S.gpLabel}>Total Labour Cost</Text>
        <View style={S.gpTrack}>
          <View style={[S.gpFill, { width: `${Math.min(100, (laborCost / gp) * 100).toFixed(0)}%`, backgroundColor: "#ef4444", opacity: 0.7 }]} />
        </View>
        <Text style={[S.gpValue, { color: "#374151" }]}>{formatRand(laborCost)}</Text>
      </View>
    </View>
  );
}

// ── Growth vs inflation comparison ────────────────────────────────────────

function GrowthComparison({ growth, inflation, accentColor }: { growth: number; inflation: number; accentColor: string }) {
  const realGrowth = growth - inflation;
  const maxPct = Math.max(growth, inflation, 0.02);
  const growthColor = growth > inflation ? "#10b981" : "#ef4444";

  const rows = [
    { label: "Revenue Growth", pct: growth, color: growthColor },
    { label: "Inflation Rate (CPI)", pct: inflation, color: "#f59e0b" },
    { label: "Real Revenue Growth", pct: realGrowth, color: realGrowth > 0 ? "#10b981" : "#ef4444" },
  ];

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={S.sectionTitle}>Growth vs Inflation Comparison</Text>
      {rows.map((row) => (
        <View key={row.label} style={S.growthRow}>
          <Text style={S.growthLabel}>{row.label}</Text>
          <View style={S.growthTrack}>
            <View style={[S.growthFill, { width: `${Math.max(2, (Math.abs(row.pct) / maxPct) * 100).toFixed(0)}%`, backgroundColor: row.color }]} />
          </View>
          <Text style={[S.growthPct, { color: row.color }]}>{row.pct >= 0 ? "+" : ""}{pctStr(row.pct)}</Text>
        </View>
      ))}
      <View style={S.insightBox}>
        <Text style={S.insightHighlight}>
          {realGrowth > 0 ? `Real growth of ${pctStr(realGrowth)} — revenue is outpacing inflation.` : `Revenue growth is below inflation — real purchasing power is declining.`}
        </Text>
        <Text style={S.insightText}>
          Revenue grew at {pctStr(growth)} against a CPI of {pctStr(inflation)}. Real growth of {pctStr(realGrowth)} indicates {realGrowth > 0.03 ? "solid" : realGrowth > 0 ? "marginal" : "negative"} expansion in purchasing power terms.
          {realGrowth <= 0 ? " Consider price increases to at minimum recover inflation impact on margins." : ""}
        </Text>
      </View>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function LaborProductivityPDF({ smeData, data, accountantProfile }: LaborProductivityPDFProps) {
  const accent = accountantProfile.accentColor || "#0f3460";
  const hs = data.health_scores;
  const rpePctChange = data.rpe_prior > 0 ? ((data.revenue_per_employee - data.rpe_prior) / data.rpe_prior) * 100 : undefined;
  const laborPctRevenue = data.total_revenue > 0 ? (data.total_labor_cost / data.total_revenue) * 100 : 0;
  const ratioRows = [
    { name: "GP per R1 of Labour Cost", value: `R${data.gp_per_labor_rand.toFixed(2)}`, score: hs.gpToLabor },
    { name: "Revenue per Employee", value: formatRand(data.revenue_per_employee), score: hs.salesPerEmployee },
    { name: "Revenue Growth Rate", value: pctStr(data.revenue_growth), score: hs.revenueGrowth },
  ];

  return (
    <PDFDocument title={`Labour Productivity — ${smeData.name}`} subject="Labour Productivity Report" smeData={smeData} accountantProfile={accountantProfile}>
      {/* ── PAGE 1 ── */}
      <Text style={S.title}>Labour Productivity Report</Text>
      <Text style={S.subtitle}>Revenue per employee, GP-to-labour efficiency, and growth benchmarks</Text>

      <View style={S.metricsRow}>
        <MetricBox label="Revenue per Employee" value={formatRand(data.revenue_per_employee)} change={rpePctChange} accentColor={accent} />
        <MetricBox label="Labour % of Revenue" value={`${laborPctRevenue.toFixed(1)}%`} accentColor={laborPctRevenue < 40 ? "#10b981" : laborPctRevenue < 60 ? "#f59e0b" : "#ef4444"} />
        <MetricBox label="GP per R1 Labour" value={`R${data.gp_per_labor_rand.toFixed(2)}`} accentColor={data.gp_per_labor_rand >= 0.5 ? "#10b981" : "#f59e0b"} />
      </View>

      <RevenuePerEmployeeChart periods={data.periods} accentColor={accent} />
      <GpPerLaborVisual gp={data.total_gp} laborCost={data.total_labor_cost} accentColor={accent} />

      {/* ── PAGE 2 ── */}
      <View break>
        <GrowthComparison growth={data.revenue_growth} inflation={data.inflation_rate} accentColor={accent} />

        <Text style={[S.sectionTitle, { marginTop: 8 }]}>Labour Ratio Analysis</Text>
        {ratioRows.map((r, i) => (
          <RatioRow key={r.name} ratioName={r.name} formattedValue={r.value} healthScore={r.score} healthTier={scoreTier(r.score)} isAlternate={i % 2 === 1} />
        ))}
      </View>
    </PDFDocument>
  );
}
