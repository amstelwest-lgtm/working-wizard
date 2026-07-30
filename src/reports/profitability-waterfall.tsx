/**
 * ProfitabilityWaterfallPDF — Profitability Waterfall Report.
 * Page 1: Waterfall visual. Page 2: Comparison table + ratio rows.
 *
 * SSR safety: Only import via dynamic import() — never at top level of an
 * SSR-rendered module.
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { scoreTier } from "@/lib/ratios";
import { RatioRow } from "@/components/pdf/ratio-row";

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
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRand(value: number): string {
  const abs = Math.abs(Math.round(value));
  return (value < 0 ? "-R " : "R ") + abs.toLocaleString("en-ZA");
}

function pctStr(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const TIER_COLORS: Record<string, string> = {
  critical: "#ef4444",
  at_risk: "#f59e0b",
  healthy: "#10b981",
};

// ── Waterfall styles ───────────────────────────────────────────────────────

const wfStyles = StyleSheet.create({
  wrapper: { marginBottom: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  labelCol: { width: 130 },
  lineLabel: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 1,
  },
  lineValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  linePct: {
    fontSize: 7,
    color: "#6b7280",
    fontFamily: "Helvetica",
    marginTop: 1,
  },
  barTrack: {
    flex: 1,
    height: 20,
    backgroundColor: "#f3f4f6",
    borderRadius: 4,
    overflow: "hidden",
    marginRight: 8,
  },
  barFill: {
    height: 20,
    borderRadius: 4,
  },
  pctCol: {
    width: 42,
    textAlign: "right",
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
  },
  tierBadge: {
    width: 56,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 3,
    alignItems: "center",
  },
  tierText: {
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 0.3,
  },
  deductionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 130,
    marginBottom: 8,
  },
  deductionArrow: {
    fontSize: 10,
    color: "#9ca3af",
    marginRight: 6,
    fontFamily: "Helvetica",
  },
  deductionLabel: {
    fontSize: 7.5,
    color: "#6b7280",
    fontFamily: "Helvetica",
  },
  deductionValue: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#6b7280",
  },
  summaryBox: {
    backgroundColor: "#f9fafb",
    borderRadius: 6,
    padding: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryLabel: {
    fontSize: 8.5,
    color: "#6b7280",
    fontFamily: "Helvetica",
  },
  summaryValue: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginTop: 2,
  },
});

// ── Waterfall row component ────────────────────────────────────────────────

function WaterfallLine({
  label,
  amount,
  pct,
  color,
  tier,
  tierLabel,
}: {
  label: string;
  amount: number;
  pct: number;
  color: string;
  tier?: string;
  tierLabel?: string;
}) {
  const clampedPct = Math.max(0, Math.min(1, pct));
  const tierBg = tier ? TIER_COLORS[tier] ?? "#6b7280" : null;

  return (
    <View style={wfStyles.row}>
      <View style={wfStyles.labelCol}>
        <Text style={wfStyles.lineLabel}>{label}</Text>
        <Text style={wfStyles.lineValue}>{formatRand(amount)}</Text>
        <Text style={wfStyles.linePct}>{pctStr(pct)} of revenue</Text>
      </View>

      <View style={wfStyles.barTrack}>
        <View
          style={[
            wfStyles.barFill,
            {
              width: `${(clampedPct * 100).toFixed(1)}%`,
              backgroundColor: color,
            },
          ]}
        />
      </View>

      <Text style={wfStyles.pctCol}>{pctStr(pct)}</Text>

      {tierBg && tierLabel ? (
        <View style={[wfStyles.tierBadge, { backgroundColor: tierBg }]}>
          <Text style={wfStyles.tierText}>{tierLabel.toUpperCase()}</Text>
        </View>
      ) : (
        <View style={{ width: 56 }} />
      )}
    </View>
  );
}

function DeductionRow({
  label,
  amount,
}: {
  label: string;
  amount: number;
}) {
  return (
    <View style={wfStyles.deductionRow}>
      <Text style={wfStyles.deductionArrow}>↓</Text>
      <Text style={wfStyles.deductionLabel}>{label}: </Text>
      <Text style={wfStyles.deductionValue}>({formatRand(amount)})</Text>
    </View>
  );
}

// ── Comparison table ───────────────────────────────────────────────────────

const tblStyles = StyleSheet.create({
  wrapper: { marginBottom: 20 },
  headerRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 4,
  },
  headerCell: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  dataRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f3f4f6",
  },
  cell: { fontSize: 8, fontFamily: "Helvetica", color: "#374151" },
  boldCell: { fontFamily: "Helvetica-Bold", color: "#111827" },
  changePos: { color: "#10b981", fontFamily: "Helvetica-Bold", fontSize: 8 },
  changeNeg: { color: "#ef4444", fontFamily: "Helvetica-Bold", fontSize: 8 },
});

type CompRow = {
  metric: string;
  curVal: number;
  curPct: number;
  priorVal?: number;
  priorPct?: number;
  isHeader?: boolean;
};

function ComparisonTable({
  rows,
  accentColor,
}: {
  rows: CompRow[];
  accentColor: string;
}) {
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
      <View style={[tblStyles.headerRow, { backgroundColor: accentColor }]}>
        {headers.map((h, i) => (
          <Text
            key={i}
            style={[
              tblStyles.headerCell,
              { flex: h.flex, textAlign: h.align ?? "left" },
            ]}
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
            style={[
              tblStyles.dataRow,
              { backgroundColor: ri % 2 === 1 ? "#f9fafb" : "#ffffff" },
            ]}
          >
            <Text
              style={[
                tblStyles.cell,
                tblStyles.boldCell,
                { flex: 2 },
              ]}
            >
              {row.metric}
            </Text>
            <Text
              style={[tblStyles.cell, { flex: 1.5, textAlign: "right" }]}
            >
              {formatRand(row.curVal)}
            </Text>
            <Text
              style={[
                tblStyles.cell,
                { flex: 0.7, textAlign: "right" },
              ]}
            >
              {pctStr(row.curPct)}
            </Text>
            <Text
              style={[tblStyles.cell, { flex: 1.5, textAlign: "right" }]}
            >
              {row.priorVal !== undefined ? formatRand(row.priorVal) : "—"}
            </Text>
            <Text
              style={[
                tblStyles.cell,
                { flex: 0.7, textAlign: "right" },
              ]}
            >
              {row.priorPct !== undefined ? pctStr(row.priorPct) : "—"}
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
              {changePct !== null
                ? `${isPos ? "+" : ""}${changePct.toFixed(1)}%`
                : "—"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Page styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  titleSection: { marginBottom: 14 },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 9.5,
    color: "#6b7280",
    fontFamily: "Helvetica",
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
});

// ── Main component ─────────────────────────────────────────────────────────

export function ProfitabilityWaterfallPDF({
  smeData,
  profitabilityData: d,
  accountantProfile,
}: ProfitabilityWaterfallPDFProps) {
  const accentColor = accountantProfile.accentColor || "#0f3460";
  const p = d.prior_period;

  const cogs = d.revenue - d.gross_profit;
  const opex = d.gross_profit - d.operating_profit;
  const interest = d.operating_profit - d.ebt;
  const netPctOfRevenue = d.net_profit / d.revenue;

  const grossTier = scoreTier(d.gross_margin_score);
  const opTier = scoreTier(d.operating_margin_score);
  const netTier = scoreTier(d.net_margin_score);

  const compRows: CompRow[] = [
    {
      metric: "Revenue",
      curVal: d.revenue,
      curPct: 1,
      priorVal: p?.revenue,
      priorPct: p ? 1 : undefined,
    },
    {
      metric: "Gross Profit",
      curVal: d.gross_profit,
      curPct: d.gross_margin_pct,
      priorVal: p?.gross_profit,
      priorPct: p?.gross_margin_pct,
    },
    {
      metric: "Operating Profit",
      curVal: d.operating_profit,
      curPct: d.operating_margin_pct,
      priorVal: p?.operating_profit,
      priorPct: p?.operating_margin_pct,
    },
    {
      metric: "EBT",
      curVal: d.ebt,
      curPct: d.ebt / d.revenue,
      priorVal: p?.ebt,
      priorPct: p ? p.ebt / p.revenue : undefined,
    },
    {
      metric: "Net Profit",
      curVal: d.net_profit,
      curPct: d.net_margin_pct,
      priorVal: p?.net_profit,
      priorPct: p?.net_margin_pct,
    },
  ];

  const profitRatioRows = [
    {
      name: "Gross Margin",
      value: pctStr(d.gross_margin_pct),
      score: d.gross_margin_score ?? 60,
      prior: p?.gross_margin_score,
    },
    {
      name: "Operating Margin",
      value: pctStr(d.operating_margin_pct),
      score: d.operating_margin_score ?? 65,
      prior: p?.operating_margin_score,
    },
    {
      name: "Net Margin",
      value: pctStr(d.net_margin_pct),
      score: d.net_margin_score ?? 62,
      prior: p?.net_margin_score,
    },
    {
      name: "Interest Burden",
      value: pctStr(d.interest_burden_pct ?? interest / d.revenue),
      score: d.interest_burden_score ?? 70,
      prior: p?.interest_burden_score,
    },
    {
      name: "Tax Burden",
      value: pctStr(d.tax_burden_pct ?? d.tax / d.revenue),
      score: d.tax_burden_score ?? 75,
      prior: p?.tax_burden_score,
    },
  ];

  return (
    <PDFDocument
      title={`Profitability Waterfall — ${smeData.name}`}
      subject="Profitability Waterfall Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
    >
      {/* ── PAGE 1: Waterfall visual ── */}
      <View style={styles.titleSection}>
        <Text style={styles.title}>Profitability Waterfall</Text>
        <Text style={styles.subtitle}>
          How R1 of revenue becomes profit
        </Text>
      </View>

      <View style={wfStyles.wrapper}>
        {/* Revenue */}
        <WaterfallLine
          label="Revenue"
          amount={d.revenue}
          pct={1}
          color={accentColor}
        />

        {/* COGS deduction */}
        <DeductionRow label="Cost of Goods Sold" amount={cogs} />

        {/* Gross Profit */}
        <WaterfallLine
          label="Gross Profit"
          amount={d.gross_profit}
          pct={d.gross_margin_pct}
          color={TIER_COLORS[grossTier]}
          tier={grossTier}
          tierLabel={grossTier.replace("_", " ")}
        />

        {/* OpEx deduction */}
        <DeductionRow label="Operating Expenses" amount={opex} />

        {/* Operating Profit */}
        <WaterfallLine
          label="Operating Profit"
          amount={d.operating_profit}
          pct={d.operating_margin_pct}
          color={TIER_COLORS[opTier]}
          tier={opTier}
          tierLabel={opTier.replace("_", " ")}
        />

        {/* Interest deduction */}
        <DeductionRow label="Interest & Finance Costs" amount={interest} />

        {/* EBT */}
        <WaterfallLine
          label="Earnings Before Tax"
          amount={d.ebt}
          pct={d.ebt / d.revenue}
          color="#6b7280"
        />

        {/* Tax deduction */}
        <DeductionRow label="Income Tax" amount={d.tax} />

        {/* Net Profit */}
        <WaterfallLine
          label="Net Profit"
          amount={d.net_profit}
          pct={d.net_margin_pct}
          color={TIER_COLORS[netTier]}
          tier={netTier}
          tierLabel={netTier.replace("_", " ")}
        />

        {/* Summary callout */}
        <View style={wfStyles.summaryBox}>
          <Text style={wfStyles.summaryLabel}>
            For every R100 of revenue…
          </Text>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={wfStyles.summaryValue}>
              R{(netPctOfRevenue * 100).toFixed(2)} reaches net profit
            </Text>
            <Text style={[wfStyles.summaryLabel, { marginTop: 2 }]}>
              after all costs, interest, and tax
            </Text>
          </View>
        </View>
      </View>

      {/* ── PAGE 2: Comparison table + ratio rows ── */}
      <View break>
        <Text style={styles.sectionTitle}>
          Current vs Prior Period Comparison
        </Text>
        <ComparisonTable rows={compRows} accentColor={accentColor} />

        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>
          Profit Pillar Ratio Analysis
        </Text>
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
