/**
 * BenchmarkReportPDF — Industry Benchmark Report.
 * Each ratio on one line: value, benchmark band (median → top quartile), and
 * a position indicator, grouped by pillar.
 *
 * SSR safety: Only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData, type ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { BenchmarkBar } from "@/components/pdf/benchmark-bar";
import { C, resolveTheme } from "@/components/pdf/theme";
import { benchmarkNarrative } from "./narrative";
import type { ClientOperatingProfile } from "@/lib/client-profile";
import { ZA_MARKET, type ResolvedMarket } from "@/lib/market";

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
  /** Owner operating profile — shapes narrative wording only. */
  operatingProfile?: ClientOperatingProfile | null;
  smeData: SmeData;
  industryCode: string;
  industryName: string;
  benchmarkRows: BenchmarkRow[];
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
  market?: ResolvedMarket;
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

const POS_META: Record<Position, { label: string; fg: string; bg: string }> = {
  top_quartile: { label: "TOP QUARTILE", fg: C.greenDeep, bg: C.greenSoft },
  above_median: { label: "ABOVE MEDIAN", fg: C.blueDeep, bg: C.blueSoft },
  below_median: { label: "BELOW MEDIAN", fg: C.redDeep, bg: C.redSoft },
};

const PILLAR_LABEL: Record<string, string> = {
  profit: "Profit Drivers",
  assets: "Asset Productivity",
  financing: "Leverage & Finance",
  cash: "Cash Flow",
};

/** Normalise value, median, topQ onto a 0..1 track (direction-corrected). */
function normalise(row: BenchmarkRow): { pos: number; bandStart: number; bandEnd: number } {
  const vals = [row.current_value, row.sector_median, row.sector_top_quartile];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.25;
  lo -= pad;
  hi += pad;
  const span = hi - lo || 1;
  const t = (v: number) => (v - lo) / span;
  // For lower-is-better ratios, flip so "right" is always better.
  const flip = (x: number) => (row.lower_is_better ? 1 - x : x);
  return {
    pos: flip(t(row.current_value)),
    bandStart: flip(t(row.sector_median)),
    bandEnd: flip(t(row.sector_top_quartile)),
  };
}

// ── Styles ─────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  headerCell: {
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    color: C.faint,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7.5,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: C.hairline,
  },
  name: { fontSize: 8, fontFamily: "Helvetica", color: C.body },
  val: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.ink, textAlign: "right" },
  bench: { fontSize: 7.5, fontFamily: "Helvetica", color: C.muted, textAlign: "right" },
  barCell: { width: 96, alignItems: "flex-end", paddingLeft: 6 },
  posChip: {
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
    alignItems: "center",
    width: 62,
    marginLeft: 8,
  },
  posText: { fontSize: 4.8, fontFamily: "Helvetica-Bold", letterSpacing: 0.3 },
  scaleNote: {
    fontSize: 6.5,
    fontFamily: "Helvetica",
    color: C.faint,
    marginTop: 10,
    lineHeight: 1.5,
  },
});

// ── Main component ─────────────────────────────────────────────────────────

export function BenchmarkReportPDF({
  smeData,
  industryCode,
  industryName,
  benchmarkRows,
  accountantProfile,
  isDemo,
  reviewSignoff,
  operatingProfile,
  market,
}: BenchmarkReportPDFProps) {
  const theme = resolveTheme(accountantProfile);

  const positions = benchmarkRows.map(getPosition);
  const topQ = positions.filter((p) => p === "top_quartile").length;
  const above = positions.filter((p) => p === "above_median").length;
  const below = positions.filter((p) => p === "below_median").length;

  const figures: HeadlineFigure[] = [
    { label: "Ratios Compared", value: `${benchmarkRows.length}`, note: industryName },
    { label: "Top Quartile", value: `${topQ}`, direction: "up", good: topQ > 0 },
    { label: "Above Median", value: `${above}`, good: true },
    {
      label: "Below Median",
      value: `${below}`,
      direction: below > 0 ? "down" : "flat",
      good: below === 0,
    },
  ];

  const narrative = benchmarkNarrative(
    {
      topQ,
      above,
      below,
      total: benchmarkRows.length,
      industryName,
    },
    operatingProfile,
    market ?? ZA_MARKET,
  );

  const pillars = (["profit", "assets", "financing", "cash"] as const).filter((p) =>
    benchmarkRows.some((r) => r.pillar === p),
  );

  return (
    <PDFDocument
      title={`Industry Benchmark — ${smeData.name}`}
      subject={`Benchmark Report — ${industryName} (${industryCode})`}
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
      reviewSignoff={reviewSignoff}
      market={market ?? ZA_MARKET}
    >
      <ReportTitle
        kicker={`Advisory Report 10 · ${industryName}`}
        title="Industry Benchmark"
        subtitle="Every ratio positioned against the sector median and top quartile"
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={narrative} />

      {pillars.map((pillar) => {
        const rows = benchmarkRows.filter((r) => r.pillar === pillar);
        return (
          <View key={pillar}>
            <SectionHeader title={PILLAR_LABEL[pillar]} color={theme.accent} />
            <View style={S.headerRow}>
              <Text style={[S.headerCell, { flex: 2 }]}>Ratio</Text>
              <Text style={[S.headerCell, { flex: 1, textAlign: "right" }]}>You</Text>
              <Text style={[S.headerCell, { flex: 1, textAlign: "right" }]}>Median</Text>
              <Text style={[S.headerCell, { flex: 1, textAlign: "right" }]}>Top 25%</Text>
              <Text style={[S.headerCell, { width: 96, textAlign: "right", paddingLeft: 6 }]}>
                Position
              </Text>
              <View style={{ width: 70 }} />
            </View>
            {rows.map((row, i) => {
              const pos = getPosition(row);
              const meta = POS_META[pos];
              const n = normalise(row);
              return (
                <View
                  key={row.ratio_key}
                  style={[S.row, { backgroundColor: i % 2 === 1 ? C.soft : C.white }]}
                >
                  <Text style={[S.name, { flex: 2 }]}>{row.ratio_name}</Text>
                  <Text style={[S.val, { flex: 1 }]}>{row.formatted_current}</Text>
                  <Text style={[S.bench, { flex: 1 }]}>{row.formatted_median}</Text>
                  <Text style={[S.bench, { flex: 1 }]}>{row.formatted_top_quartile}</Text>
                  <View style={S.barCell}>
                    <BenchmarkBar
                      position={n.pos}
                      bandStart={n.bandStart}
                      bandEnd={n.bandEnd}
                      width={90}
                      markerColor={
                        pos === "below_median" ? C.red : pos === "top_quartile" ? C.green : C.blue
                      }
                    />
                  </View>
                  <View style={[S.posChip, { backgroundColor: meta.bg }]}>
                    <Text style={[S.posText, { color: meta.fg }]}>{meta.label}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}

      <Text style={S.scaleNote}>
        Position bars are direction-corrected: further right is always better, regardless of whether
        a higher or lower value is desirable for the ratio. The shaded band spans the sector median
        to top quartile.
      </Text>
    </PDFDocument>
  );
}
