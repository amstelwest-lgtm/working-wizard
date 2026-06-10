/**
 * CashForecastPDF — 13-Week Rolling Cash Flow Forecast.
 * Page 1: Summary metrics + bar chart. Page 2: Full data table + assumptions.
 *
 * SSR safety: Only import via dynamic import() — never at top level of an
 * SSR-rendered module.
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { MetricBox } from "@/components/pdf/metric-box";

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
  smeData: SmeData;
  cashForecast: CashForecastWeek[];
  scenario: "critical" | "moderate" | "growth";
  accountantProfile: AccountantProfile;
  minimumThreshold?: number;
  assumptions?: string[];
};

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 50_000;
const CHART_W = 515;
const CHART_H = 110;
const LABEL_H = 20;

const SCENARIO_BADGE: Record<string, { label: string; bg: string }> = {
  critical: { label: "CRITICAL SCENARIO", bg: "#ef4444" },
  moderate: { label: "MODERATE SCENARIO", bg: "#f59e0b" },
  growth: { label: "GROWTH SCENARIO", bg: "#10b981" },
};

const DEFAULT_ASSUMPTIONS = [
  "Cash receipts are based on current debtor-day patterns and projected sales volume.",
  "Payments reflect existing supplier terms, contracted fixed costs, and known variable outflows.",
  "Tax and loan repayments follow the current scheduled payment calendar.",
  "No extraordinary capital expenditure, asset disposals, or one-off items are assumed in this forecast.",
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRand(value: number): string {
  const abs = Math.abs(Math.round(value));
  return (value < 0 ? "-R " : "R ") + abs.toLocaleString("en-ZA");
}

function barColor(balance: number, threshold: number): string {
  if (balance < threshold) return "#ef4444";
  if (balance < threshold * 2) return "#f59e0b";
  return "#10b981";
}

// ── Bar chart (react-pdf absolute positioning) ─────────────────────────────

const chartStyles = StyleSheet.create({
  container: {
    position: "relative",
    backgroundColor: "#f9fafb",
    borderRadius: 6,
    overflow: "hidden",
  },
  bar: {
    position: "absolute",
    borderRadius: 2,
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0.5,
    backgroundColor: "#e5e7eb",
  },
  thresholdLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: "#ef4444",
  },
  weekLabel: {
    position: "absolute",
    bottom: 3,
    fontSize: 5.5,
    textAlign: "center",
    color: "#9ca3af",
    fontFamily: "Helvetica",
  },
  balanceLabel: {
    position: "absolute",
    fontSize: 5,
    textAlign: "center",
    color: "#374151",
    fontFamily: "Helvetica",
  },
});

function BarChart({
  weeks,
  threshold,
}: {
  weeks: CashForecastWeek[];
  threshold: number;
}) {
  const maxVal = Math.max(
    ...weeks.map((w) => Math.max(w.closing_balance, 0)),
    threshold * 3,
    1,
  );
  const BAR_SLOT = CHART_W / weeks.length;
  const BAR_W = BAR_SLOT - 3;
  const totalH = CHART_H + LABEL_H;

  const thresholdBottom = LABEL_H + (threshold / maxVal) * CHART_H;
  const showThreshold = threshold < maxVal;

  return (
    <View style={[chartStyles.container, { height: totalH }]}>
      {/* Grid lines at 25% intervals */}
      {[0.25, 0.5, 0.75].map((pct, i) => (
        <View
          key={i}
          style={[chartStyles.gridLine, { bottom: LABEL_H + pct * CHART_H }]}
        />
      ))}

      {/* Threshold line */}
      {showThreshold && (
        <View
          style={[chartStyles.thresholdLine, { bottom: thresholdBottom }]}
        />
      )}

      {/* Bars */}
      {weeks.map((week, i) => {
        const balance = Math.max(0, week.closing_balance);
        const barH = Math.max(2, (balance / maxVal) * CHART_H);
        const left = i * BAR_SLOT + 1.5;
        const color = barColor(week.closing_balance, threshold);
        const labelBottom = LABEL_H + barH + 2;

        return (
          <View key={i}>
            <View
              style={[
                chartStyles.bar,
                {
                  bottom: LABEL_H,
                  left,
                  width: BAR_W,
                  height: barH,
                  backgroundColor: color,
                },
              ]}
            />
            {/* Balance label above bar (only if space) */}
            {barH > 16 && (
              <Text
                style={[
                  chartStyles.balanceLabel,
                  { bottom: labelBottom, left, width: BAR_W },
                ]}
              >
                {Math.round(week.closing_balance / 1000)}k
              </Text>
            )}
          </View>
        );
      })}

      {/* Week labels */}
      {weeks.map((week, i) => (
        <Text
          key={i}
          style={[
            chartStyles.weekLabel,
            { left: i * BAR_SLOT, width: BAR_SLOT },
          ]}
        >
          W{i + 1}
        </Text>
      ))}
    </View>
  );
}

// ── Chart legend ───────────────────────────────────────────────────────────

const legendStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 16, marginTop: 6, marginBottom: 16 },
  item: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 7, color: "#6b7280", fontFamily: "Helvetica" },
});

function ChartLegend({ threshold }: { threshold: number }) {
  return (
    <View style={legendStyles.row}>
      <View style={legendStyles.item}>
        <View style={[legendStyles.dot, { backgroundColor: "#10b981" }]} />
        <Text style={legendStyles.label}>
          Above R{(threshold * 2).toLocaleString()} — healthy
        </Text>
      </View>
      <View style={legendStyles.item}>
        <View style={[legendStyles.dot, { backgroundColor: "#f59e0b" }]} />
        <Text style={legendStyles.label}>
          R{threshold.toLocaleString()} – R{(threshold * 2).toLocaleString()} — watch
        </Text>
      </View>
      <View style={legendStyles.item}>
        <View style={[legendStyles.dot, { backgroundColor: "#ef4444" }]} />
        <Text style={legendStyles.label}>
          Below R{threshold.toLocaleString()} — critical
        </Text>
      </View>
      <View style={legendStyles.item}>
        <View
          style={[
            legendStyles.dot,
            { backgroundColor: "#ef4444", borderRadius: 0, height: 2 },
          ]}
        />
        <Text style={legendStyles.label}>Minimum threshold</Text>
      </View>
    </View>
  );
}

// ── Cash flow data table ───────────────────────────────────────────────────

const tableStyles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerCell: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 0.2,
  },
  dataRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f3f4f6",
  },
  cell: {
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: "#374151",
  },
  boldCell: {
    fontFamily: "Helvetica-Bold",
  },
});

type Col = {
  header: string;
  flex: number;
  align?: "left" | "right";
  get: (w: CashForecastWeek) => string;
  bold?: boolean;
};

const COLUMNS: Col[] = [
  { header: "Period", flex: 1.2, align: "left", get: (w) => w.period_label },
  {
    header: "Opening Balance",
    flex: 1.5,
    align: "right",
    get: (w) => formatRand(w.opening_balance),
  },
  {
    header: "Receipts",
    flex: 1.3,
    align: "right",
    get: (w) => formatRand(w.total_receipts),
  },
  {
    header: "Payments",
    flex: 1.3,
    align: "right",
    get: (w) => `(${formatRand(w.total_payments)})`,
  },
  {
    header: "Net Movement",
    flex: 1.2,
    align: "right",
    bold: true,
    get: (w) => formatRand(w.net_movement),
  },
  {
    header: "Closing Balance",
    flex: 1.5,
    align: "right",
    bold: true,
    get: (w) => formatRand(w.closing_balance),
  },
];

function CashFlowTable({
  weeks,
  threshold,
  accentColor,
}: {
  weeks: CashForecastWeek[];
  threshold: number;
  accentColor: string;
}) {
  return (
    <View>
      <View style={[tableStyles.headerRow, { backgroundColor: accentColor }]}>
        {COLUMNS.map((col, i) => (
          <Text
            key={i}
            style={[
              tableStyles.headerCell,
              { flex: col.flex, textAlign: col.align ?? "left" },
            ]}
          >
            {col.header}
          </Text>
        ))}
      </View>

      {weeks.map((week, ri) => {
        const isLow = week.closing_balance < threshold;
        const isAlternate = ri % 2 === 1;
        const bg = isLow
          ? "#fef2f2"
          : isAlternate
            ? "#f9fafb"
            : "#ffffff";

        return (
          <View key={ri} style={[tableStyles.dataRow, { backgroundColor: bg }]}>
            {COLUMNS.map((col, ci) => {
              const display = col.get(week);
              const isNeg =
                week.net_movement < 0 && col.header === "Net Movement";
              return (
                <Text
                  key={ci}
                  style={[
                    tableStyles.cell,
                    col.bold ? tableStyles.boldCell : {},
                    { flex: col.flex, textAlign: col.align ?? "left" },
                    isNeg ? { color: "#ef4444" } : {},
                    isLow && col.header === "Closing Balance"
                      ? { color: "#ef4444" }
                      : {},
                  ]}
                >
                  {display}
                </Text>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

// ── Assumptions ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  titleSection: { marginBottom: 16 },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 5,
  },
  scenarioBadge: {
    alignSelf: "flex-start",
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 16,
  },
  scenadioText: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 0.8,
  },
  metricsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  chartTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  assumptionsSection: { marginTop: 24 },
  assumptionsTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  bulletRow: { flexDirection: "row", marginBottom: 5 },
  bullet: {
    fontSize: 8,
    color: "#6b7280",
    width: 12,
    fontFamily: "Helvetica",
  },
  bulletText: {
    fontSize: 8,
    color: "#6b7280",
    flex: 1,
    lineHeight: 1.5,
    fontFamily: "Helvetica",
  },
  p2Title: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 12,
  },
});

// ── Main component ─────────────────────────────────────────────────────────

export function CashForecastPDF({
  smeData,
  cashForecast,
  scenario,
  accountantProfile,
  minimumThreshold = DEFAULT_THRESHOLD,
  assumptions = DEFAULT_ASSUMPTIONS,
}: CashForecastPDFProps) {
  const badge = SCENARIO_BADGE[scenario] ?? SCENARIO_BADGE.moderate;
  const accentColor = accountantProfile.accentColor || "#0f3460";

  const firstWeek = cashForecast[0];
  const lastWeek = cashForecast[cashForecast.length - 1];
  const currentBalance = firstWeek?.opening_balance ?? 0;
  const runwayWeeks = lastWeek?.runway_weeks ?? 0;
  const minBalance = Math.min(...cashForecast.map((w) => w.closing_balance));

  return (
    <PDFDocument
      title={`13-Week Cash Flow Forecast — ${smeData.name}`}
      subject="13-Week Rolling Cash Flow Forecast"
      smeData={smeData}
      accountantProfile={accountantProfile}
    >
      {/* ── PAGE 1: Summary ── */}
      <View style={styles.titleSection}>
        <Text style={styles.title}>13-Week Cash Flow Forecast</Text>
        <View style={[styles.scenarioBadge, { backgroundColor: badge.bg }]}>
          <Text style={styles.scenadioText}>{badge.label}</Text>
        </View>
      </View>

      {/* Summary metrics */}
      <View style={styles.metricsRow}>
        <MetricBox
          label="Current Cash Balance"
          value={formatRand(currentBalance)}
          accentColor={accentColor}
        />
        <MetricBox
          label="Projected Runway"
          value={`${runwayWeeks} weeks`}
          accentColor={
            runwayWeeks < 4 ? "#ef4444" : runwayWeeks < 8 ? "#f59e0b" : "#10b981"
          }
        />
        <MetricBox
          label="Minimum Cash Balance"
          value={formatRand(minBalance)}
          accentColor={minBalance < minimumThreshold ? "#ef4444" : "#10b981"}
        />
      </View>

      {/* Bar chart */}
      <Text style={styles.chartTitle}>Weekly Closing Cash Balance</Text>
      <BarChart weeks={cashForecast} threshold={minimumThreshold} />
      <ChartLegend threshold={minimumThreshold} />

      {/* ── PAGE 2: Data table + assumptions ── */}
      <View break>
        <Text style={styles.p2Title}>Weekly Cash Flow Detail</Text>
        <CashFlowTable
          weeks={cashForecast}
          threshold={minimumThreshold}
          accentColor={accentColor}
        />

        <View style={styles.assumptionsSection}>
          <Text style={styles.assumptionsTitle}>Assumptions</Text>
          {assumptions.map((text, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bulletText}>{text}</Text>
            </View>
          ))}
        </View>
      </View>
    </PDFDocument>
  );
}
