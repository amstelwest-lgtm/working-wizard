/**
 * CashCyclePDF — Cash Flow Cycle Report.
 * Page 1: Cycle diagram + 4 metric boxes. Page 2: Cash trapped callout + ratio rows.
 *
 * SSR safety: Only import via dynamic import() — never at top level of an
 * SSR-rendered module.
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { scoreTier } from "@/lib/ratios";
import { MetricBox } from "@/components/pdf/metric-box";
import { RatioRow } from "@/components/pdf/ratio-row";

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
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRand(value: number): string {
  const abs = Math.abs(Math.round(value));
  return (value < 0 ? "-R " : "R ") + abs.toLocaleString("en-ZA");
}

/** Fallback score if health_scores not provided */
function daysScore(days: number, goodBelow: number): number {
  if (days <= goodBelow) return 85;
  if (days <= goodBelow * 1.5) return 60;
  return 35;
}

function cccColor(days: number): string {
  if (days <= 45) return "#10b981";
  if (days <= 75) return "#f59e0b";
  return "#ef4444";
}

// ── Cash Cycle Diagram ─────────────────────────────────────────────────────

const diagramStyles = StyleSheet.create({
  wrapper: { marginBottom: 16 },
  flowRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  endBox: {
    width: 52,
    borderRadius: 5,
    padding: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  endLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },
  arrow: {
    width: 10,
    fontSize: 11,
    textAlign: "center",
    color: "#9ca3af",
    fontFamily: "Helvetica",
  },
  stageBox: {
    borderRadius: 5,
    padding: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  stageLabel: {
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 0.3,
    marginBottom: 3,
    textTransform: "uppercase",
  },
  stageDays: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  creditorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  creditorBox: {
    borderRadius: 5,
    backgroundColor: "#fef3c7",
    padding: 7,
    alignItems: "center",
  },
  creditorLabel: {
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    color: "#92400e",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  creditorDays: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#92400e",
  },
  creditorSub: {
    fontSize: 6,
    color: "#b45309",
    fontFamily: "Helvetica",
    marginTop: 1,
  },
  offsetNote: {
    flex: 1,
    paddingLeft: 12,
    paddingTop: 8,
  },
  offsetText: {
    fontSize: 8,
    color: "#6b7280",
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },
  cccBox: {
    borderRadius: 7,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  cccLeft: {},
  cccTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    marginBottom: 4,
  },
  cccFormula: {
    fontSize: 7,
    color: "#ffffff",
    opacity: 0.8,
    fontFamily: "Helvetica",
  },
  cccDays: {
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  ccsDayLabel: {
    fontSize: 9,
    color: "#ffffff",
    opacity: 0.8,
    fontFamily: "Helvetica",
    marginTop: 2,
    textAlign: "right",
  },
});

function CashCycleDiagram({
  inventoryDays,
  wipDays,
  debtorDays,
  creditorDays,
  ccc,
  accentColor,
}: {
  inventoryDays: number;
  wipDays: number;
  debtorDays: number;
  creditorDays: number;
  ccc: number;
  accentColor: string;
}) {
  // Stage widths proportional to days (within available width)
  const PURCHASE_W = 52;
  const CASH_W = 52;
  const ARROW_W = 10;
  const ARROW_COUNT = 4;
  const AVAILABLE = 515 - PURCHASE_W - CASH_W - ARROW_W * ARROW_COUNT;
  const totalCycleDays = inventoryDays + wipDays + debtorDays || 1;
  const invW = (inventoryDays / totalCycleDays) * AVAILABLE;
  const wipW = (wipDays / totalCycleDays) * AVAILABLE;
  const debW = (debtorDays / totalCycleDays) * AVAILABLE;

  // Creditor box width matches inventory section
  const credW = Math.min(invW + wipW + ARROW_W, AVAILABLE * 0.7);
  const cccBg = cccColor(ccc);

  return (
    <View style={diagramStyles.wrapper}>
      {/* Main flow */}
      <View style={diagramStyles.flowRow}>
        {/* PURCHASE */}
        <View
          style={[
            diagramStyles.endBox,
            { backgroundColor: "#f3f4f6", width: PURCHASE_W },
          ]}
        >
          <Text style={[diagramStyles.endLabel, { color: "#374151" }]}>
            PURCHASE
          </Text>
        </View>

        <Text style={diagramStyles.arrow}>→</Text>

        {/* Inventory */}
        <View
          style={[
            diagramStyles.stageBox,
            { width: invW, backgroundColor: accentColor },
          ]}
        >
          <Text style={diagramStyles.stageLabel}>Inventory</Text>
          <Text style={diagramStyles.stageDays}>{inventoryDays}d</Text>
        </View>

        <Text style={diagramStyles.arrow}>→</Text>

        {/* WIP */}
        <View
          style={[
            diagramStyles.stageBox,
            { width: wipW, backgroundColor: accentColor, opacity: 0.85 },
          ]}
        >
          <Text style={diagramStyles.stageLabel}>WIP</Text>
          <Text style={diagramStyles.stageDays}>{wipDays}d</Text>
        </View>

        <Text style={diagramStyles.arrow}>→</Text>

        {/* Debtors */}
        <View
          style={[
            diagramStyles.stageBox,
            { width: debW, backgroundColor: "#f59e0b" },
          ]}
        >
          <Text style={diagramStyles.stageLabel}>Debtors</Text>
          <Text style={diagramStyles.stageDays}>{debtorDays}d</Text>
        </View>

        <Text style={diagramStyles.arrow}>→</Text>

        {/* CASH IN */}
        <View
          style={[
            diagramStyles.endBox,
            { backgroundColor: "#d1fae5", width: CASH_W },
          ]}
        >
          <Text style={[diagramStyles.endLabel, { color: "#065f46" }]}>
            CASH{"\n"}IN
          </Text>
        </View>
      </View>

      {/* Creditor offset row */}
      <View
        style={[
          diagramStyles.creditorRow,
          { paddingLeft: PURCHASE_W + ARROW_W },
        ]}
      >
        <View style={[diagramStyles.creditorBox, { width: credW }]}>
          <Text style={diagramStyles.creditorLabel}>Credit Period</Text>
          <Text style={diagramStyles.creditorDays}>{creditorDays}d</Text>
          <Text style={diagramStyles.creditorSub}>offset ↓</Text>
        </View>
        <View style={diagramStyles.offsetNote}>
          <Text style={diagramStyles.offsetText}>
            Your creditor terms give you {creditorDays} days before payment is
            due — this offsets your cash cycle by {creditorDays} days.
          </Text>
        </View>
      </View>

      {/* CCC total */}
      <View style={[diagramStyles.cccBox, { backgroundColor: cccBg }]}>
        <View style={diagramStyles.cccLeft}>
          <Text style={diagramStyles.cccTitle}>Cash Conversion Cycle</Text>
          <Text style={diagramStyles.cccFormula}>
            {inventoryDays}d inventory + {wipDays}d WIP + {debtorDays}d
            debtors − {creditorDays}d creditors
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={diagramStyles.cccDays}>{ccc}</Text>
          <Text style={diagramStyles.ccsDayLabel}>days</Text>
        </View>
      </View>
    </View>
  );
}

// ── Cash trapped callout ───────────────────────────────────────────────────

const page2Styles = StyleSheet.create({
  trappedBox: {
    borderRadius: 8,
    padding: 18,
    marginBottom: 20,
  },
  trappedTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    opacity: 0.85,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  trappedAmount: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    marginBottom: 8,
  },
  trappedSub: {
    fontSize: 8.5,
    color: "#ffffff",
    opacity: 0.8,
    lineHeight: 1.5,
    fontFamily: "Helvetica",
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    marginBottom: 8,
    marginTop: 4,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
});

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  titleSection: { marginBottom: 16 },
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
    marginBottom: 16,
  },
  metricsGrid: { gap: 10, marginTop: 16 },
  metricsRow: { flexDirection: "row", gap: 10 },
});

// ── Main component ─────────────────────────────────────────────────────────

export function CashCyclePDF({
  smeData,
  workingCapitalData: d,
  accountantProfile,
}: CashCyclePDFProps) {
  const accentColor = accountantProfile.accentColor || "#0f3460";
  const hs = d.health_scores ?? {};
  const dailyRevenue = d.annual_revenue / 365;

  // Derive health scores with fallbacks
  const debtorScore = hs.debtor_days ?? daysScore(d.debtor_days, 30);
  const invScore = hs.inventory_days ?? daysScore(d.inventory_days, 30);
  const wipScore = hs.wip_days ?? daysScore(d.wip_days, 14);
  const credScore = Math.min(
    100,
    hs.creditor_days ?? (d.creditor_days >= 30 ? 80 : 50),
  );
  const wcDaysScore = hs.working_capital_days ?? daysScore(d.working_capital_days, 45);
  const wcFundScore =
    hs.working_capital_funding ??
    (d.working_capital_funding < 0.2
      ? 80
      : d.working_capital_funding < 0.35
        ? 55
        : 30);
  const wcUtilScore =
    hs.working_capital_utilization ??
    (d.working_capital_utilization < 0.5
      ? 80
      : d.working_capital_utilization < 0.7
        ? 60
        : 35);

  const ccc = d.cash_conversion_cycle;
  const cccChange =
    d.ccc_prior !== undefined ? d.ccc_prior - ccc : undefined; // positive = improved

  const debtorChange =
    d.debtor_days_prior !== undefined
      ? d.debtor_days_prior - d.debtor_days
      : undefined;
  const invChange =
    d.inventory_days_prior !== undefined
      ? d.inventory_days_prior - d.inventory_days
      : undefined;
  const credChange =
    d.creditor_days_prior !== undefined
      ? d.creditor_days - d.creditor_days_prior
      : undefined;

  const ratioRows = [
    {
      key: "debtorDays",
      name: "Debtor Days",
      value: `${d.debtor_days} d`,
      score: debtorScore,
      prior: debtorScore + (debtorChange ?? 0),
    },
    {
      key: "inventoryDays",
      name: "Inventory Days",
      value: `${d.inventory_days} d`,
      score: invScore,
      prior: invScore + (invChange ?? 0),
    },
    {
      key: "wipDays",
      name: "WIP Days",
      value: `${d.wip_days} d`,
      score: wipScore,
      prior: wipScore,
    },
    {
      key: "creditorDays",
      name: "Creditor Days",
      value: `${d.creditor_days} d`,
      score: credScore,
      prior: credScore - (credChange ?? 0),
    },
    {
      key: "workingCapitalDays",
      name: "Working Capital Days",
      value: `${d.working_capital_days} d`,
      score: wcDaysScore,
      prior: wcDaysScore + 5,
    },
    {
      key: "workingCapitalFunding",
      name: "WC Funding Ratio",
      value: `${(d.working_capital_funding * 100).toFixed(1)}%`,
      score: wcFundScore,
      prior: wcFundScore - 5,
    },
    {
      key: "workingCapitalUtilization",
      name: "WC Utilization",
      value: `${(d.working_capital_utilization * 100).toFixed(1)}%`,
      score: wcUtilScore,
      prior: wcUtilScore + 3,
    },
  ];

  return (
    <PDFDocument
      title={`Cash Flow Cycle Report — ${smeData.name}`}
      subject="Cash Flow Cycle Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
    >
      {/* ── PAGE 1: Diagram + metrics ── */}
      <View style={styles.titleSection}>
        <Text style={styles.title}>Cash Flow Cycle Report</Text>
        <Text style={styles.subtitle}>
          Understanding where your cash is trapped
        </Text>
      </View>

      <CashCycleDiagram
        inventoryDays={d.inventory_days}
        wipDays={d.wip_days}
        debtorDays={d.debtor_days}
        creditorDays={d.creditor_days}
        ccc={ccc}
        accentColor={accentColor}
      />

      {/* 2×2 metric grid */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricsRow}>
          <MetricBox
            label="Debtor Days"
            value={`${d.debtor_days} d`}
            change={debtorChange}
            accentColor="#f59e0b"
          />
          <MetricBox
            label="Inventory Days"
            value={`${d.inventory_days} d`}
            change={invChange}
            accentColor={accentColor}
          />
        </View>
        <View style={styles.metricsRow}>
          <MetricBox
            label="Creditor Days"
            value={`${d.creditor_days} d`}
            change={credChange}
            accentColor="#10b981"
          />
          <MetricBox
            label="Cash Conversion Cycle"
            value={`${ccc} days`}
            change={cccChange}
            accentColor={cccColor(ccc)}
          />
        </View>
      </View>

      {/* ── PAGE 2: Cash trapped + ratio rows ── */}
      <View break>
        {/* Cash trapped callout */}
        <View
          style={[
            page2Styles.trappedBox,
            { backgroundColor: cccColor(ccc) },
          ]}
        >
          <Text style={page2Styles.trappedTitle}>
            Cash Trapped in Working Capital
          </Text>
          <Text style={page2Styles.trappedAmount}>
            {formatRand(d.cash_trapped_rands)}
          </Text>
          <Text style={page2Styles.trappedSub}>
            At your current annual revenue of {formatRand(d.annual_revenue)},
            every 1-day improvement in your cash cycle releases{" "}
            {formatRand(dailyRevenue)} in cash. Reducing your cash conversion
            cycle by just 5 days would free up {formatRand(dailyRevenue * 5)}.
          </Text>
        </View>

        {/* Ratio rows */}
        <Text style={page2Styles.sectionTitle}>
          Working Capital Ratio Analysis
        </Text>
        {ratioRows.map((r, i) => (
          <RatioRow
            key={r.key}
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
