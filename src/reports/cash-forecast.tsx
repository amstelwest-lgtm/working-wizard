/**
 * CashForecastPDF — 13-Week Rolling Cash Flow Forecast.
 * Page 1: exec summary + runway chart with shaded danger zone and threshold
 * line. Page 2: full data table + assumptions.
 *
 * SSR safety: Only import via dynamic import() — never at top level of an
 * SSR-rendered module.
 */

import { Fragment } from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData, type ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { MetricBox } from "@/components/pdf/metric-box";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { C, fmtRand, fmtRandCompact, resolveTheme } from "@/components/pdf/theme";
import { usePdfMarket } from "@/components/pdf/pdf-market";
import { cashForecastNarrative } from "./narrative";
import type { ClientOperatingProfile } from "@/lib/client-profile";
import { profileCashAssumptions } from "@/lib/profile-signals";
import { CASH_RUNWAY_THRESHOLD_RAND } from "@/lib/cash-runway";
import { ZA_MARKET, type ResolvedMarket } from "@/lib/market";

// ── Types ──────────────────────────────────────────────────────────────────

export type CashForecastWeek = {
  period_label: string;
  opening_balance: number;
  total_receipts: number;
  total_payments: number;
  net_movement: number;
  closing_balance: number;
  scenario: "critical" | "moderate" | "growth";
  runway_weeks: number;
};

export type CashForecastPDFProps = {
  /** Owner operating profile — shapes narrative wording only. */
  operatingProfile?: ClientOperatingProfile | null;
  smeData: SmeData;
  cashForecast: CashForecastWeek[];
  scenario: "critical" | "moderate" | "growth";
  accountantProfile: AccountantProfile;
  minimumThreshold?: number;
  assumptions?: string[];
  isDemo?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
  market?: ResolvedMarket;
};

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = CASH_RUNWAY_THRESHOLD_RAND;
const CHART_W = 515;
const CHART_H = 130;
const LABEL_H = 20;

const SCENARIO_META: Record<string, { label: string; color: string }> = {
  critical: { label: "Critical scenario", color: C.red },
  moderate: { label: "Moderate scenario", color: C.blue },
  growth: { label: "Growth scenario", color: C.green },
};

const DEFAULT_ASSUMPTIONS = [
  "Cash receipts are based on current debtor-day patterns and projected sales volume.",
  "Payments reflect existing supplier terms, contracted fixed costs, and known variable outflows.",
  "Tax and loan repayments follow the current scheduled payment calendar.",
  "No extraordinary capital expenditure, asset disposals, or one-off items are assumed in this forecast.",
];

// ── Runway chart ───────────────────────────────────────────────────────────

const ch = StyleSheet.create({
  container: { position: "relative", height: CHART_H + LABEL_H, marginBottom: 6 },
  gridLine: { position: "absolute", left: 0, right: 0, height: 0.5, backgroundColor: C.hairline },
  gridLabel: {
    position: "absolute",
    left: 0,
    fontSize: 5.5,
    fontFamily: "Helvetica",
    color: C.faint,
  },
  dangerZone: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: LABEL_H,
    backgroundColor: C.redSoft,
    opacity: 0.7,
  },
  thresholdLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0.9,
    backgroundColor: C.red,
  },
  thresholdTag: {
    position: "absolute",
    right: 0,
    fontSize: 5.5,
    fontFamily: "Helvetica-Bold",
    color: C.redDeep,
  },
  bar: { position: "absolute", borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5 },
  weekLabel: {
    position: "absolute",
    bottom: 3,
    fontSize: 5.5,
    textAlign: "center",
    fontFamily: "Helvetica",
    color: C.muted,
  },
  legend: { flexDirection: "row", gap: 14, marginTop: 2, marginBottom: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 2 },
  legendText: { fontSize: 6.5, color: C.muted, fontFamily: "Helvetica" },
});

function RunwayChart({
  weeks,
  threshold,
  accent,
}: {
  weeks: CashForecastWeek[];
  threshold: number;
  accent: string;
}) {
  const market = usePdfMarket();
  const values = weeks.map((w) => w.closing_balance);
  const maxVal = Math.max(...values, threshold, 1);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal || 1;
  const y = (v: number) => ((v - minVal) / range) * CHART_H;

  const n = weeks.length;
  const slot = CHART_W / n;
  const barW = Math.max(6, slot - 8);
  const thresholdY = LABEL_H + y(threshold);

  return (
    <View>
      <View style={ch.container}>
        {/* danger zone: below threshold */}
        <View style={[ch.dangerZone, { height: Math.max(0, y(threshold)) }]} />

        {[0.25, 0.5, 0.75, 1].map((p, i) => (
          <View key={i} style={[ch.gridLine, { bottom: LABEL_H + p * CHART_H }]} />
        ))}

        {/* bars */}
        {weeks.map((w, i) => {
          const v = w.closing_balance;
          const below = v < threshold;
          const zero = y(Math.max(0, minVal < 0 ? 0 : minVal));
          const top = y(Math.max(v, minVal < 0 ? 0 : minVal));
          const bottom = Math.min(zero, y(v));
          const h = Math.max(2, Math.abs(top - bottom));
          return (
            <Fragment key={i}>
              <View
                style={[
                  ch.bar,
                  {
                    left: i * slot + (slot - barW) / 2,
                    bottom: LABEL_H + bottom,
                    width: barW,
                    height: h,
                    backgroundColor: v < 0 ? C.red : below ? C.amber : accent,
                  },
                ]}
              />
              <Text style={[ch.weekLabel, { left: i * slot, width: slot }]}>
                {w.period_label.replace(/^Week /i, "W")}
              </Text>
            </Fragment>
          );
        })}

        {/* threshold line on top */}
        <View style={[ch.thresholdLine, { bottom: thresholdY }]} />
        <Text style={[ch.thresholdTag, { bottom: thresholdY + 2 }]}>
          MINIMUM {fmtRandCompact(threshold, market)}
        </Text>
      </View>

      <View style={ch.legend}>
        <View style={ch.legendItem}>
          <View style={[ch.legendDot, { backgroundColor: accent }]} />
          <Text style={ch.legendText}>Closing balance</Text>
        </View>
        <View style={ch.legendItem}>
          <View style={[ch.legendDot, { backgroundColor: C.amber }]} />
          <Text style={ch.legendText}>Below minimum</Text>
        </View>
        <View style={ch.legendItem}>
          <View style={[ch.legendDot, { backgroundColor: C.red }]} />
          <Text style={ch.legendText}>Negative balance</Text>
        </View>
        <View style={ch.legendItem}>
          <View style={[ch.legendDot, { backgroundColor: C.redSoft }]} />
          <Text style={ch.legendText}>Danger zone</Text>
        </View>
      </View>
    </View>
  );
}

// ── Weekly table ───────────────────────────────────────────────────────────

const tbl = StyleSheet.create({
  wrapper: {
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 0.75,
    borderColor: C.line,
    marginBottom: 12,
  },
  headerRow: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 8 },
  headerCell: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: C.white,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: 0.5,
    borderTopColor: C.hairline,
  },
  cell: { fontSize: 7.5, fontFamily: "Helvetica", color: C.body },
});

function WeekTable({
  weeks,
  threshold,
  accent,
}: {
  weeks: CashForecastWeek[];
  threshold: number;
  accent: string;
}) {
  const market = usePdfMarket();
  const cols = [
    { label: "Week", flex: 1.1 },
    { label: "Opening", flex: 1.4, right: true },
    { label: "Receipts", flex: 1.4, right: true },
    { label: "Payments", flex: 1.4, right: true },
    { label: "Net", flex: 1.3, right: true },
    { label: "Closing", flex: 1.4, right: true },
  ];
  return (
    <View style={tbl.wrapper}>
      <View style={[tbl.headerRow, { backgroundColor: accent }]}>
        {cols.map((c, i) => (
          <Text
            key={i}
            style={[tbl.headerCell, { flex: c.flex, textAlign: c.right ? "right" : "left" }]}
          >
            {c.label}
          </Text>
        ))}
      </View>
      {weeks.map((w, i) => {
        const danger = w.closing_balance < threshold;
        return (
          <View
            key={i}
            style={[
              tbl.row,
              { backgroundColor: danger ? C.redSoft : i % 2 === 1 ? C.soft : C.white },
            ]}
          >
            <Text style={[tbl.cell, { flex: 1.1, fontFamily: "Helvetica-Bold", color: C.ink }]}>
              {w.period_label}
            </Text>
            <Text style={[tbl.cell, { flex: 1.4, textAlign: "right" }]}>
              {fmtRand(w.opening_balance, market)}
            </Text>
            <Text style={[tbl.cell, { flex: 1.4, textAlign: "right", color: C.greenDeep }]}>
              {fmtRand(w.total_receipts, market)}
            </Text>
            <Text style={[tbl.cell, { flex: 1.4, textAlign: "right", color: C.redDeep }]}>
              ({fmtRand(Math.abs(w.total_payments), market)})
            </Text>
            <Text
              style={[
                tbl.cell,
                {
                  flex: 1.3,
                  textAlign: "right",
                  color: w.net_movement >= 0 ? C.greenDeep : C.redDeep,
                },
              ]}
            >
              {fmtRand(w.net_movement, market)}
            </Text>
            <Text
              style={[
                tbl.cell,
                {
                  flex: 1.4,
                  textAlign: "right",
                  fontFamily: "Helvetica-Bold",
                  color: danger ? C.redDeep : C.ink,
                },
              ]}
            >
              {fmtRand(w.closing_balance, market)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function CashForecastPDF({
  smeData,
  cashForecast,
  scenario,
  accountantProfile,
  minimumThreshold = DEFAULT_THRESHOLD,
  assumptions = DEFAULT_ASSUMPTIONS,
  isDemo,
  reviewSignoff,
  operatingProfile,
  market,
}: CashForecastPDFProps) {
  const theme = resolveTheme(accountantProfile);
  const m = market ?? ZA_MARKET;
  const weeks = cashForecast;
  const scenarioMeta = SCENARIO_META[scenario] ?? SCENARIO_META.moderate;
  const resolvedAssumptions = [...assumptions, ...profileCashAssumptions(operatingProfile)];

  const closings = weeks.map((w) => w.closing_balance);
  const minBalance = Math.min(...closings);
  const weeksBelow = weeks.filter((w) => w.closing_balance < minimumThreshold).length;
  const firstBreach = weeks.findIndex((w) => w.closing_balance < minimumThreshold);
  const runwayWeeks = firstBreach === -1 ? weeks.length : firstBreach;
  const totalReceipts = weeks.reduce((s, w) => s + w.total_receipts, 0);
  const totalPayments = weeks.reduce((s, w) => s + Math.abs(w.total_payments), 0);
  const endBalance = weeks[weeks.length - 1]?.closing_balance ?? 0;
  const startBalance = weeks[0]?.opening_balance ?? 0;

  const figures: HeadlineFigure[] = [
    {
      label: "Runway",
      value: firstBreach === -1 ? `${weeks.length}+ wks` : `${runwayWeeks} wks`,
      good: firstBreach === -1,
      direction: firstBreach === -1 ? "up" : "down",
      note: `above ${fmtRandCompact(minimumThreshold, m)} minimum`,
    },
    {
      label: "Lowest Balance",
      value: fmtRandCompact(minBalance, m),
      good: minBalance >= minimumThreshold,
      note: "projected trough",
    },
    {
      label: "Closing Position",
      value: fmtRandCompact(endBalance, m),
      direction: endBalance >= startBalance ? "up" : "down",
      good: endBalance >= startBalance,
      note: "end of horizon",
    },
    {
      label: "Net Flow",
      value: fmtRandCompact(totalReceipts - totalPayments, m),
      good: totalReceipts >= totalPayments,
      note: "over 13 weeks",
    },
  ];

  const narrative = cashForecastNarrative(
    {
      runwayWeeks,
      minBalance,
      threshold: minimumThreshold,
      weeksBelow,
    },
    operatingProfile,
    m,
  );

  return (
    <PDFDocument
      title={`13-Week Cash Forecast — ${smeData.name}`}
      subject="Cash Flow Forecast"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
      reviewSignoff={reviewSignoff}
      market={m}
    >
      {/* ── PAGE 1 ── */}
      <ReportTitle
        kicker={`Advisory Report 03 · ${scenarioMeta.label}`}
        title="13-Week Cash Forecast"
        subtitle="Projected cash position, runway, and the danger threshold that triggers action"
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={narrative} />

      <SectionHeader title="Projected Closing Balance by Week" color={theme.accent} />
      <RunwayChart weeks={weeks} threshold={minimumThreshold} accent={theme.accent} />

      <View style={{ flexDirection: "row", gap: 10 }}>
        <MetricBox
          label="Total Receipts"
          value={fmtRand(totalReceipts, m)}
          accentColor={C.green}
          note="13-week inflows"
        />
        <MetricBox
          label="Total Payments"
          value={fmtRand(totalPayments, m)}
          accentColor={C.red}
          note="13-week outflows"
        />
        <MetricBox
          label="Weeks Below Minimum"
          value={`${weeksBelow}`}
          accentColor={weeksBelow > 0 ? C.red : C.green}
          note={weeksBelow > 0 ? "action required" : "none projected"}
        />
      </View>

      {/* ── PAGE 2 ── */}
      <View break>
        <SectionHeader title="Weekly Cash Movement Detail" color={theme.accent} />
        <WeekTable weeks={weeks} threshold={minimumThreshold} accent={theme.accent} />

        <SectionHeader title="Forecast Assumptions" color={theme.accent} />
        <View
          style={{
            backgroundColor: C.soft,
            borderRadius: 5,
            borderWidth: 0.75,
            borderColor: C.line,
            padding: 12,
          }}
        >
          {resolvedAssumptions.map((a, i) => (
            <View
              key={i}
              style={{
                flexDirection: "row",
                marginBottom: i < resolvedAssumptions.length - 1 ? 6 : 0,
              }}
            >
              <Text style={{ fontSize: 8, color: C.faint, width: 12 }}>•</Text>
              <Text
                style={{
                  fontSize: 8,
                  color: C.body,
                  fontFamily: "Helvetica",
                  lineHeight: 1.5,
                  flex: 1,
                }}
              >
                {a}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </PDFDocument>
  );
}
