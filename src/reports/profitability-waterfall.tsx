/**
 * ProfitabilityWaterfallPDF — Profitability Waterfall Report.
 * Page 1: exec summary + true bridge chart (floating bars, connector lines,
 * green/red step colouring). Page 2: comparison table + profit ratio rows.
 *
 * SSR safety: Only import via dynamic import() — never at top level of an
 * SSR-rendered module.
 */

import { Fragment } from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { scoreTier } from "@/lib/ratios";
import { C, fmtRand, fmtRandCompact, fmtPct, resolveTheme } from "@/components/pdf/theme";
import { RatioRow } from "@/components/pdf/ratio-row";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { profitabilityNarrative } from "./narrative";

// ── Types ──────────────────────────────────────────────────────────────────

export type PeriodData = {
  revenue: number;
  gross_profit: number;
  gross_margin_pct: number;
  gross_margin_score?: number;
  gross_margin_tier?: string;
  operating_profit: number;
  operating_margin_pct: number;
  operating_margin_score?: number;
  operating_margin_tier?: string;
  ebt: number;
  interest_burden_pct?: number;
  interest_burden_score?: number;
  tax: number;
  tax_burden_pct?: number;
  tax_burden_score?: number;
  net_profit: number;
  net_margin_pct: number;
  net_margin_score?: number;
  net_margin_tier?: string;
};

export type ProfitabilityData = PeriodData & {
  prior_period?: PeriodData;
};

export type ProfitabilityWaterfallPDFProps = {
  smeData: SmeData;
  profitabilityData: ProfitabilityData;
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
};

// ── Bridge chart ───────────────────────────────────────────────────────────

const BR_W = 515;
const BR_H = 170;
const BR_LABEL_H = 30;
const BR_VALUE_H = 14;

type BridgeStep = {
  label: string;
  /** Absolute delta (negative = cost step). */
  delta: number;
  /** Running total after this step. */
  runningEnd: number;
  kind: "total" | "decrease" | "subtotal";
};

const brStyles = StyleSheet.create({
  container: {
    position: "relative",
    height: BR_H + BR_LABEL_H + BR_VALUE_H,
    marginBottom: 4,
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0.5,
    backgroundColor: C.hairline,
  },
  baseline: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: BR_LABEL_H,
    height: 0.75,
    backgroundColor: C.line,
  },
  bar: { position: "absolute", borderRadius: 2 },
  connector: { position: "absolute", height: 0.75, backgroundColor: C.faint },
  colLabel: {
    position: "absolute",
    bottom: 4,
    fontSize: 6,
    textAlign: "center",
    fontFamily: "Helvetica",
    color: C.muted,
    lineHeight: 1.2,
  },
  valueLabel: {
    position: "absolute",
    fontSize: 6,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
  },
  legend: { flexDirection: "row", gap: 14, marginTop: 2, marginBottom: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 2 },
  legendText: { fontSize: 6.5, color: C.muted, fontFamily: "Helvetica" },
});

function BridgeChart({ d, accent }: { d: ProfitabilityData; accent: string }) {
  const cogs = d.revenue - d.gross_profit;
  const opex = d.gross_profit - d.operating_profit;
  const interest = d.operating_profit - d.ebt;

  const steps: BridgeStep[] = [
    { label: "Revenue", delta: d.revenue, runningEnd: d.revenue, kind: "total" },
    { label: "COGS", delta: -cogs, runningEnd: d.gross_profit, kind: "decrease" },
    { label: "Gross\nProfit", delta: d.gross_profit, runningEnd: d.gross_profit, kind: "subtotal" },
    { label: "Operating\nExpenses", delta: -opex, runningEnd: d.operating_profit, kind: "decrease" },
    { label: "Operating\nProfit", delta: d.operating_profit, runningEnd: d.operating_profit, kind: "subtotal" },
    { label: "Interest", delta: -interest, runningEnd: d.ebt, kind: "decrease" },
    { label: "Tax", delta: -d.tax, runningEnd: d.net_profit, kind: "decrease" },
    { label: "Net\nProfit", delta: d.net_profit, runningEnd: d.net_profit, kind: "subtotal" },
  ];

  // Scale: 0 .. revenue (floor at 0 for negative running values)
  const maxVal = Math.max(d.revenue, 1);
  const y = (v: number) => Math.max(0, Math.min(1, v / maxVal)) * BR_H;

  const n = steps.length;
  const slot = BR_W / n;
  const barW = slot - 14;

  return (
    <View>
      <View style={brStyles.container}>
        {[0.25, 0.5, 0.75, 1].map((p, i) => (
          <View key={i} style={[brStyles.gridLine, { bottom: BR_LABEL_H + p * BR_H }]} />
        ))}
        <View style={brStyles.baseline} />

        {steps.map((s, i) => {
          const left = i * slot + 7;
          const runningStart = s.kind === "decrease" ? s.runningEnd - s.delta : 0;
          const top = s.kind === "decrease" ? Math.max(runningStart, s.runningEnd) : s.runningEnd;
          const bottom = s.kind === "decrease" ? Math.min(runningStart, s.runningEnd) : 0;
          const barBottom = BR_LABEL_H + y(Math.max(0, bottom));
          const barH = Math.max(2, y(top) - y(Math.max(0, bottom)));
          const color =
            s.kind === "decrease"
              ? C.red
              : s.label.startsWith("Net")
                ? d.net_profit >= 0
                  ? C.green
                  : C.red
                : s.kind === "total"
                  ? accent
                  : C.blueLight;

          // Connector line from this bar's end level to the next bar
          const nextLeft = (i + 1) * slot + 7;
          const connBottom = BR_LABEL_H + y(Math.max(0, s.runningEnd));

          return (
            <Fragment key={i}>
              <View
                style={[
                  brStyles.bar,
                  { left, bottom: barBottom, width: barW, height: barH, backgroundColor: color },
                ]}
              />
              {i < n - 1 && (
                <View
                  style={[
                    brStyles.connector,
                    { left: left + barW, bottom: connBottom, width: nextLeft - left - barW },
                  ]}
                />
              )}
              <Text
                style={[
                  brStyles.valueLabel,
                  {
                    left: left - 7,
                    width: barW + 14,
                    bottom: barBottom + barH + 3,
                    color: s.kind === "decrease" ? C.redDeep : C.ink,
                  },
                ]}
              >
                {s.kind === "decrease" ? `(${fmtRandCompact(Math.abs(s.delta))})` : fmtRandCompact(s.delta)}
              </Text>
              <Text style={[brStyles.colLabel, { left: i * slot, width: slot }]}>{s.label}</Text>
            </Fragment>
          );
        })}
      </View>

      <View style={brStyles.legend}>
        <View style={brStyles.legendItem}>
          <View style={[brStyles.legendDot, { backgroundColor: accent }]} />
          <Text style={brStyles.legendText}>Revenue</Text>
        </View>
        <View style={brStyles.legendItem}>
          <View style={[brStyles.legendDot, { backgroundColor: C.blueLight }]} />
          <Text style={brStyles.legendText}>Profit subtotal</Text>
        </View>
        <View style={brStyles.legendItem}>
          <View style={[brStyles.legendDot, { backgroundColor: C.red }]} />
          <Text style={brStyles.legendText}>Cost step</Text>
        </View>
        <View style={brStyles.legendItem}>
          <View style={[brStyles.legendDot, { backgroundColor: C.green }]} />
          <Text style={brStyles.legendText}>Net profit</Text>
        </View>
      </View>
    </View>
  );
}

// ── Margin ladder (label + % of revenue) ──────────────────────────────────

const ladderStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: C.hairline,
  },
  name: { flex: 2, fontSize: 8.5, fontFamily: "Helvetica", color: C.body },
  amount: { width: 90, fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.ink, textAlign: "right" },
  track: { flex: 3, height: 6, backgroundColor: C.hairline, borderRadius: 3, marginHorizontal: 10, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  pct: { width: 44, fontSize: 8, fontFamily: "Helvetica-Bold", color: C.body, textAlign: "right" },
});

function MarginLadder({ d, accent }: { d: ProfitabilityData; accent: string }) {
  const rows = [
    { name: "Revenue", amount: d.revenue, pct: 1, color: accent },
    { name: "Gross Profit", amount: d.gross_profit, pct: d.gross_margin_pct, color: C.blue },
    { name: "Operating Profit", amount: d.operating_profit, pct: d.operating_margin_pct, color: C.blueLight },
    { name: "Net Profit", amount: d.net_profit, pct: d.net_margin_pct, color: d.net_profit >= 0 ? C.green : C.red },
  ];
  return (
    <View>
      {rows.map((r) => (
        <View key={r.name} style={ladderStyles.row}>
          <Text style={ladderStyles.name}>{r.name}</Text>
          <Text style={ladderStyles.amount}>{fmtRand(r.amount)}</Text>
          <View style={ladderStyles.track}>
            <View
              style={[
                ladderStyles.fill,
                {
                  width: `${(Math.max(0, Math.min(1, r.pct)) * 100).toFixed(1)}%`,
                  backgroundColor: r.color,
                },
              ]}
            />
          </View>
          <Text style={ladderStyles.pct}>{fmtPct(r.pct)}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Comparison table ───────────────────────────────────────────────────────

const tblStyles = StyleSheet.create({
  wrapper: { marginBottom: 8, borderRadius: 5, overflow: "hidden", borderWidth: 0.75, borderColor: C.line },
  headerRow: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 8 },
  headerCell: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.white,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  dataRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 7.5,
    borderTopWidth: 0.5,
    borderTopColor: C.hairline,
  },
  cell: { fontSize: 8, fontFamily: "Helvetica", color: C.body },
  boldCell: { fontFamily: "Helvetica-Bold", color: C.ink },
  changePos: { color: C.green, fontFamily: "Helvetica-Bold", fontSize: 8 },
  changeNeg: { color: C.red, fontFamily: "Helvetica-Bold", fontSize: 8 },
});

type CompRow = {
  metric: string;
  curVal: number;
  curPct: number;
  priorVal?: number;
  priorPct?: number;
};

function ComparisonTable({ rows, accent }: { rows: CompRow[]; accent: string }) {
  const headers = [
    { label: "Metric", flex: 2 },
    { label: "Current (R)", flex: 1.5, align: "right" as const },
    { label: "%", flex: 0.7, align: "right" as const },
    { label: "Prior (R)", flex: 1.5, align: "right" as const },
    { label: "%", flex: 0.7, align: "right" as const },
    { label: "Change", flex: 1, align: "right" as const },
  ];

  return (
    <View style={tblStyles.wrapper}>
      <View style={[tblStyles.headerRow, { backgroundColor: accent }]}>
        {headers.map((h, i) => (
          <Text
            key={i}
            style={[tblStyles.headerCell, { flex: h.flex, textAlign: h.align ?? "left" }]}
          >
            {h.label}
          </Text>
        ))}
      </View>

      {rows.map((row, ri) => {
        const changePct =
          row.priorVal !== undefined && row.priorVal !== 0
            ? ((row.curVal - row.priorVal) / row.priorVal) * 100
            : null;
        const isPos = changePct !== null && changePct >= 0;

        return (
          <View
            key={ri}
            style={[tblStyles.dataRow, { backgroundColor: ri % 2 === 1 ? C.soft : C.white }]}
          >
            <Text style={[tblStyles.cell, tblStyles.boldCell, { flex: 2 }]}>{row.metric}</Text>
            <Text style={[tblStyles.cell, { flex: 1.5, textAlign: "right" }]}>
              {fmtRand(row.curVal)}
            </Text>
            <Text style={[tblStyles.cell, { flex: 0.7, textAlign: "right" }]}>
              {fmtPct(row.curPct)}
            </Text>
            <Text style={[tblStyles.cell, { flex: 1.5, textAlign: "right" }]}>
              {row.priorVal !== undefined ? fmtRand(row.priorVal) : "—"}
            </Text>
            <Text style={[tblStyles.cell, { flex: 0.7, textAlign: "right" }]}>
              {row.priorPct !== undefined ? fmtPct(row.priorPct) : "—"}
            </Text>
            <Text
              style={[
                changePct !== null
                  ? isPos
                    ? tblStyles.changePos
                    : tblStyles.changeNeg
                  : tblStyles.cell,
                { flex: 1, textAlign: "right" },
              ]}
            >
              {changePct !== null ? `${isPos ? "+" : ""}${changePct.toFixed(1)}%` : "—"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function ProfitabilityWaterfallPDF({
  smeData,
  profitabilityData: d,
  accountantProfile,
  isDemo,
}: ProfitabilityWaterfallPDFProps) {
  const theme = resolveTheme(accountantProfile);
  const p = d.prior_period;
  const interest = d.operating_profit - d.ebt;

  const compRows: CompRow[] = [
    { metric: "Revenue", curVal: d.revenue, curPct: 1, priorVal: p?.revenue, priorPct: p ? 1 : undefined },
    { metric: "Gross Profit", curVal: d.gross_profit, curPct: d.gross_margin_pct, priorVal: p?.gross_profit, priorPct: p?.gross_margin_pct },
    { metric: "Operating Profit", curVal: d.operating_profit, curPct: d.operating_margin_pct, priorVal: p?.operating_profit, priorPct: p?.operating_margin_pct },
    { metric: "EBT", curVal: d.ebt, curPct: d.ebt / d.revenue, priorVal: p?.ebt, priorPct: p ? p.ebt / p.revenue : undefined },
    { metric: "Net Profit", curVal: d.net_profit, curPct: d.net_margin_pct, priorVal: p?.net_profit, priorPct: p?.net_margin_pct },
  ];

  const profitRatioRows = [
    { name: "Gross Margin", value: fmtPct(d.gross_margin_pct), score: d.gross_margin_score ?? 60, prior: p?.gross_margin_score },
    { name: "Operating Margin", value: fmtPct(d.operating_margin_pct), score: d.operating_margin_score ?? 65, prior: p?.operating_margin_score },
    { name: "Net Margin", value: fmtPct(d.net_margin_pct), score: d.net_margin_score ?? 62, prior: p?.net_margin_score },
    { name: "Interest Burden", value: fmtPct(d.interest_burden_pct ?? interest / d.revenue), score: d.interest_burden_score ?? 70, prior: p?.interest_burden_score },
    { name: "Tax Burden", value: fmtPct(d.tax_burden_pct ?? d.tax / d.revenue), score: d.tax_burden_score ?? 75, prior: p?.tax_burden_score },
  ];

  const revChange = p && p.revenue !== 0 ? ((d.revenue - p.revenue) / p.revenue) * 100 : undefined;
  const figures: HeadlineFigure[] = [
    {
      label: "Revenue",
      value: fmtRandCompact(d.revenue),
      direction: revChange === undefined ? undefined : revChange >= 0 ? "up" : "down",
      good: revChange === undefined ? undefined : revChange >= 0,
      note: revChange !== undefined ? `${revChange >= 0 ? "+" : ""}${revChange.toFixed(1)}% vs prior` : undefined,
    },
    { label: "Gross Margin", value: fmtPct(d.gross_margin_pct), good: d.gross_margin_pct >= 0.3 },
    { label: "Operating Margin", value: fmtPct(d.operating_margin_pct), good: d.operating_margin_pct >= 0.1 },
    {
      label: "Net Profit",
      value: fmtRandCompact(d.net_profit),
      direction: p ? (d.net_profit >= p.net_profit ? "up" : "down") : undefined,
      good: d.net_profit >= 0 && (!p || d.net_profit >= p.net_profit),
      note: `${fmtPct(d.net_margin_pct)} of revenue`,
    },
  ];

  const narrative = profitabilityNarrative({
    revenue: d.revenue,
    net_profit: d.net_profit,
    gross_margin_pct: d.gross_margin_pct,
    net_margin_pct: d.net_margin_pct,
    priorNetMargin: p?.net_margin_pct,
  });

  return (
    <PDFDocument
      title={`Profitability Waterfall — ${smeData.name}`}
      subject="Profitability Waterfall Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
    >
      {/* ── PAGE 1: Bridge ── */}
      <ReportTitle
        kicker="Advisory Report 02"
        title="Profitability Waterfall"
        subtitle="How each rand of revenue becomes profit — and where it leaks away"
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={narrative} />

      <SectionHeader title="Revenue-to-Profit Bridge" color={theme.accent} />
      <BridgeChart d={d} accent={theme.accent} />

      <SectionHeader title="Margin Ladder" color={theme.accent} />
      <MarginLadder d={d} accent={theme.accent} />

      {/* ── PAGE 2: Comparison + ratios ── */}
      <View break>
        <SectionHeader title="Current vs Prior Period" color={theme.accent} />
        {p ? (
          <ComparisonTable rows={compRows} accent={theme.accent} />
        ) : (
          <>
            <ComparisonTable rows={compRows} accent={theme.accent} />
            <Text style={{ fontSize: 7, fontFamily: "Helvetica", color: C.faint, marginBottom: 8 }}>
              Prior-period columns will populate automatically once a second period is uploaded.
            </Text>
          </>
        )}

        <SectionHeader title="Profit Pillar Ratio Analysis" color={theme.accent} />
        {profitRatioRows.map((r, i) => (
          <RatioRow
            key={r.name}
            ratioName={r.name}
            formattedValue={r.value}
            healthScore={r.score}
            healthTier={scoreTier(r.score)}
            priorScore={r.prior}
            isAlternate={i % 2 === 1}
          />
        ))}
      </View>
    </PDFDocument>
  );
}
