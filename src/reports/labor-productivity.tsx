/**
 * LaborProductivityPDF — Labor Productivity Report.
 * Page 1: exec summary + headline metrics + revenue vs labor cost trend.
 * Page 2: period table + ratio rows.
 *
 * SSR safety: Only import via dynamic import().
 */

import { Fragment } from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData, type ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { scoreTier } from "@/lib/ratios";
import { MetricBox } from "@/components/pdf/metric-box";
import { RatioRow } from "@/components/pdf/ratio-row";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { C, fmtRand, fmtRandCompact, fmtPct, resolveTheme } from "@/components/pdf/theme";
import { laborNarrative } from "./narrative";
import type { ClientOperatingProfile } from "@/lib/client-profile";
import {
  laborCostLabel,
  laborProductivityTitle,
  t,
  ZA_MARKET,
  type ResolvedMarket,
} from "@/lib/market";
import { reportKicker } from "@/lib/report-catalog";

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
  /** False when COGS missing — total_gp must not be treated as a real gross profit. */
  gp_known: boolean;
  revenue_per_employee: number;
  /** Prior-period RPE when a prior snapshot exists; otherwise null (never invent). */
  rpe_prior: number | null;
  gp_per_labor_rand: number | null;
  /** YoY revenue growth when prior revenue known; otherwise null. */
  revenue_growth: number | null;
  /** External inflation assumption — null unless explicitly provided (never invent CPI). */
  inflation_rate: number | null;
  periods: LaborPeriod[];
  health_scores: {
    gpToLabor: number | null;
    /** Null when headcount is missing — the same "Not scored" as the playbook card. */
    salesPerEmployee: number | null;
    revenueGrowth: number | null;
  };
};

export type LaborProductivityPDFProps = {
  /** Owner operating profile — shapes narrative wording only. */
  operatingProfile?: ClientOperatingProfile | null;
  smeData: SmeData;
  data: LaborProductivityData | null;
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
  /** Fictional client (`clients.is_demo`). Live figures, SAMPLE stamp. */
  sample?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
  market?: ResolvedMarket;
  /** Live client missing headcount or labor cost. The ZIP still includes the report. */
  unavailableReason?: string | null;
};

// ── Trend chart (grouped bars: revenue vs labor cost) ─────────────────────

const CH_W = 515;
const CH_H = 110;
const CH_LABEL_H = 22;

const ch = StyleSheet.create({
  container: { position: "relative", height: CH_H + CH_LABEL_H, marginBottom: 4 },
  gridLine: { position: "absolute", left: 0, right: 0, height: 0.5, backgroundColor: C.hairline },
  bar: { position: "absolute", borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  label: {
    position: "absolute",
    bottom: 3,
    fontSize: 6,
    textAlign: "center",
    fontFamily: "Helvetica",
    color: C.muted,
  },
  empLabel: {
    position: "absolute",
    fontSize: 5.5,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    color: C.ink,
  },
  legend: { flexDirection: "row", gap: 16, marginTop: 4, marginBottom: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 2 },
  legendText: { fontSize: 6.5, color: C.muted, fontFamily: "Helvetica" },
  empty: {
    backgroundColor: C.soft,
    borderRadius: 5,
    borderWidth: 0.75,
    borderColor: C.line,
    padding: 16,
    alignItems: "center",
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 8,
    color: C.muted,
    fontFamily: "Helvetica",
    textAlign: "center",
    lineHeight: 1.5,
  },
});

function LaborTrend({
  periods,
  accent,
  wageLabel,
}: {
  periods: LaborPeriod[];
  accent: string;
  wageLabel: string;
}) {
  if (periods.length < 2) {
    return (
      <View style={ch.empty}>
        <Text style={ch.emptyText}>
          The revenue-versus-wages trend appears once at least two periods are uploaded.
        </Text>
      </View>
    );
  }

  const maxVal = Math.max(...periods.flatMap((p) => [p.revenue, p.labor_cost]), 1);
  const n = periods.length;
  const slot = CH_W / n;
  const barW = (slot - 12) / 2;

  return (
    <View>
      <View style={ch.container}>
        {[0.25, 0.5, 0.75].map((p, i) => (
          <View key={i} style={[ch.gridLine, { bottom: CH_LABEL_H + p * CH_H }]} />
        ))}
        {periods.map((p, i) => {
          const revH = Math.max(2, (p.revenue / maxVal) * CH_H);
          const labH = Math.max(2, (p.labor_cost / maxVal) * CH_H);
          const left = i * slot + 6;
          return (
            <Fragment key={i}>
              <View
                style={[
                  ch.bar,
                  { left, bottom: CH_LABEL_H, width: barW, height: revH, backgroundColor: accent },
                ]}
              />
              <View
                style={[
                  ch.bar,
                  {
                    left: left + barW + 3,
                    bottom: CH_LABEL_H,
                    width: barW,
                    height: labH,
                    backgroundColor: C.blueLight,
                  },
                ]}
              />
              <Text
                style={[
                  ch.empLabel,
                  { left: i * slot, width: slot, bottom: CH_LABEL_H + revH + 3 },
                ]}
              >
                {p.employees} staff
              </Text>
              <Text style={[ch.label, { left: i * slot, width: slot }]}>{p.label}</Text>
            </Fragment>
          );
        })}
      </View>
      <View style={ch.legend}>
        <View style={ch.legendItem}>
          <View style={[ch.legendDot, { backgroundColor: accent }]} />
          <Text style={ch.legendText}>Revenue</Text>
        </View>
        <View style={ch.legendItem}>
          <View style={[ch.legendDot, { backgroundColor: C.blueLight }]} />
          <Text style={ch.legendText}>{wageLabel}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function LaborProductivityPDF({
  smeData,
  data: d,
  accountantProfile,
  isDemo,
  sample,
  reviewSignoff,
  operatingProfile,
  market,
  unavailableReason,
}: LaborProductivityPDFProps) {
  const theme = resolveTheme(accountantProfile);
  const m = market ?? ZA_MARKET;
  const wageLabel = laborCostLabel(m);
  if (!d) {
    return (
      <PDFDocument
        title={`${laborProductivityTitle(m)} — ${smeData.name}`}
        subject={`${laborProductivityTitle(m)} Report`}
        smeData={smeData}
        accountantProfile={accountantProfile}
        isDemo={isDemo}
        sample={sample}
        reviewSignoff={reviewSignoff}
        market={m}
      >
        <ReportTitle
          kicker={reportKicker("labor")}
          title={laborProductivityTitle(m)}
          subtitle={`What each employee and each ${t("currencyWord", m)} of wages contributes to revenue and profit`}
          isDemo={isDemo}
        />
        <View style={ch.empty}>
          <Text style={ch.emptyText}>
            {unavailableReason ||
              `${laborProductivityTitle(m)} needs revenue on the file. Nothing is on file yet, so no ratios were calculated.`}
          </Text>
        </View>
      </PDFDocument>
    );
  }
  const hs = d.health_scores;
  const headcountKnown = d.employee_count > 0 && Number.isFinite(d.revenue_per_employee);
  const realGrowth =
    d.revenue_growth != null && d.inflation_rate != null
      ? d.revenue_growth - d.inflation_rate
      : null;
  const rpeChange =
    d.rpe_prior != null && d.rpe_prior !== 0
      ? ((d.revenue_per_employee - d.rpe_prior) / d.rpe_prior) * 100
      : undefined;
  const laborShare = d.total_revenue !== 0 ? d.total_labor_cost / d.total_revenue : NaN;
  const gpPerLabor = d.gp_per_labor_rand;

  const figures: HeadlineFigure[] = [
    {
      label: "Revenue / Employee",
      value: headcountKnown ? fmtRandCompact(d.revenue_per_employee, m) : "—",
      direction: !headcountKnown || rpeChange === undefined ? undefined : rpeChange >= 0 ? "up" : "down",
      good: !headcountKnown || rpeChange === undefined ? undefined : rpeChange >= 0,
      note: !headcountKnown
        ? "Not scored"
        : rpeChange !== undefined
          ? `${rpeChange >= 0 ? "+" : ""}${rpeChange.toFixed(1)}% vs prior`
          : "No prior period",
    },
    {
      label: `GP per ${fmtRand(1, m)} of wages`,
      value: gpPerLabor != null ? fmtRand(gpPerLabor, m) : "—",
      good: hs.gpToLabor != null ? scoreTier(hs.gpToLabor) === "healthy" : undefined,
      note: d.gp_known ? undefined : "COGS required",
    },
    {
      label: "Headcount",
      value: headcountKnown ? `${d.employee_count}` : "—",
      note: !headcountKnown
        ? "Not scored"
        : Number.isFinite(laborShare)
          ? `${fmtPct(laborShare)} of revenue on wages`
          : undefined,
    },
    {
      label: "Real Growth",
      value: realGrowth != null ? fmtPct(realGrowth) : "—",
      direction: realGrowth == null ? undefined : realGrowth >= 0 ? "up" : "down",
      good: realGrowth == null ? undefined : realGrowth >= 0,
      note:
        realGrowth != null ? "revenue growth less inflation" : "Needs prior revenue + inflation",
    },
  ];

  const narrative = laborNarrative(
    {
      revenuePerEmployee: d.revenue_per_employee,
      gpPerLaborRand: gpPerLabor ?? NaN,
      realGrowth,
      headcountKnown,
    },
    operatingProfile,
    m,
  );

  const ratioRows: Array<{ name: string; value: string; score: number | null }> = [
    {
      name: m.copyPack === "us" ? "GP-to-Labor Ratio" : "GP-to-Labour Ratio",
      value: gpPerLabor != null ? `${fmtRand(gpPerLabor, m)} / ${fmtRand(1, m)}` : "—",
      score: hs.gpToLabor,
    },
    {
      name: "Sales per Employee",
      value: headcountKnown ? fmtRandCompact(d.revenue_per_employee, m) : "—",
      score: headcountKnown ? hs.salesPerEmployee : null,
    },
    {
      name: "Real Revenue Growth",
      value: realGrowth != null ? fmtPct(realGrowth) : "—",
      score: hs.revenueGrowth,
    },
  ];

  return (
    <PDFDocument
      title={`${laborProductivityTitle(m)} — ${smeData.name}`}
      subject={`${laborProductivityTitle(m)} Report`}
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
      sample={sample}
      reviewSignoff={reviewSignoff}
      market={m}
    >
      {/* ── PAGE 1 ── */}
      <ReportTitle
        kicker={reportKicker("labor")}
        title={laborProductivityTitle(m)}
        subtitle={`What each employee and each ${t("currencyWord", m)} of wages contributes to revenue and profit`}
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={narrative} />

      <View style={{ flexDirection: "row", gap: 10, marginBottom: 6 }}>
        <MetricBox
          label="Total Revenue"
          value={fmtRand(d.total_revenue, m)}
          accentColor={theme.accent}
        />
        <MetricBox
          label={wageLabel}
          value={fmtRand(d.total_labor_cost, m)}
          accentColor={C.blue}
          note={fmtPct(laborShare) + " of revenue"}
        />
        <MetricBox
          label="Gross Profit"
          value={d.gp_known ? fmtRand(d.total_gp, m) : "—"}
          accentColor={C.green}
          note={d.gp_known ? undefined : "COGS required"}
        />
      </View>

      <SectionHeader title={`Revenue vs ${wageLabel}`} color={theme.accent} />
      <LaborTrend periods={d.periods} accent={theme.accent} wageLabel={wageLabel} />

      {/* ── PAGE 2 ── */}
      <View break>
        <SectionHeader title="Period Detail" color={theme.accent} />
        <View
          style={{
            borderRadius: 5,
            overflow: "hidden",
            borderWidth: 0.75,
            borderColor: C.line,
            marginBottom: 10,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: theme.accent,
            }}
          >
            {["Period", "Revenue", "Employees", wageLabel, "Rev / Employee"].map((h, i) => (
              <Text
                key={h}
                style={{
                  flex: i === 0 ? 1.4 : 1.2,
                  fontSize: 6.5,
                  fontFamily: "Helvetica-Bold",
                  color: C.white,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  textAlign: i === 0 ? "left" : "right",
                }}
              >
                {h}
              </Text>
            ))}
          </View>
          {d.periods.map((p, i) => (
            <View
              key={i}
              style={{
                flexDirection: "row",
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderTopWidth: 0.5,
                borderTopColor: C.hairline,
                backgroundColor: i % 2 === 1 ? C.soft : C.white,
              }}
            >
              <Text style={{ flex: 1.4, fontSize: 8, fontFamily: "Helvetica-Bold", color: C.ink }}>
                {p.label}
              </Text>
              <Text
                style={{
                  flex: 1.2,
                  fontSize: 8,
                  fontFamily: "Helvetica",
                  color: C.body,
                  textAlign: "right",
                }}
              >
                {fmtRand(p.revenue, m)}
              </Text>
              <Text
                style={{
                  flex: 1.2,
                  fontSize: 8,
                  fontFamily: "Helvetica",
                  color: C.body,
                  textAlign: "right",
                }}
              >
                {p.employees}
              </Text>
              <Text
                style={{
                  flex: 1.2,
                  fontSize: 8,
                  fontFamily: "Helvetica",
                  color: C.body,
                  textAlign: "right",
                }}
              >
                {fmtRand(p.labor_cost, m)}
              </Text>
              <Text
                style={{
                  flex: 1.2,
                  fontSize: 8,
                  fontFamily: "Helvetica",
                  color: C.body,
                  textAlign: "right",
                }}
              >
                {p.employees > 0 ? fmtRandCompact(p.revenue / p.employees, m) : "—"}
              </Text>
            </View>
          ))}
        </View>

        <SectionHeader title={`${laborProductivityTitle(m)} ratios`} color={theme.accent} />
        {ratioRows.map((r, i) => (
          <RatioRow
            key={r.name}
            ratioName={r.name}
            formattedValue={r.value}
            healthScore={r.score ?? 0}
            healthTier={scoreTier(r.score)}
            unscored={r.score == null}
            isAlternate={i % 2 === 1}
          />
        ))}
      </View>
    </PDFDocument>
  );
}
