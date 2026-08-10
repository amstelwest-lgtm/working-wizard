/**
 * RatioMovementPDF — Ratio Movement Report.
 * Multi-period trend of each ratio with sparklines, delta chips, and a
 * sustained-decline flag.
 *
 * SSR safety: Only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData, type ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { Sparkline } from "@/components/pdf/sparkline";
import { C, resolveTheme } from "@/components/pdf/theme";
import { movementNarrative } from "./narrative";
import type { ClientOperatingProfile } from "@/lib/client-profile";


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
  /** Owner operating profile — shapes narrative wording only. */
  operatingProfile?: ClientOperatingProfile | null;
  smeData: SmeData;
  ratios: RatioMovementRow[];
  periodLabels?: {
    current: string;
    three_months: string;
    six_months: string;
    twelve_months: string;
  };
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "%") return `${(value * 100).toFixed(1)}%`;
  if (unit === "×") return `${value.toFixed(2)}×`;
  if (unit === "d") return `${Math.round(value)}d`;
  return value.toFixed(2);
}

type Verdict = "improving" | "stable" | "declining_most" | "declining_all";

function classify(row: RatioMovementRow): Verdict {
  const series = [row.twelve_months, row.six_months, row.three_months, row.current].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (series.length < 2) return "stable";
  const dirGood = (a: number, b: number) => (row.lower_is_better ? b < a : b > a);
  let good = 0;
  let bad = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i] === series[i - 1]) continue;
    if (dirGood(series[i - 1], series[i])) good++;
    else bad++;
  }
  if (bad === 0 && good > 0) return "improving";
  if (good === 0 && bad >= 2) return "declining_all";
  if (bad > good) return "declining_most";
  return "stable";
}

const VERDICT_META: Record<Verdict, { label: string; fg: string; bg: string }> = {
  improving: { label: "IMPROVING", fg: C.greenDeep, bg: C.greenSoft },
  stable: { label: "STABLE", fg: C.muted, bg: C.soft },
  declining_most: { label: "SLIPPING", fg: C.amberDeep, bg: C.amberSoft },
  declining_all: { label: "DECLINING", fg: C.redDeep, bg: C.redSoft },
};

const PILLAR_LABEL: Record<string, string> = {
  profit: "Profit Drivers",
  assets: "Asset Productivity",
  financing: "Leverage & Finance",
  cash: "Cash Flow",
};

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
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: C.hairline,
  },
  name: { fontSize: 8, fontFamily: "Helvetica", color: C.body },
  val: { fontSize: 7.5, fontFamily: "Helvetica", color: C.muted, textAlign: "right" },
  cur: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.ink, textAlign: "right" },
  verdictChip: { borderRadius: 3, paddingHorizontal: 4, paddingVertical: 2, alignItems: "center", width: 52 },
  verdictText: { fontSize: 5, fontFamily: "Helvetica-Bold", letterSpacing: 0.4 },
  sparkCell: { width: 52, alignItems: "flex-end", paddingRight: 4 },
});

// ── Main component ─────────────────────────────────────────────────────────

export function RatioMovementPDF({
  smeData,
  ratios,
  periodLabels,
  accountantProfile,
  isDemo,
  reviewSignoff,
  operatingProfile,
}: RatioMovementPDFProps) {
  const theme = resolveTheme(accountantProfile);
  const labels = periodLabels ?? {
    current: "Current",
    three_months: "3 Mo Ago",
    six_months: "6 Mo Ago",
    twelve_months: "12 Mo Ago",
  };

  const withVerdicts = ratios.map((r) => ({ row: r, verdict: classify(r) }));
  const counts = {
    improving: withVerdicts.filter((x) => x.verdict === "improving").length,
    decliningAll: withVerdicts.filter((x) => x.verdict === "declining_all").length,
    decliningMost: withVerdicts.filter((x) => x.verdict === "declining_most").length,
    total: ratios.length,
  };

  const figures: HeadlineFigure[] = [
    { label: "Ratios Tracked", value: `${counts.total}` },
    { label: "Improving", value: `${counts.improving}`, direction: "up", good: true },
    {
      label: "Slipping",
      value: `${counts.decliningMost}`,
      direction: counts.decliningMost > 0 ? "down" : "flat",
      good: counts.decliningMost === 0,
    },
    {
      label: "Sustained Decline",
      value: `${counts.decliningAll}`,
      direction: counts.decliningAll > 0 ? "down" : "flat",
      good: counts.decliningAll === 0,
      note: "declining every period",
    },
  ];

  const pillars = (["profit", "assets", "financing", "cash"] as const).filter((p) =>
    ratios.some((r) => r.pillar === p),
  );

  return (
    <PDFDocument
      title={`Ratio Movement — ${smeData.name}`}
      subject="Ratio Movement Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
      reviewSignoff={reviewSignoff}
    >
      <ReportTitle
        kicker="Advisory Report 09"
        title="Ratio Movement"
        subtitle="Direction of travel across every tracked ratio — 12 months, 6 months, 3 months, today"
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={movementNarrative(counts, operatingProfile)} />

      {pillars.map((pillar) => {
        const rows = withVerdicts.filter((x) => x.row.pillar === pillar);
        return (
          <View key={pillar}>
            <SectionHeader title={PILLAR_LABEL[pillar]} color={theme.accent} />
            {/* column headers */}
            <View style={S.headerRow}>
              <Text style={[S.headerCell, { flex: 2.2 }]}>Ratio</Text>
              <Text style={[S.headerCell, { flex: 1, textAlign: "right" }]}>{labels.twelve_months}</Text>
              <Text style={[S.headerCell, { flex: 1, textAlign: "right" }]}>{labels.six_months}</Text>
              <Text style={[S.headerCell, { flex: 1, textAlign: "right" }]}>{labels.three_months}</Text>
              <Text style={[S.headerCell, { flex: 1, textAlign: "right" }]}>{labels.current}</Text>
              <View style={{ width: 52 + 8 }} />
              <View style={{ width: 52 }} />
            </View>
            {rows.map(({ row, verdict }, i) => {
              const meta = VERDICT_META[verdict];
              const highlight = verdict === "declining_all";
              // Sparkline scale: invert lower_is_better so "up" always reads good?
              // Keep raw values — the verdict chip carries the judgement.
              const series = [row.twelve_months, row.six_months, row.three_months, row.current];
              return (
                <View
                  key={row.ratio_key}
                  style={[
                    S.row,
                    { backgroundColor: highlight ? C.redSoft : i % 2 === 1 ? C.soft : C.white },
                  ]}
                >
                  <Text style={[S.name, { flex: 2.2, fontFamily: highlight ? "Helvetica-Bold" : "Helvetica" }]}>
                    {row.ratio_name}
                  </Text>
                  <Text style={[S.val, { flex: 1 }]}>{fmt(row.twelve_months, row.unit)}</Text>
                  <Text style={[S.val, { flex: 1 }]}>{fmt(row.six_months, row.unit)}</Text>
                  <Text style={[S.val, { flex: 1 }]}>{fmt(row.three_months, row.unit)}</Text>
                  <Text style={[S.cur, { flex: 1 }]}>{fmt(row.current, row.unit)}</Text>
                  <View style={[S.sparkCell, { marginLeft: 8 }]}>
                    <Sparkline
                      values={series}
                      width={44}
                      height={10}
                      color={verdict === "improving" ? C.green : verdict.startsWith("declining") ? C.red : C.blue}
                    />
                  </View>
                  <View style={[S.verdictChip, { backgroundColor: meta.bg }]}>
                    <Text style={[S.verdictText, { color: meta.fg }]}>{meta.label}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}

      <Text style={{ fontSize: 6.5, fontFamily: "Helvetica", color: C.faint, marginTop: 12, lineHeight: 1.5 }}>
        Comparison columns show the closest uploaded snapshot to each target date. A dash means no
        snapshot was available for that window — trends will fill in automatically as more periods
        are uploaded.
      </Text>
    </PDFDocument>
  );
}
