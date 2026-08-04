/**
 * CashCyclePDF — Cash Flow Cycle Report.
 * Page 1: exec summary + day-axis timeline diagram of the conversion cycle.
 * Page 2: cash-trapped callout + working-capital ratio rows.
 *
 * SSR safety: Only import via dynamic import() — never at top level of an
 * SSR-rendered module.
 */

import { Fragment } from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { scoreTier } from "@/lib/ratios";
import { MetricBox } from "@/components/pdf/metric-box";
import { RatioRow } from "@/components/pdf/ratio-row";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { C, fmtRand, fmtRandCompact, fmtPct, resolveTheme } from "@/components/pdf/theme";
import { cashCycleNarrative } from "./narrative";

// ── Types ──────────────────────────────────────────────────────────────────

export type WorkingCapitalData = {
  debtor_days: number;
  debtor_days_prior?: number;
  inventory_days: number;
  inventory_days_prior?: number;
  wip_days: number;
  wip_days_prior?: number;
  creditor_days: number;
  creditor_days_prior?: number;
  cash_conversion_cycle: number;
  ccc_prior?: number;
  working_capital_funding: number;
  working_capital_utilization: number;
  working_capital_days: number;
  annual_revenue: number;
  cash_trapped_rands: number;
  health_scores?: {
    debtor_days?: number;
    inventory_days?: number;
    creditor_days?: number;
    wip_days?: number;
    working_capital_days?: number;
    working_capital_funding?: number;
    working_capital_utilization?: number;
  };
};

export type CashCyclePDFProps = {
  smeData: SmeData;
  workingCapitalData: WorkingCapitalData;
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Fallback score if health_scores not provided */
function daysScore(days: number, goodBelow: number): number {
  if (days <= goodBelow) return 85;
  if (days <= goodBelow * 1.5) return 60;
  if (days <= goodBelow * 2) return 40;
  return 20;
}

// ── Timeline diagram ───────────────────────────────────────────────────────

const TL_W = 515;
const TL_ROW_H = 26;

const tl = StyleSheet.create({
  wrap: { marginBottom: 6 },
  axis: { position: "relative", height: 16 },
  axisLine: { position: "absolute", left: 0, right: 0, top: 10, height: 0.75, backgroundColor: C.line },
  axisTick: { position: "absolute", top: 7, width: 0.75, height: 7, backgroundColor: C.line },
  axisLabel: { position: "absolute", top: 0, fontSize: 5.5, fontFamily: "Helvetica", color: C.faint },
  row: { position: "relative", height: TL_ROW_H },
  segBar: {
    position: "absolute",
    top: 5,
    height: 12,
    borderRadius: 3,
    justifyContent: "center",
  },
  segLabelIn: { fontSize: 6, fontFamily: "Helvetica-Bold", color: C.white, paddingLeft: 6 },
  segLabelOut: { position: "absolute", top: 8, fontSize: 6, fontFamily: "Helvetica-Bold", color: C.body },
  rowName: { position: "absolute", top: 19, fontSize: 5.5, fontFamily: "Helvetica", color: C.faint },
  gapLine: { position: "absolute", top: 0, bottom: 0, width: 0.6, backgroundColor: C.faint, opacity: 0.5 },
  cccRow: { position: "relative", height: 34, marginTop: 4 },
  cccBar: {
    position: "absolute",
    top: 6,
    height: 16,
    borderRadius: 3,
    justifyContent: "center",
    alignItems: "center",
  },
  cccText: { fontSize: 7, fontFamily: "Helvetica-Bold", color: C.white },
  cccCaption: { position: "absolute", top: 25, fontSize: 5.5, fontFamily: "Helvetica-Bold", color: C.redDeep },
  legendNote: { fontSize: 7, fontFamily: "Helvetica", color: C.muted, lineHeight: 1.5, marginTop: 8 },
});

function CycleTimeline({ d, accent }: { d: WorkingCapitalData; accent: string }) {
  const opDays = d.inventory_days + d.wip_days + d.debtor_days; // operating cycle length
  const total = Math.max(opDays, d.creditor_days, 1);
  const x = (days: number) => (days / total) * TL_W;

  // Axis ticks every ~15/30 days depending on scale
  const step = total > 120 ? 30 : 15;
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += step) ticks.push(t);

  const ccc = Math.max(0, d.cash_conversion_cycle);
  const segs = [
    { name: "Inventory", days: d.inventory_days, start: 0, color: accent },
    { name: "Work in Progress", days: d.wip_days, start: d.inventory_days, color: C.blue },
    { name: "Debtors", days: d.debtor_days, start: d.inventory_days + d.wip_days, color: C.blueLight },
  ].filter((s) => s.days > 0);

  return (
    <View style={tl.wrap}>
      {/* Day axis */}
      <View style={tl.axis}>
        <View style={tl.axisLine} />
        {ticks.map((t) => (
          <Fragment key={t}>
            <View style={[tl.axisTick, { left: x(t) }]} />
            <Text style={[tl.axisLabel, { left: Math.max(0, x(t) - 8), width: 24 }]}>{t}d</Text>
          </Fragment>
        ))}
      </View>

      {/* Operating cycle segments */}
      <View style={tl.row}>
        {segs.map((s) => {
          const w = Math.max(3, x(s.days));
          const wide = w > 58;
          return (
            <Fragment key={s.name}>
              <View style={[tl.segBar, { left: x(s.start), width: w, backgroundColor: s.color }]}>
                {wide ? <Text style={tl.segLabelIn}>{`${s.name} · ${Math.round(s.days)}d`}</Text> : null}
              </View>
              {!wide ? (
                <Text style={[tl.segLabelOut, { left: x(s.start) + w + 3 }]}>{`${Math.round(s.days)}d`}</Text>
              ) : null}
              <Text style={[tl.rowName, { left: x(s.start) }]}>{wide ? "" : s.name}</Text>
            </Fragment>
          );
        })}
      </View>

      {/* Creditor days (money you hold) */}
      <View style={tl.row}>
        <View style={[tl.segBar, { left: 0, width: Math.max(3, x(d.creditor_days)), backgroundColor: C.green }]}>
          {x(d.creditor_days) > 80 ? (
            <Text style={tl.segLabelIn}>{`Creditors pay-out delay · ${Math.round(d.creditor_days)}d`}</Text>
          ) : null}
        </View>
        {x(d.creditor_days) <= 80 ? (
          <Text style={[tl.segLabelOut, { left: x(d.creditor_days) + 3 }]}>
            {`Creditors · ${Math.round(d.creditor_days)}d`}
          </Text>
        ) : null}
      </View>

      {/* Funding gap = CCC */}
      <View style={tl.cccRow}>
        <View style={[tl.gapLine, { left: x(d.creditor_days) }]} />
        <View style={[tl.gapLine, { left: x(opDays) }]} />
        <View
          style={[
            tl.cccBar,
            {
              left: x(Math.min(d.creditor_days, opDays)),
              width: Math.max(4, x(ccc)),
              backgroundColor: ccc > 0 ? C.red : C.green,
            },
          ]}
        >
          <Text style={tl.cccText}>{`Funding gap · ${Math.round(d.cash_conversion_cycle)} days`}</Text>
        </View>
        <Text style={[tl.cccCaption, { left: x(Math.min(d.creditor_days, opDays)) }]}>
          Cash Conversion Cycle — days the business must fund itself
        </Text>
      </View>

      <Text style={tl.legendNote}>
        Cash leaves the business on day 0 (stock purchased) and only returns once debtors pay on
        day {Math.round(opDays)}. Suppliers are paid on day {Math.round(d.creditor_days)} — the red
        band is the gap the business must finance from its own cash or borrowings.
      </Text>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function CashCyclePDF({
  smeData,
  workingCapitalData: d,
  accountantProfile,
  isDemo,
}: CashCyclePDFProps) {
  const theme = resolveTheme(accountantProfile);
  const hs = d.health_scores ?? {};
  const dailyRevenue = d.annual_revenue / 365;

  const cccDelta = d.ccc_prior !== undefined ? d.cash_conversion_cycle - d.ccc_prior : undefined;

  const figures: HeadlineFigure[] = [
    {
      label: "Cash Conversion Cycle",
      value: `${Math.round(d.cash_conversion_cycle)} d`,
      direction: cccDelta === undefined ? undefined : cccDelta < 0 ? "down" : cccDelta > 0 ? "up" : "flat",
      good: cccDelta === undefined ? d.cash_conversion_cycle <= 60 : cccDelta <= 0,
      note: cccDelta !== undefined ? `${cccDelta > 0 ? "+" : ""}${Math.round(cccDelta)}d vs prior` : undefined,
    },
    {
      label: "Cash Trapped",
      value: fmtRandCompact(d.cash_trapped_rands),
      good: false,
      note: "locked in working capital",
    },
    {
      label: "Debtor Days",
      value: `${Math.round(d.debtor_days)} d`,
      direction: d.debtor_days_prior === undefined ? undefined : d.debtor_days < d.debtor_days_prior ? "down" : "up",
      good: d.debtor_days_prior === undefined ? d.debtor_days <= 45 : d.debtor_days <= d.debtor_days_prior,
    },
    {
      label: "1-Day Improvement",
      value: fmtRandCompact(dailyRevenue),
      good: true,
      note: "cash released per day saved",
    },
  ];

  const narrative = cashCycleNarrative({
    ccc: Math.round(d.cash_conversion_cycle),
    cccPrior: d.ccc_prior !== undefined ? Math.round(d.ccc_prior) : undefined,
    cashTrapped: d.cash_trapped_rands,
    dailyRevenue,
  });

  const ratioRows = [
    { name: "Debtor Days", value: `${Math.round(d.debtor_days)} d`, score: hs.debtor_days ?? daysScore(d.debtor_days, 40) },
    { name: "Inventory Days", value: `${Math.round(d.inventory_days)} d`, score: hs.inventory_days ?? daysScore(d.inventory_days, 45) },
    ...(d.wip_days > 0
      ? [{ name: "WIP Days", value: `${Math.round(d.wip_days)} d`, score: hs.wip_days ?? daysScore(d.wip_days, 15) }]
      : []),
    { name: "Creditor Days", value: `${Math.round(d.creditor_days)} d`, score: hs.creditor_days ?? 70 },
    { name: "Working Capital Days", value: `${Math.round(d.working_capital_days)} d`, score: hs.working_capital_days ?? daysScore(d.working_capital_days, 60) },
    { name: "WC Funding Intensity", value: fmtPct(d.working_capital_funding), score: hs.working_capital_funding ?? 50 },
    { name: "WC Utilization", value: fmtPct(d.working_capital_utilization), score: hs.working_capital_utilization ?? 60 },
  ];

  return (
    <PDFDocument
      title={`Cash Flow Cycle — ${smeData.name}`}
      subject="Cash Flow Cycle Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
    >
      {/* ── PAGE 1 ── */}
      <ReportTitle
        kicker="Advisory Report 04"
        title="Cash Flow Cycle"
        subtitle="How long each rand is trapped between paying suppliers and collecting from customers"
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={narrative} />

      <SectionHeader title="Conversion Cycle Timeline" color={theme.accent} />
      <CycleTimeline d={d} accent={theme.accent} />

      <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
        <MetricBox
          label="Inventory Days"
          value={`${Math.round(d.inventory_days)} d`}
          change={
            d.inventory_days_prior !== undefined && d.inventory_days_prior !== 0
              ? ((d.inventory_days - d.inventory_days_prior) / d.inventory_days_prior) * 100
              : undefined
          }
          lowerIsBetter
          accentColor={theme.accent}
        />
        <MetricBox
          label="Debtor Days"
          value={`${Math.round(d.debtor_days)} d`}
          change={
            d.debtor_days_prior !== undefined && d.debtor_days_prior !== 0
              ? ((d.debtor_days - d.debtor_days_prior) / d.debtor_days_prior) * 100
              : undefined
          }
          lowerIsBetter
          accentColor={C.blue}
        />
        <MetricBox
          label="Creditor Days"
          value={`${Math.round(d.creditor_days)} d`}
          change={
            d.creditor_days_prior !== undefined && d.creditor_days_prior !== 0
              ? ((d.creditor_days - d.creditor_days_prior) / d.creditor_days_prior) * 100
              : undefined
          }
          accentColor={C.green}
        />
        <MetricBox
          label="Cycle"
          value={`${Math.round(d.cash_conversion_cycle)} d`}
          change={
            d.ccc_prior !== undefined && d.ccc_prior !== 0
              ? ((d.cash_conversion_cycle - d.ccc_prior) / d.ccc_prior) * 100
              : undefined
          }
          lowerIsBetter
          accentColor={d.cash_conversion_cycle > 60 ? C.red : C.green}
        />
      </View>

      {/* ── PAGE 2 ── */}
      <View break>
        <SectionHeader title="Cash Trapped in the Cycle" color={theme.accent} />
        <View
          style={{
            borderRadius: 6,
            borderWidth: 0.75,
            borderColor: C.line,
            borderLeftWidth: 2.5,
            borderLeftColor: C.red,
            backgroundColor: C.soft,
            padding: 14,
            marginBottom: 6,
          }}
        >
          <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: C.redDeep, marginBottom: 4 }}>
            {fmtRand(d.cash_trapped_rands)}
          </Text>
          <Text style={{ fontSize: 8.5, fontFamily: "Helvetica", color: C.body, lineHeight: 1.55 }}>
            is currently locked up funding the {Math.round(d.cash_conversion_cycle)}-day gap between
            paying suppliers and collecting from customers. Shortening the cycle by just one day
            releases approximately {fmtRand(dailyRevenue)} of cash back into the business.
          </Text>
        </View>

        <SectionHeader title="Working Capital Ratio Analysis" color={theme.accent} />
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
      </View>
    </PDFDocument>
  );
}
