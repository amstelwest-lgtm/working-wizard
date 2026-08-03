/**
 * BenchmarkReportPDF — Industry Benchmark Report.
 * Shows all ratios vs sector median and top quartile with position badges.
 * Page 1: Summary + full benchmark table (auto-paginated).
 *
 * SSR safety: Only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";

// ── Types ──────────────────────────────────────────────────────────────────

export type BenchmarkRow = {
  ratio_key: string;
  ratio_name: string;
  pillar: "profit" | "assets" | "financing" | "cash";
  current_value: number;
  formatted_current: string;
  health_score: number;
  health_tier: "critical" | "at_risk" | "healthy";
  sector_median: number;
  sector_top_quartile: number;
  formatted_median: string;
  formatted_top_quartile: string;
  lower_is_better?: boolean;
};

export type BenchmarkReportPDFProps = {
  smeData: SmeData;
  industryCode: string;
  industryName: string;
  benchmarkRows: BenchmarkRow[];
  accountantProfile: AccountantProfile;
};

// ── Helpers ────────────────────────────────────────────────────────────────

type Position = "top_quartile" | "above_median" | "below_median";

function getPosition(row: BenchmarkRow): Position {
  const better = row.lower_is_better
    ? (a: number, b: number) => a <= b
    : (a: number, b: number) => a >= b;
  if (better(row.current_value, row.sector_top_quartile)) return "top_quartile";
  if (better(row.current_value, row.sector_median)) return "above_median";
  return "below_median";
}

const POSITION_CONFIG: Record<Position, { label: string; bg: string; fg: string }> = {
  top_quartile: { label: "TOP QUARTILE", bg: "#10b981", fg: "#ffffff" },
  above_median: { label: "ABOVE MEDIAN", bg: "#3b82f6", fg: "#ffffff" },
  below_median: { label: "BELOW MEDIAN", bg: "#f59e0b", fg: "#ffffff" },
};

const PILLAR_COLORS: Record<string, string> = {
  profit: "#b45309",
  assets: "#1d4ed8",
  financing: "#7c3aed",
  cash: "#047857",
};

const PILLAR_LABELS: Record<string, string> = {
  profit: "PROFIT",
  assets: "ASSETS",
  financing: "FINANCING",
  cash: "CASH",
};

// ── Styles ─────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 4 },
  subtitle: { fontSize: 9, color: "#6b7280", fontFamily: "Helvetica", marginBottom: 4 },
  industryBadge: { alignSelf: "flex-start", borderRadius: 5, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 14 },
  industryText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#ffffff", letterSpacing: 0.3 },
  // Summary banner
  summaryBox: {
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryLeft: {},
  summaryTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#ffffff", marginBottom: 4 },
  summaryDesc: { fontSize: 8, color: "#ffffff", opacity: 0.8, fontFamily: "Helvetica", lineHeight: 1.4 },
  summaryNum: { fontSize: 36, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  summaryNumLabel: { fontSize: 8, color: "#ffffff", opacity: 0.8, fontFamily: "Helvetica", textAlign: "right" },
  // Position summary chips
  chipsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  chip: { flex: 1, borderRadius: 6, padding: 10, alignItems: "center" },
  chipCount: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#ffffff", marginBottom: 2 },
  chipLabel: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#ffffff", opacity: 0.9, textAlign: "center" },
  // Table
  pillarHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, marginTop: 8 },
  pillarText: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#ffffff", letterSpacing: 0.5 },
  tblHeader: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#374151" },
  tblHCell: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#ffffff", letterSpacing: 0.2 },
  tblRow: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: "#f3f4f6" },
  cell: { fontSize: 7.5, fontFamily: "Helvetica", color: "#374151", textAlign: "right" },
  nameCell: { fontSize: 7.5, fontFamily: "Helvetica", color: "#1f2937", flex: 2.5 },
  posBadge: { borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2, alignItems: "center" },
  posText: { fontSize: 5.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.2 },
});

// ── Summary section ────────────────────────────────────────────────────────

function SummarySection({ rows, accentColor }: { rows: BenchmarkRow[]; accentColor: string }) {
  const positions = rows.map(getPosition);
  const topQ = positions.filter((p) => p === "top_quartile").length;
  const above = positions.filter((p) => p === "above_median").length;
  const below = positions.filter((p) => p === "below_median").length;
  const aboveOrTopQ = topQ + above;
  const total = rows.length;

  const overallColor = aboveOrTopQ >= total * 0.7 ? "#10b981" : aboveOrTopQ >= total * 0.4 ? "#f59e0b" : "#ef4444";

  return (
    <View>
      <View style={[S.summaryBox, { backgroundColor: overallColor }]}>
        <View style={[S.summaryLeft, { flex: 1 }]}>
          <Text style={S.summaryTitle}>Industry Benchmark Summary</Text>
          <Text style={S.summaryDesc}>
            {aboveOrTopQ} of {total} ratios are at or above the sector median.
            {topQ > 0 ? ` ${topQ} ratio${topQ > 1 ? "s" : ""} reach${topQ === 1 ? "es" : ""} the top quartile.` : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={S.summaryNum}>{aboveOrTopQ}/{total}</Text>
          <Text style={S.summaryNumLabel}>above median</Text>
        </View>
      </View>

      <View style={S.chipsRow}>
        <View style={[S.chip, { backgroundColor: "#10b981" }]}>
          <Text style={S.chipCount}>{topQ}</Text>
          <Text style={S.chipLabel}>Top Quartile</Text>
        </View>
        <View style={[S.chip, { backgroundColor: "#3b82f6" }]}>
          <Text style={S.chipCount}>{above}</Text>
          <Text style={S.chipLabel}>Above Median</Text>
        </View>
        <View style={[S.chip, { backgroundColor: "#f59e0b" }]}>
          <Text style={S.chipCount}>{below}</Text>
          <Text style={S.chipLabel}>Below Median</Text>
        </View>
      </View>
    </View>
  );
}

// ── Benchmark table ────────────────────────────────────────────────────────

function BenchmarkTable({ rows, accentColor }: { rows: BenchmarkRow[]; accentColor: string }) {
  const pillars: Array<"profit" | "assets" | "financing" | "cash"> = [
    "profit",
    "assets",
    "financing",
    "cash",
  ];

  return (
    <View>
      <View style={S.tblHeader}>
        <Text style={[S.tblHCell, { flex: 2.5 }]}>Ratio</Text>
        <Text style={[S.tblHCell, { width: 70, textAlign: "right" }]}>Your Value</Text>
        <Text style={[S.tblHCell, { width: 70, textAlign: "right" }]}>Sector Median</Text>
        <Text style={[S.tblHCell, { width: 70, textAlign: "right" }]}>Top Quartile</Text>
        <Text style={[S.tblHCell, { width: 76, textAlign: "center" }]}>Position</Text>
      </View>

      {pillars.map((pillar) => {
        const pillarRows = rows.filter((r) => r.pillar === pillar);
        if (pillarRows.length === 0) return null;
        const color = PILLAR_COLORS[pillar] ?? "#374151";

        return (
          <View key={pillar}>
            <View style={[S.pillarHeader, { backgroundColor: color }]}>
              <Text style={S.pillarText}>{PILLAR_LABELS[pillar]}</Text>
            </View>
            {pillarRows.map((row, ri) => {
              const pos = getPosition(row);
              const posConfig = POSITION_CONFIG[pos];
              return (
                <View
                  key={row.ratio_key}
                  style={[S.tblRow, { backgroundColor: ri % 2 === 1 ? "#f9fafb" : "#ffffff" }]}
                >
                  <Text style={S.nameCell}>{row.ratio_name}</Text>
                  <Text
                    style={[
                      S.cell,
                      { width: 70, fontFamily: "Helvetica-Bold", color: "#111827" },
                    ]}
                  >
                    {row.formatted_current}
                  </Text>
                  <Text style={[S.cell, { width: 70 }]}>{row.formatted_median}</Text>
                  <Text style={[S.cell, { width: 70 }]}>{row.formatted_top_quartile}</Text>
                  <View style={{ width: 76, alignItems: "center", justifyContent: "center" }}>
                    <View style={[S.posBadge, { backgroundColor: posConfig.bg }]}>
                      <Text style={[S.posText, { color: posConfig.fg }]}>{posConfig.label}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function BenchmarkReportPDF({
  smeData,
  industryCode,
  industryName,
  benchmarkRows,
  accountantProfile,
}: BenchmarkReportPDFProps) {
  const accent = accountantProfile.accentColor || "#0f3460";

  return (
    <PDFDocument
      title={`Benchmark Report — ${smeData.name}`}
      subject="Industry Benchmark Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
    >
      <Text style={S.title}>Industry Benchmark Report</Text>
      <Text style={S.subtitle}>
        How {smeData.name} compares to industry peers — {smeData.period}
      </Text>
      <View style={[S.industryBadge, { backgroundColor: accent }]}>
        <Text style={S.industryText}>{industryName} ({industryCode})</Text>
      </View>

      <SummarySection rows={benchmarkRows} accentColor={accent} />
      <BenchmarkTable rows={benchmarkRows} accentColor={accent} />
    </PDFDocument>
  );
}
