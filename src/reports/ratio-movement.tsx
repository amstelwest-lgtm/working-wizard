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
import { ZA_MARKET, type ResolvedMarket } from "@/lib/market";
import { reportKicker } from "@/lib/report-catalog";
import {
  movementVerdict,
  MOVEMENT_VERDICT_LABEL,
  NO_HISTORY_YET,
  type MovementVerdict,
} from "@/lib/report-coherence";

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
  /** Fictional client (`clients.is_demo`). Live figures, SAMPLE stamp. */
  sample?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
  market?: ResolvedMarket;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "%") return `${(value * 100).toFixed(1)}%`;
  if (unit === "×") return `${value.toFixed(2)}×`;
  if (unit === "d") return `${Math.round(value)}d`;
  return value.toFixed(2);
}

function classify(row: RatioMovementRow): MovementVerdict {
  return movementVerdict({
    current: row.current,
    three_months: row.three_months,
    six_months: row.six_months,
    twelve_months: row.twelve_months,
    lower_is_better: row.lower_is_better,
  });
}

const VERDICT_META: Record<MovementVerdict, { label: string; fg: string; bg: string }> = {
  improving: { label: MOVEMENT_VERDICT_LABEL.improving, fg: C.greenDeep, bg: C.greenSoft },
  stable: { label: MOVEMENT_VERDICT_LABEL.stable, fg: C.muted, bg: C.soft },
  declining_most: { label: MOVEMENT_VERDICT_LABEL.declining_most, fg: C.amberDeep, bg: C.amberSoft },
  declining_all: { label: MOVEMENT_VERDICT_LABEL.declining_all, fg: C.redDeep, bg: C.redSoft },
  no_history: { label: MOVEMENT_VERDICT_LABEL.no_history, fg: C.muted, bg: C.soft },
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
  verdictChip: {
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
    alignItems: "center",
    width: 52,
  },
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
  sample,
  reviewSignoff,
  operatingProfile,
  market,
}: RatioMovementPDFProps) {
  const theme = resolveTheme(accountantProfile);
  const labels = periodLabels ?? {
    current: "Current",
    three_months: "3 Mo Ago",
    six_months: "6 Mo Ago",
    twelve_months: "12 Mo Ago",
  };

  const withVerdicts = ratios.map((r) => ({ row: r, verdict: classify(r) }));
  const hasHistory = ratios.some(
    (r) => r.three_months != null || r.six_months != null || r.twelve_months != null,
  );
  const counts = {
    improving: withVerdicts.filter((x) => x.verdict === "improving").length,
    decliningAll: withVerdicts.filter((x) => x.verdict === "declining_all").length,
    decliningMost: withVerdicts.filter((x) => x.verdict === "declining_most").length,
    total: ratios.length,
  };

  const figures: HeadlineFigure[] = hasHistory
    ? [
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
      ]
    : [
        { label: "Ratios Tracked", value: `${counts.total}` },
        { label: "History", value: "n/a", note: NO_HISTORY_YET },
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
      sample={sample}
      reviewSignoff={reviewSignoff}
      market={market ?? ZA_MARKET}
    >
      <ReportTitle
        kicker={reportKicker("movement")}
        title="Ratio Movement"
        subtitle="Direction of travel across every tracked ratio — 12 months, 6 months, 3 months, today"
        isDemo={isDemo}
      />

      <ExecSummary
        figures={figures}
        narrative={movementNarrative(
          // First period on record: no comparison columns yet, so say so rather
          // than reporting "0 of N improving".
          hasHistory ? counts : { ...counts, total: 0 },
          operatingProfile,
          market ?? ZA_MARKET,
        )}
      />

      {pillars.map((pillar) => {
        const rows = withVerdicts.filter((x) => x.row.pillar === pillar);
        return (
          <View key={pillar}>
            <SectionHeader title={PILLAR_LABEL[pillar]} color={theme.accent} />
            {/* column headers */}
            <View style={S.headerRow}>
              <Text style={[S.headerCell, { flex: 2.2 }]}>Ratio</Text>
              <Text style={[S.headerCell, { flex: 1, textAlign: "right" }]}>
                {labels.twelve_months}
              </Text>
              <Text style={[S.headerCell, { flex: 1, textAlign: "right" }]}>
                {labels.six_months}
              </Text>
              <Text style={[S.headerCell, { flex: 1, textAlign: "right" }]}>
                {labels.three_months}
              </Text>
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
                  <Text
                    style={[
                      S.name,
                      { flex: 2.2, fontFamily: highlight ? "Helvetica-Bold" : "Helvetica" },
                    ]}
                  >
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
                      color={
                        verdict === "improving"
                          ? C.green
                          : verdict.startsWith("declining")
                            ? C.red
                            : C.blue
                      }
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

      <Text
        style={{
          fontSize: 6.5,
          fontFamily: "Helvetica",
          color: C.faint,
          marginTop: 12,
          lineHeight: 1.5,
        }}
      >
        {hasHistory
          ? "Comparison columns show the closest uploaded snapshot to each target date. A dash means no snapshot was available for that window."
          : `${NO_HISTORY_YET}. Comparison columns stay blank until a prior period is on file.`}
      </Text>
    </PDFDocument>
  );
}
