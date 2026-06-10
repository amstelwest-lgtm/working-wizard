/**
 * RatioMovementPDF — Ratio Movement Report.
 * Compact table showing all ratios across 4 time periods with trend arrows.
 * Rows where trend declines across all periods → red highlight.
 * Rows where trend declines for 3+ periods → amber highlight.
 *
 * SSR safety: Only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";

// ── Types ──────────────────────────────────────────────────────────────────

export type RatioMovementRow = {
  ratio_key: string;
  ratio_name: string;
  pillar: "profit" | "assets" | "financing" | "cash";
  unit: string;
  current: number;
  three_months: number | null;
  six_months: number | null;
  twelve_months: number | null;
  lower_is_better?: boolean;
};

export type RatioMovementPDFProps = {
  smeData: SmeData;
  ratios: RatioMovementRow[];
  periodLabels?: {
    current: string;
    three_months: string;
    six_months: string;
    twelve_months: string;
  };
  accountantProfile: AccountantProfile;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(value: number | null, unit: string): string {
  if (value === null) return "—";
  const abs = Math.abs(value);
  if (unit === "%") return `${(value * 100).toFixed(1)}%`;
  if (unit === "×") return `${value.toFixed(2)}×`;
  if (unit === "d") return `${Math.round(value)}d`;
  if (unit === "R") {
    return (value < 0 ? "-R " : "R ") + Math.round(abs).toLocaleString("en-ZA");
  }
  return value.toFixed(2);
}

type TrendStatus = "declining_all" | "declining_most" | "improving" | "mixed" | "stable";

function trendStatus(row: RatioMovementRow): TrendStatus {
  // Ordered oldest → newest
  const vals = [row.twelve_months, row.six_months, row.three_months, row.current];
  const nonNull: number[] = vals.filter((v): v is number => v !== null);
  if (nonNull.length < 2) return "stable";

  // "better" means higher score unless lower_is_better
  const isBetter = (newer: number, older: number) =>
    row.lower_is_better ? newer < older : newer > older;
  const isWorse = (newer: number, older: number) =>
    row.lower_is_better ? newer > older : newer < older;

  let improvements = 0;
  let declines = 0;
  for (let i = 1; i < nonNull.length; i++) {
    if (isBetter(nonNull[i], nonNull[i - 1])) improvements++;
    else if (isWorse(nonNull[i], nonNull[i - 1])) declines++;
  }

  const total = improvements + declines;
  if (total === 0) return "stable";
  if (declines === total) return "declining_all";
  if (declines >= total * 0.66) return "declining_most";
  if (improvements === total) return "improving";
  return "mixed";
}

function trendArrow(row: RatioMovementRow): { symbol: string; color: string } {
  if (row.three_months === null) return { symbol: "→", color: "#9ca3af" };
  const isBetter = row.lower_is_better
    ? row.current < row.three_months
    : row.current > row.three_months;
  const isWorse = row.lower_is_better
    ? row.current > row.three_months
    : row.current < row.three_months;
  if (isBetter) return { symbol: "▲", color: "#10b981" };
  if (isWorse) return { symbol: "▼", color: "#ef4444" };
  return { symbol: "→", color: "#9ca3af" };
}

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
  subtitle: { fontSize: 9, color: "#6b7280", fontFamily: "Helvetica", marginBottom: 16 },
  pillarHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
  pillarHeaderText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  tblHeader: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "#374151",
    borderRadius: 3,
    marginBottom: 2,
  },
  tblHCell: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 0.2,
  },
  tblRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f3f4f6",
  },
  cell: { fontSize: 7.5, fontFamily: "Helvetica", color: "#374151", textAlign: "right" },
  nameCell: { fontSize: 7.5, fontFamily: "Helvetica", color: "#1f2937", flex: 3 },
  arrowCell: { width: 20, fontSize: 9, textAlign: "center" },
  legend: { flexDirection: "row", gap: 16, marginBottom: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 7, color: "#6b7280", fontFamily: "Helvetica" },
});

// ── Table header row ───────────────────────────────────────────────────────

function TableHeader({ labels }: { labels: { current: string; three_months: string; six_months: string; twelve_months: string } }) {
  return (
    <View style={S.tblHeader}>
      <Text style={[S.tblHCell, { flex: 3 }]}>Ratio</Text>
      <Text style={[S.tblHCell, { width: 62, textAlign: "right" }]}>{labels.twelve_months}</Text>
      <Text style={[S.tblHCell, { width: 62, textAlign: "right" }]}>{labels.six_months}</Text>
      <Text style={[S.tblHCell, { width: 62, textAlign: "right" }]}>{labels.three_months}</Text>
      <Text style={[S.tblHCell, { width: 62, textAlign: "right" }]}>{labels.current}</Text>
      <Text style={[S.tblHCell, { width: 20, textAlign: "center" }]}>↕</Text>
    </View>
  );
}

// ── Pillar section rows ────────────────────────────────────────────────────

function PillarBlock({
  pillar,
  rows,
  labels,
}: {
  pillar: string;
  rows: RatioMovementRow[];
  labels: RatioMovementPDFProps["periodLabels"];
}) {
  const color = PILLAR_COLORS[pillar] ?? "#374151";
  return (
    <View>
      <View style={[S.pillarHeader, { backgroundColor: color }]}>
        <Text style={S.pillarHeaderText}>{PILLAR_LABELS[pillar] ?? pillar.toUpperCase()}</Text>
      </View>
      {rows.map((row, ri) => {
        const status = trendStatus(row);
        const arrow = trendArrow(row);
        const bg =
          status === "declining_all"
            ? "#fef2f2"
            : status === "declining_most"
              ? "#fffbeb"
              : ri % 2 === 1
                ? "#f9fafb"
                : "#ffffff";

        return (
          <View key={row.ratio_key} style={[S.tblRow, { backgroundColor: bg }]}>
            <Text style={S.nameCell}>{row.ratio_name}</Text>
            <Text style={[S.cell, { width: 62 }]}>{fmt(row.twelve_months, row.unit)}</Text>
            <Text style={[S.cell, { width: 62 }]}>{fmt(row.six_months, row.unit)}</Text>
            <Text style={[S.cell, { width: 62 }]}>{fmt(row.three_months, row.unit)}</Text>
            <Text style={[S.cell, { width: 62, fontFamily: "Helvetica-Bold", color: "#111827" }]}>
              {fmt(row.current, row.unit)}
            </Text>
            <Text style={[S.arrowCell, { color: arrow.color }]}>{arrow.symbol}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

const DEFAULT_PERIOD_LABELS = {
  current: "Current",
  three_months: "3 Months",
  six_months: "6 Months",
  twelve_months: "12 Months",
};

export function RatioMovementPDF({
  smeData,
  ratios,
  periodLabels = DEFAULT_PERIOD_LABELS,
  accountantProfile,
}: RatioMovementPDFProps) {
  const pillars: Array<"profit" | "assets" | "financing" | "cash"> = [
    "profit",
    "assets",
    "financing",
    "cash",
  ];

  return (
    <PDFDocument
      title={`Ratio Movement — ${smeData.name}`}
      subject="Ratio Movement Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
    >
      <Text style={S.title}>Ratio Movement Report</Text>
      <Text style={S.subtitle}>
        All ratios tracked across four periods — colour highlights indicate sustained declining trends.
      </Text>

      {/* Legend */}
      <View style={S.legend}>
        <View style={S.legendItem}>
          <View style={[S.legendDot, { backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fca5a5" }]} />
          <Text style={S.legendText}>Declining across all periods</Text>
        </View>
        <View style={S.legendItem}>
          <View style={[S.legendDot, { backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fcd34d" }]} />
          <Text style={S.legendText}>Declining 3+ consecutive periods</Text>
        </View>
        <View style={S.legendItem}>
          <Text style={[S.legendText, { color: "#10b981", fontFamily: "Helvetica-Bold" }]}>▲</Text>
          <Text style={S.legendText}> Improving vs 3 months ago</Text>
        </View>
        <View style={S.legendItem}>
          <Text style={[S.legendText, { color: "#ef4444", fontFamily: "Helvetica-Bold" }]}>▼</Text>
          <Text style={S.legendText}> Declining vs 3 months ago</Text>
        </View>
      </View>

      <TableHeader labels={periodLabels} />

      {pillars.map((pillar) => {
        const rows = ratios.filter((r) => r.pillar === pillar);
        if (rows.length === 0) return null;
        return <PillarBlock key={pillar} pillar={pillar} rows={rows} labels={periodLabels} />;
      })}
    </PDFDocument>
  );
}
